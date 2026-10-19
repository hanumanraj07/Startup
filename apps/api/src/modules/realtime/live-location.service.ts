import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { TaskStatus } from '@prisma/client';
import type IORedis from 'ioredis';
import { NotFoundError } from '../../common/errors';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { createBullConnection } from '../../queue/redis-connection';
import { GeoRepository, isWithinIndiaBounds } from '../../repositories/geo.repository';
import { RealtimePublisher } from './realtime.publisher';

/** Where the worker is heading while their location is being shared. */
export type TrackingLeg = 'to_task' | 'to_pickup' | 'to_dropoff';

/**
 * When the worker's live location is shared with the requester (founder
 * decision, 2026-10-19): from "On my way" until arrival, and for pickup &
 * delivery also while the item is being carried to the drop-off. Never
 * between accepting and setting off, which would often reveal the worker's
 * home. The single source of this rule; the web app mirrors it in
 * lib/task-progress.ts.
 */
export function trackingLeg(status: TaskStatus, hasDropoff: boolean): TrackingLeg | null {
  if (status === 'WORKER_EN_ROUTE') return hasDropoff ? 'to_pickup' : 'to_task';
  if (status === 'IN_PROGRESS' && hasDropoff) return 'to_dropoff';
  return null;
}

export interface LiveLocationInput {
  taskId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  heading?: number;
  speed?: number;
}

export interface LiveLocationView {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  heading: number | null;
  at: string;
  leg: TrackingLeg;
  /** Straight-line metres to where the worker is heading, measured with PostGIS. */
  distanceMeters: number;
}

const liveKey = (taskId: string) => `live:${taskId}`;
const throttleKey = (taskId: string) => `live-throttle:${taskId}`;

/**
 * The worker's live position during a trip. Only the latest point is kept
 * (founder decision: no trail), in Redis with a short TTL, so it disappears
 * on its own when the trip ends or the worker goes quiet. It is broadcast to
 * the task's room only, which only the requester and the assigned worker can
 * join. Arrival and proof GPS remain the evidence of record; this is a
 * convenience view and is never used to decide anything.
 */
@Injectable()
export class LiveLocationService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveLocationService.name);
  private client: IORedis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoRepository,
    private readonly publisher: RealtimePublisher,
  ) {}

  private get redis(): IORedis {
    if (!this.client) this.client = createBullConnection();
    return this.client;
  }

  async update(workerId: string, input: LiveLocationInput): Promise<{ ok: boolean; reason?: string }> {
    const { taskId, latitude, longitude } = input;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !isWithinIndiaBounds(latitude, longitude)) {
      return { ok: false, reason: 'That location is not valid.' };
    }

    const env = loadEnv();
    // Updates closer together than the interval are dropped, not queued: only the newest point matters.
    const allowed = await this.redis.set(throttleKey(taskId), '1', 'PX', env.LIVE_LOCATION_MIN_INTERVAL_MS, 'NX');
    if (allowed === null) return { ok: true };

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, assignedWorkerId: true, dropoffLat: true },
    });
    if (!task || task.assignedWorkerId !== workerId) return { ok: false, reason: 'This is not your task.' };
    const leg = trackingLeg(task.status, task.dropoffLat !== null);
    if (!leg) return { ok: false, reason: 'Location sharing is off at this stage of the task.' };

    const measured = await this.geo.measureDistanceToTask({
      taskId,
      reportedLat: latitude,
      reportedLng: longitude,
      includeDropoff: leg === 'to_dropoff',
    });
    if (!measured) return { ok: false, reason: 'This is not your task.' };

    const view: LiveLocationView = {
      latitude,
      longitude,
      accuracyMeters: finiteOrNull(input.accuracyMeters),
      heading: finiteOrNull(input.heading),
      at: new Date().toISOString(),
      leg,
      distanceMeters: Math.round(leg === 'to_dropoff' ? (measured.dropoffDistanceMeters ?? measured.distanceMeters) : measured.distanceMeters),
    };
    await this.redis.set(liveKey(taskId), JSON.stringify(view), 'EX', env.LIVE_LOCATION_TTL_SECONDS);
    this.publisher.toTask(taskId, 'location:worker', { taskId, ...view });
    return { ok: true };
  }

  /** The latest point for a party to the task, or null when nothing is being shared right now. */
  async latest(taskId: string, userId: string): Promise<LiveLocationView | null> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, requesterId: true, assignedWorkerId: true, dropoffLat: true },
    });
    if (!task || (task.requesterId !== userId && task.assignedWorkerId !== userId)) {
      throw new NotFoundError('Task not found.');
    }
    if (!trackingLeg(task.status, task.dropoffLat !== null)) return null;
    const raw = await this.redis.get(liveKey(taskId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LiveLocationView;
    } catch {
      return null;
    }
  }

  /** Stops sharing for a task: forgets the point and tells the room. Safe to call for any task. */
  async end(taskId: string): Promise<void> {
    try {
      await this.redis.del(liveKey(taskId));
    } catch (error) {
      this.logger.warn(`Could not clear live location for task ${taskId}: ${String(error)}`);
    }
    this.publisher.toTask(taskId, 'location:ended', { taskId });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}
