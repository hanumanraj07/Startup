import { Injectable, Logger } from '@nestjs/common';
import { approximateAddress } from '../../common/projections';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingQueue } from '../../queue/matching.queue';
import { GeoRepository } from '../../repositories/geo.repository';
import { RealtimePublisher } from '../realtime/realtime.publisher';

/** What an incoming request shows a worker. The same projection as the open feed: locality only, never the exact address. */
export interface OfferView {
  offerId: string;
  taskId: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  payoutPaise: number;
  /** The most the worker would spend on an item and get back, or 0. Not earnings. */
  itemBudgetPaise: number;
  distanceMeters: number;
  approximateAddress: string;
  dropoff: { approximateAddress: string; tripDistanceMeters: number } | null;
  deadlineAt: string;
  expiresAt: string;
  /** The full response window, so the countdown ring can show how much of it is left. */
  windowSeconds: number;
  requester: { displayName: string; verificationLevel: number };
}

export type OfferClosedReason = 'TAKEN' | 'EXPIRED' | 'WITHDRAWN';

const OPEN_TASK_STATUSES = ['PUBLISHED', 'MATCHING'] as const;

/**
 * Incoming task requests (formal offers) and their 90-second response window.
 * A wave of requests goes to the best few nearby workers at once
 * (MatchingService); the first confirmed accept wins (the atomic update in
 * TasksService.accept). This service owns what happens around that: showing
 * a worker their open requests, closing everyone else's the moment one is
 * taken, expiring unanswered ones, and sending the next, wider wave as soon
 * as a wave is used up instead of waiting out the tier timer.
 * See docs/10-matching-engine.md.
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoRepository,
    private readonly queue: MatchingQueue,
    private readonly publisher: RealtimePublisher,
  ) {}

  /** A worker's requests that are still open: unanswered, inside the window, task still unassigned. */
  async listOpenForWorker(workerId: string): Promise<OfferView[]> {
    const offers = await this.prisma.taskOffer.findMany({
      where: {
        workerId,
        response: null,
        expiresAt: { gt: new Date() },
        task: { status: { in: [...OPEN_TASK_STATUSES] }, assignedWorkerId: null, deadlineAt: { gt: new Date() } },
      },
      orderBy: { expiresAt: 'asc' },
      take: 5,
      select: { id: true, taskId: true },
    });
    const views = await Promise.all(offers.map((o) => this.buildViews(o.taskId, [workerId])));
    return views.flat().map((v) => v.view);
  }

  /** Pushes each new request to its worker's devices. */
  async announce(taskId: string, workerIds: string[]): Promise<void> {
    if (workerIds.length === 0) return;
    for (const { workerId, view } of await this.buildViews(taskId, workerIds)) {
      this.publisher.toUser(workerId, 'offer:new', view);
    }
  }

  /**
   * The task was just accepted: the winner's request (if they had one) is
   * recorded as accepted, every other open request is closed, and those
   * workers are told it is gone so the request disappears from their screen.
   */
  async closeForAssignment(taskId: string, winnerId: string): Promise<void> {
    const now = new Date();
    await this.prisma.taskOffer.updateMany({
      where: { taskId, workerId: winnerId, response: null },
      data: { response: 'ACCEPTED', respondedAt: now },
    });
    await this.closeOpen(taskId, 'TAKEN');
  }

  /** The task left matching for another reason (cancelled, expired): withdraw any open requests. */
  async withdraw(taskId: string): Promise<void> {
    await this.closeOpen(taskId, 'WITHDRAWN');
  }

  /**
   * Expires requests whose window has passed, for one task or for all. The
   * sweeper calls it for all, so a final-wave request that nothing else will
   * touch still closes; the tier pass calls it for its own task first.
   */
  async expireOverdue(taskId?: string): Promise<number> {
    const now = new Date();
    const overdue = await this.prisma.taskOffer.findMany({
      where: { response: null, expiresAt: { lte: now }, ...(taskId && { taskId }) },
      select: { id: true, taskId: true, workerId: true },
      take: 500,
    });
    if (overdue.length === 0) return 0;
    await this.prisma.taskOffer.updateMany({
      where: { id: { in: overdue.map((o) => o.id) }, response: null },
      data: { response: 'EXPIRED' },
    });
    for (const o of overdue) {
      this.publisher.toUser(o.workerId, 'offer:closed', { offerId: o.id, taskId: o.taskId, reason: 'EXPIRED' });
    }
    return overdue.length;
  }

  /**
   * Called after a decline. When nobody in the current wave is still
   * deciding, the next wave goes out now rather than when the tier timer
   * fires — the founder's "next wider wave immediately" rule.
   */
  async advanceIfWaveDone(taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, assignedWorkerId: true, currentRadiusMeters: true },
    });
    if (!task || task.assignedWorkerId || !OPEN_TASK_STATUSES.includes(task.status as (typeof OPEN_TASK_STATUSES)[number])) return;

    const stillDeciding = await this.prisma.taskOffer.count({
      where: { taskId, response: null, expiresAt: { gt: new Date() } },
    });
    if (stillDeciding > 0) return;

    const radii = loadEnv().MATCH_TIER_RADII_M;
    const nextTier = radii.indexOf(task.currentRadiusMeters) + 1;
    if (nextTier <= 0 || nextTier >= radii.length) return;
    this.logger.log(`Task ${taskId}: wave answered in full; sending tier ${nextTier + 1} now.`);
    await this.queue.advanceNow(taskId, nextTier);
  }

  private async closeOpen(taskId: string, reason: OfferClosedReason): Promise<void> {
    const open = await this.prisma.taskOffer.findMany({
      where: { taskId, response: null },
      select: { id: true, workerId: true },
    });
    if (open.length === 0) return;
    await this.prisma.taskOffer.updateMany({
      where: { id: { in: open.map((o) => o.id) }, response: null },
      data: { response: 'EXPIRED' },
    });
    for (const o of open) this.publisher.toUser(o.workerId, 'offer:closed', { offerId: o.id, taskId, reason });
  }

  /** Each open request for these workers on this task, with whose it is (kept out of the view itself). */
  private async buildViews(taskId: string, workerIds: string[]): Promise<{ workerId: string; view: OfferView }[]> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        taskLat: true,
        taskLng: true,
        taskAddress: true,
        dropoffLat: true,
        dropoffLng: true,
        dropoffAddress: true,
        deadlineAt: true,
        workerPayoutPaise: true,
        itemBudgetPaise: true,
        category: { select: { slug: true, name: true } },
        // Public projection only, as in the feed. See docs/12-trust-safety.md.
        requester: { select: { displayName: true, verificationLevel: true } },
        offers: {
          where: { workerId: { in: workerIds }, response: null },
          select: { id: true, workerId: true, distanceMeters: true, expiresAt: true },
        },
      },
    });
    if (!task) return [];

    let dropoff: OfferView['dropoff'] = null;
    if (task.dropoffAddress && task.dropoffLat !== null && task.dropoffLng !== null) {
      const trip = await this.geo.distanceBetween(
        { lat: task.taskLat, lng: task.taskLng },
        { lat: task.dropoffLat, lng: task.dropoffLng },
      );
      dropoff = { approximateAddress: approximateAddress(task.dropoffAddress), tripDistanceMeters: Math.round(trip) };
    }

    return task.offers
      .filter((o) => o.expiresAt !== null)
      .map((o) => ({
        workerId: o.workerId,
        view: {
        offerId: o.id,
        taskId: task.id,
        title: task.title,
        categorySlug: task.category.slug,
        categoryName: task.category.name,
        payoutPaise: Number(task.workerPayoutPaise),
        itemBudgetPaise: Number(task.itemBudgetPaise),
        distanceMeters: Math.round(o.distanceMeters),
        approximateAddress: approximateAddress(task.taskAddress),
        dropoff,
        deadlineAt: task.deadlineAt.toISOString(),
        expiresAt: (o.expiresAt as Date).toISOString(),
        windowSeconds: loadEnv().OFFER_RESPONSE_SECONDS,
        requester: task.requester,
        },
      }));
  }
}
