import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import type IORedis from 'ioredis';
import { createBullConnection } from '../../queue/redis-connection';
import { taskRoom, userRoom } from './rooms';

/**
 * Emits Socket.IO events from any process, including the worker process,
 * which has no socket server of its own: events are published to Redis in the
 * same format the Redis adapter uses, and every API instance delivers them to
 * the sockets it holds. This is how a matching wave created in the worker
 * reaches a worker's phone instantly.
 *
 * Best-effort by design: a lost event is covered by the REST endpoints the
 * clients also poll on (re)connect — GET /workers/me/offers for requests,
 * GET /tasks/:id for status — so nothing depends on an event arriving.
 *
 * Every outbound event goes through here, never through RealtimeGateway's
 * `server`, which exists only in the API process. Found in production
 * (docs/22, #1): the sweeper, running in the worker process, broadcast an
 * expiry through the gateway, threw on the undefined server, and never
 * reached the refund that followed. Nothing here throws.
 */
/** Sent before the server ends a socket whose sessions were revoked: do not reconnect. */
export const SESSION_REVOKED_EVENT = 'session:revoked';
/** Sent before the server ends a socket whose access token has expired: refresh, then reconnect. */
export const SESSION_EXPIRED_EVENT = 'session:expired';

@Injectable()
export class RealtimePublisher implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimePublisher.name);
  private redis: IORedis | null = null;
  private emitter: ReturnType<Emitter['of']> | null = null;

  /** Created on first use, so constructing the service (tests, scripts) opens no connection. */
  private get ws(): ReturnType<Emitter['of']> {
    if (!this.emitter) {
      this.redis = createBullConnection();
      this.emitter = new Emitter(this.redis).of('/ws');
    }
    return this.emitter;
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.emit(userRoom(userId), event, payload);
  }

  toTask(taskId: string, event: string, payload: unknown): void {
    this.emit(taskRoom(taskId), event, payload);
  }

  /** A task status change, for the live timeline (docs/09). */
  taskStatus(taskId: string, status: string): void {
    this.toTask(taskId, 'task:status', { taskId, status });
  }

  /** A persisted, already-redacted chat message. Never the raw body. */
  newMessage(taskId: string, message: unknown): void {
    this.toTask(taskId, 'message:new', message);
  }

  /**
   * Ends every live connection a user has, on every API instance: their
   * sessions were revoked (suspended, password reset, account deleted). The
   * client is told first, so it does not try to reconnect (docs/22, #22).
   */
  disconnectUser(userId: string): void {
    try {
      this.ws.in(userRoom(userId)).emit(SESSION_REVOKED_EVENT, {});
      this.ws.in(userRoom(userId)).disconnectSockets(true);
    } catch (error) {
      this.logger.warn(`Could not disconnect user ${userId}: ${String(error)}`);
    }
  }

  /**
   * Takes a user's sockets out of a task's room, on every API instance, when
   * a worker leaves or is removed, so they stop receiving that task's chat
   * and updates at once. Every authenticated socket sits in its user's room,
   * so "the sockets in this user's room leave that task's room" reaches all
   * of them, from any process.
   */
  removeUserFromTask(taskId: string, userId: string): void {
    try {
      this.ws.in(userRoom(userId)).socketsLeave(taskRoom(taskId));
    } catch (error) {
      this.logger.warn(`Could not remove user ${userId} from task room ${taskId}: ${String(error)}`);
    }
  }

  private emit(room: string, event: string, payload: unknown): void {
    try {
      this.ws.to(room).emit(event, payload);
    } catch (error) {
      this.logger.warn(`Realtime emit ${event} to ${room} failed: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}
