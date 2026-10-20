import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { isAllowedOrigin } from './cors-origin';
import { LiveLocationService, type LiveLocationInput } from './live-location.service';
import { SESSION_EXPIRED_EVENT, SESSION_REVOKED_EVENT } from './realtime.publisher';
import { taskRoom, userRoom } from './rooms';

/**
 * docs/07-api-specification.md: "WebSocket namespace `/ws`, room per task,
 * membership authorized on connection. Socket.IO with the Redis adapter so
 * any API instance can serve any socket."
 *
 * Two authorization checks, not one: connecting requires a valid access
 * token (same JWT the REST API uses — see JwtAuthGuard), and joining a
 * specific task's room additionally requires being that task's requester or
 * assigned worker. A valid login proves who you are; it does not prove you
 * belong in every task's room.
 *
 * CORS mirrors main.ts's REST policy exactly: an explicit allow-list, never
 * a wildcard with credentials. Found live, the hard way: the `cors` package
 * Engine.IO uses underneath expects an `origin` function shaped
 * `(origin, callback)` that CALLS the callback — an earlier version here
 * passed a zero-argument function that just returned `true`, which the
 * underlying package invoked as `originFn(requestOrigin, callback)` and got
 * back a value it never looks at. The callback was never called, so the CORS
 * check — and therefore the ENTIRE handshake — hung forever with no error,
 * no timeout, nothing in any log. Every socket.io connection attempt against
 * a real running server timed out; not one server-side unit test caught it,
 * since none of them exercise Engine.IO's actual CORS negotiation. See
 * ai/memory.md.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, isAllowedOrigin(origin, loadEnv().WEB_URL));
    },
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly live: LiveLocationService,
  ) {}

  /**
   * The same checks JwtAuthGuard makes on every HTTP request, not just a
   * valid signature (docs/22, #22): the account still exists and is active,
   * and the token's version is current (suspension, a password reset and
   * account deletion all bump it). And the socket lives no longer than its
   * token: when the token expires the client is told to refresh and
   * reconnect. Before, one valid token at connect kept a socket receiving
   * events indefinitely, through a suspension or a password reset.
   */
  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth as Record<string, unknown> | undefined)?.token ??
      client.handshake.query.token;

    if (typeof token !== 'string' || !token) {
      this.logger.debug(`Socket ${client.id} rejected: no access token presented.`);
      this.end(client, SESSION_EXPIRED_EVENT);
      return;
    }

    let payload: ReturnType<TokenService['verifyAccessToken']> & { exp?: number };
    try {
      payload = this.tokens.verifyAccessToken(token);
    } catch {
      this.logger.debug(`Socket ${client.id} rejected: invalid or expired access token.`);
      this.end(client, SESSION_EXPIRED_EVENT);
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, tokenVersion: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== payload.tokenVersion) {
      this.logger.debug(`Socket ${client.id} rejected: session revoked or account not active.`);
      this.end(client, SESSION_REVOKED_EVENT);
      return;
    }

    client.data.userId = payload.sub;
    // Every authenticated socket hears events addressed to its own user:
    // incoming task requests for a worker, "your task was accepted" for a
    // requester. Nothing addressed to anyone else. Also how disconnectUser
    // reaches every socket of a revoked user.
    void client.join(userRoom(payload.sub));

    if (payload.exp) {
      const ms = payload.exp * 1000 - Date.now();
      const timer = setTimeout(() => this.end(client, SESSION_EXPIRED_EVENT), Math.max(ms, 0));
      timer.unref?.();
      client.data.expiryTimer = timer;
    }
  }

  handleDisconnect(client: Socket): void {
    if (client.data.expiryTimer) clearTimeout(client.data.expiryTimer as ReturnType<typeof setTimeout>);
    this.logger.debug(`Socket ${client.id} (user ${client.data.userId ?? 'unauthenticated'}) disconnected.`);
  }

  /** Tells the client why, then ends the socket. */
  private end(client: Socket, reason: typeof SESSION_EXPIRED_EVENT | typeof SESSION_REVOKED_EVENT): void {
    client.emit(reason, {});
    client.disconnect(true);
  }

  /**
   * Joins the caller to a task's room, after confirming they are actually a
   * party to it. Anyone else's join request is acknowledged with an error
   * rather than silently ignored, so a client bug surfaces instead of just
   * never receiving messages.
   */
  @SubscribeMessage('task:join')
  async onJoinTask(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { taskId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const userId = client.data.userId as string | undefined;
    const taskId = data?.taskId;
    if (!userId || !taskId) return { ok: false, error: 'Missing task id.' };

    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || (task.requesterId !== userId && task.assignedWorkerId !== userId)) {
      return { ok: false, error: 'Not a party to this task.' };
    }

    await client.join(taskRoom(taskId));
    return { ok: true };
  }

  /**
   * The assigned worker's live position during a trip. Authorization and
   * the "only while on the way" rule are checked in LiveLocationService on
   * every update, not just on join.
   */
  @SubscribeMessage('location:update')
  async onLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: Partial<LiveLocationInput> | undefined,
  ): Promise<{ ok: boolean; reason?: string }> {
    const userId = client.data.userId as string | undefined;
    if (!userId || typeof data?.taskId !== 'string') return { ok: false, reason: 'Missing task id.' };
    return this.live.update(userId, {
      taskId: data.taskId,
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      accuracyMeters: data.accuracyMeters === undefined ? undefined : Number(data.accuracyMeters),
      heading: data.heading === undefined ? undefined : Number(data.heading),
      speed: data.speed === undefined ? undefined : Number(data.speed),
    });
  }

  @SubscribeMessage('task:leave')
  onLeaveTask(@ConnectedSocket() client: Socket, @MessageBody() data: { taskId?: string }): void {
    if (data?.taskId) void client.leave(taskRoom(data.taskId));
  }

  // Outbound events (status changes, chat messages, removing a user from a
  // room) go through RealtimePublisher, which works from any process. This
  // gateway's `server` exists only in the API process; calling it from the
  // worker process threw and skipped refunds (docs/22, #1).
}
