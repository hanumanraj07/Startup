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
 */
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
