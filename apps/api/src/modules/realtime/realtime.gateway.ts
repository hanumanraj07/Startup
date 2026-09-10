import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { isAllowedOrigin } from './cors-origin';

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

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(client: Socket): void {
    const token =
      (client.handshake.auth as Record<string, unknown> | undefined)?.token ??
      client.handshake.query.token;

    if (typeof token !== 'string' || !token) {
      this.logger.debug(`Socket ${client.id} rejected: no access token presented.`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.tokens.verifyAccessToken(token);
      client.data.userId = payload.sub;
    } catch {
      this.logger.debug(`Socket ${client.id} rejected: invalid or expired access token.`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket ${client.id} (user ${client.data.userId ?? 'unauthenticated'}) disconnected.`);
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

    await client.join(roomFor(taskId));
    return { ok: true };
  }

  @SubscribeMessage('task:leave')
  onLeaveTask(@ConnectedSocket() client: Socket, @MessageBody() data: { taskId?: string }): void {
    if (data?.taskId) void client.leave(roomFor(data.taskId));
  }

  /** Called by ChatService after a message is persisted and redacted. Never emits the raw body. */
  emitNewMessage(taskId: string, message: unknown): void {
    this.server.to(roomFor(taskId)).emit('message:new', message);
  }

  /** Broadcasts a task status change to its room — used for the live timeline (docs/09, docs/07-ui-design). */
  emitTaskStatus(taskId: string, status: string): void {
    this.server.to(roomFor(taskId)).emit('task:status', { taskId, status });
  }
}

function roomFor(taskId: string): string {
  return `task:${taskId}`;
}
