import { randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ItemPurchase, Task } from '@prisma/client';
import { cashPurchaseCapPaise, formatPaise, itemTopUpNeeded } from '@onsite/money';
import type { CreateItemPurchaseInput } from '@onsite/validation';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { StorageService } from '../storage/storage.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';
import { PayoutsService, PayoutTransferError } from './payouts.service';

/** A bill can be sent only while the worker is at the pickup with the task under way. */
const BILL_STATUSES = new Set(['ARRIVED', 'IN_PROGRESS']);
/** Wrong handover codes before the code locks and only Report an issue remains. */
const MAX_HANDOVER_ATTEMPTS = 5;
/** Paying a top-up at checkout takes longer than tapping Approve. */
const TOP_UP_GRACE_MS = 15 * 60_000;

export type PurchaseView = Awaited<ReturnType<ItemPurchasesService['view']>>;

/**
 * Buying an item for the requester, P6 (docs/11-payment-flow.md). Replaces
 * P3's "worker pays and reports the cost":
 *
 *   1. At the shop the worker sends the bill: a photo, the amount, what it is,
 *      and how it will be paid. Nothing is paid yet.
 *   2. The requester approves the exact amount within the approval window,
 *      paying a top-up then if the bill is above what is left of the budget,
 *      or rejects it. Unanswered, the worker may withdraw and walk away.
 *   3. Approved, SHOP_UPI: the platform pays the shop's UPI ID from escrow, so
 *      item money goes to a shop, never to a person, and the worker fronts
 *      nothing. WORKER_CASH (the shop takes only cash): the worker pays,
 *      within a cap that rises with their level.
 *   4. At the drop-off the worker enters the requester's handover code. A
 *      cash bill is repaid to the worker at once, not on approval.
 *
 * Once a bill is approved and the code is entered, the item cost cannot be
 * clawed back by a dispute: the requester agreed the amount and confirmed
 * the item. Item money is never commissioned and never counted as earnings
 * (ledger ITEM_PASS_THROUGH / ITEM_REIMBURSABLE).
 */
@Injectable()
export class ItemPurchasesService {
  private readonly logger = new Logger(ItemPurchasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly publisher: RealtimePublisher,
  ) {}

  // ─── Worker ──────────────────────────────────────────────────────────

  async create(taskId: string, workerId: string, input: CreateItemPurchaseInput) {
    const task = await this.requireWorkerTask(taskId, workerId);
    if (Number(task.itemBudgetPaise) <= 0) throw new BusinessRuleError('This task has no item to buy.');
    if (!BILL_STATUSES.has(task.status)) {
      throw new BusinessRuleError('Send the bill from the shop, after confirming you are at the pickup.');
    }

    const open = await this.prisma.itemPurchase.findMany({
      where: { taskId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
    });
    if (open.some((p) => p.status === 'APPROVED')) {
      throw new ConflictError('A bill is already approved for this task.');
    }
    const pending = open.find((p) => p.status === 'PENDING_APPROVAL');
    if (pending && !this.isExpired(pending)) {
      throw new ConflictError('Wait for the requester to answer the bill you sent, or withdraw it first.');
    }

    // The photo must be one this worker uploaded for this task.
    if (!input.billStorageKey.startsWith(`tasks/${taskId}/proofs/${workerId}/`)) {
      throw new BusinessRuleError('Upload the bill photo again.');
    }
    const object = await this.storage.headObject(input.billStorageKey);
    if (!object.exists) throw new BusinessRuleError('The bill photo has not finished uploading. Try again in a moment.');

    const worker = await this.prisma.user.findUniqueOrThrow({
      where: { id: workerId },
      select: { verificationLevel: true },
    });
    if (input.method === 'SHOP_UPI') {
      if (!this.payouts.canPayShops()) {
        throw new BusinessRuleError('Paying the shop directly is not switched on yet. If the shop takes cash, choose cash.');
      }
      // Item money goes to a shop, never to the worker: their own UPI ID is refused.
      const own = await this.prisma.payoutAccount.findFirst({
        where: { userId: workerId, removedAt: null, upiVpa: { equals: input.merchantVpa, mode: 'insensitive' } },
        select: { id: true },
      });
      if (own) throw new BusinessRuleError('That is your own UPI ID. Enter the shop’s UPI ID, from its QR code.');
    } else {
      const cap = cashPurchaseCapPaise(worker.verificationLevel);
      if (input.amountPaise > cap) {
        throw new BusinessRuleError(
          `You can pay at most ${formatPaise(cap)} in cash at your level. Ask the shop for its UPI ID so the bill is paid directly.`,
        );
      }
    }

    const env = loadEnv();
    const available = Number(task.itemBudgetPaise) + Number(task.itemTopUpPaise);
    const purchase = await this.prisma.$transaction(async (tx) => {
      if (pending) {
        await tx.itemPurchase.updateMany({
          where: { id: pending.id, status: 'PENDING_APPROVAL' },
          data: { status: 'CANCELLED', decidedAt: new Date() },
        });
      }
      return tx.itemPurchase.create({
        data: {
          taskId,
          workerId,
          amountPaise: input.amountPaise,
          description: input.description,
          billStorageKey: input.billStorageKey,
          method: input.method,
          merchantVpa: input.method === 'SHOP_UPI' ? input.merchantVpa : null,
          merchantName: input.merchantName || null,
          topUpPaise: itemTopUpNeeded(available, input.amountPaise),
          expiresAt: new Date(Date.now() + env.ITEM_BILL_APPROVAL_MINUTES * 60_000),
        },
      });
    });

    this.changed(task);
    await this.notifySafely(task.requesterId, {
      event: 'ITEM_BILL_SENT',
      taskId,
      taskTitle: task.title,
      amountPaise: input.amountPaise,
      minutes: env.ITEM_BILL_APPROVAL_MINUTES,
    });
    this.logger.log(`Task ${taskId}: bill ${purchase.id} for ${formatPaise(input.amountPaise)} sent (${input.method}).`);
    return this.view(purchase);
  }

  /** The worker withdraws a bill nobody has answered. Not while the requester is paying a top-up for it. */
  async withdraw(taskId: string, purchaseId: string, workerId: string) {
    const task = await this.requireWorkerTask(taskId, workerId);
    const purchase = await this.requirePurchase(task, purchaseId);
    if (purchase.status !== 'PENDING_APPROVAL') throw new ConflictError('This bill has already been answered.');
    if (purchase.topUpGateway && !this.isExpired(purchase)) {
      throw new ConflictError('The requester is paying for this bill right now. Give them a moment.');
    }
    await this.prisma.itemPurchase.updateMany({
      where: { id: purchase.id, status: 'PENDING_APPROVAL', topUpCapturedAt: null },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    this.changed(task);
    return this.view(await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchase.id } }));
  }

  /** Tries the shop payment again after it failed, for example once the shop fixed its UPI ID. */
  async retryShopPayment(taskId: string, purchaseId: string, workerId: string) {
    const task = await this.requireWorkerTask(taskId, workerId);
    const purchase = await this.requirePurchase(task, purchaseId);
    if (purchase.status !== 'APPROVED' || purchase.method !== 'SHOP_UPI') {
      throw new BusinessRuleError('Only an approved UPI bill can be paid again.');
    }
    await this.payShop(purchase.id);
    this.changed(task);
    return this.view(await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchase.id } }));
  }

  /**
   * The shop payment failed and the shop will take cash instead: the worker
   * pays, within their cash cap, and is repaid at the handover. The amount
   * stays exactly what the requester approved.
   */
  async switchToCash(taskId: string, purchaseId: string, workerId: string) {
    const task = await this.requireWorkerTask(taskId, workerId);
    const purchase = await this.requirePurchase(task, purchaseId);
    if (purchase.status !== 'APPROVED' || purchase.method !== 'SHOP_UPI' || purchase.shopPaymentStatus !== 'FAILED') {
      throw new BusinessRuleError('Switch to cash only after the payment to the shop has failed.');
    }
    const worker = await this.prisma.user.findUniqueOrThrow({ where: { id: workerId }, select: { verificationLevel: true } });
    const cap = cashPurchaseCapPaise(worker.verificationLevel);
    if (Number(purchase.amountPaise) > cap) {
      throw new BusinessRuleError(`You can pay at most ${formatPaise(cap)} in cash at your level. Retry the UPI payment instead.`);
    }
    await this.prisma.itemPurchase.updateMany({
      where: { id: purchase.id, method: 'SHOP_UPI', shopPaymentStatus: 'FAILED' },
      data: { method: 'WORKER_CASH', shopPaymentStatus: null, shopPaymentFailureReason: null },
    });
    this.changed(task);
    return this.view(await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchase.id } }));
  }

  // ─── Requester ───────────────────────────────────────────────────────

  /**
   * Approves the exact amount on the bill. With a top-up the approval
   * completes once the top-up is captured: at once on the mock provider; on
   * Razorpay after checkout, by its webhook, which the client sees by
   * reading the bill again (`get` finishes a funded approval).
   */
  async approve(taskId: string, purchaseId: string, requesterId: string) {
    const task = await this.requireRequesterTask(taskId, requesterId);
    const purchase = await this.requirePurchase(task, purchaseId);
    if (purchase.status === 'APPROVED') return { purchase: this.view(purchase) };
    if (purchase.status !== 'PENDING_APPROVAL') throw new ConflictError('This bill was withdrawn or already answered.');
    if (this.isExpired(purchase) && !purchase.topUpGateway) {
      throw new BusinessRuleError('This bill was not answered in time. Ask the worker in chat to send it again.');
    }
    if (task.assignedWorkerId !== purchase.workerId || !BILL_STATUSES.has(task.status)) {
      throw new BusinessRuleError('This bill no longer applies to the task.');
    }

    if (Number(purchase.topUpPaise) > 0 && !purchase.topUpCapturedAt) {
      // Paying takes longer than a tap; the bill stays open while they do.
      await this.prisma.itemPurchase.update({
        where: { id: purchase.id },
        data: { expiresAt: new Date(Date.now() + TOP_UP_GRACE_MS) },
      });
      const topUp = await this.payments.startTopUp(purchase.id);
      if (!topUp.captured) {
        return {
          purchase: this.view(await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchase.id } })),
          topUp: { amountPaise: Number(purchase.topUpPaise), razorpay: topUp.razorpay },
        };
      }
    }

    await this.finalizeApproval(purchase.id);
    return { purchase: this.view(await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchase.id } })) };
  }

  async reject(taskId: string, purchaseId: string, requesterId: string, reason?: string) {
    const task = await this.requireRequesterTask(taskId, requesterId);
    const purchase = await this.requirePurchase(task, purchaseId);
    if (purchase.status !== 'PENDING_APPROVAL') throw new ConflictError('This bill was withdrawn or already answered.');
    const updated = await this.prisma.itemPurchase.updateMany({
      // A top-up already paid means it is being approved; it cannot be turned down halfway.
      where: { id: purchase.id, status: 'PENDING_APPROVAL', topUpCapturedAt: null },
      data: { status: 'REJECTED', decidedAt: new Date(), rejectReason: reason ?? null },
    });
    if (updated.count === 0) throw new ConflictError('This bill changed a moment ago. Refresh to see it.');
    this.changed(task);
    await this.notifySafely(purchase.workerId, {
      event: 'ITEM_BILL_DECIDED',
      taskId,
      taskTitle: task.title,
      amountPaise: Number(purchase.amountPaise),
      approved: false,
    });
    return this.view(await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchase.id } }));
  }

  // ─── Both parties ────────────────────────────────────────────────────

  /** The task's bills, newest first, for the requester or the assigned worker. */
  async list(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || (task.requesterId !== userId && task.assignedWorkerId !== userId)) {
      throw new NotFoundError('Task not found.');
    }
    // A top-up captured by webhook completes its approval on the next read.
    const funded = await this.prisma.itemPurchase.findMany({
      where: { taskId, status: 'PENDING_APPROVAL', topUpCapturedAt: { not: null } },
      select: { id: true },
    });
    for (const { id } of funded) await this.finalizeApproval(id);

    const purchases = await this.prisma.itemPurchase.findMany({
      // The assigned worker sees only their own bills, never an earlier worker's.
      where: { taskId, ...(task.requesterId === userId ? {} : { workerId: userId }) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return Promise.all(purchases.map(async (p) => ({ ...this.view(p), billUrl: await this.storage.presignGet(p.billStorageKey) })));
  }

  // ─── Called by submission and disputes ───────────────────────────────

  /**
   * The handover at the drop-off. Required when a bill was approved: the
   * code the requester (or whoever they sent it to) gives on receiving the
   * item. Entering it repays a cash bill to the worker straight away.
   * Locked after MAX_HANDOVER_ATTEMPTS wrong codes.
   */
  async confirmHandover(task: Task, workerId: string, code: string | undefined): Promise<void> {
    const approved = await this.prisma.itemPurchase.findFirst({ where: { taskId: task.id, status: 'APPROVED' } });
    if (!approved || task.handoverConfirmedAt) return;

    if (approved.method === 'SHOP_UPI' && approved.shopPaymentStatus !== 'PROCESSED') {
      throw new BusinessRuleError('The payment to the shop has not gone through yet. Retry it, or switch to cash.');
    }
    if (task.handoverAttempts >= MAX_HANDOVER_ATTEMPTS) {
      throw new BusinessRuleError('Too many wrong handover codes. Use Report an issue and support will help.');
    }
    if (!code) throw new BusinessRuleError('Enter the 4-digit handover code from the person receiving the item.');
    if (code !== task.handoverCode) {
      const left = MAX_HANDOVER_ATTEMPTS - task.handoverAttempts - 1;
      await this.prisma.task.update({ where: { id: task.id }, data: { handoverAttempts: { increment: 1 } } });
      throw new BusinessRuleError(
        left > 0
          ? `That handover code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That handover code is not right, and it is now locked. Use Report an issue.',
      );
    }

    await this.prisma.task.update({ where: { id: task.id }, data: { handoverConfirmedAt: new Date() } });
    if (approved.method === 'WORKER_CASH') {
      await this.settleCash(approved.id);
      await this.payouts.sendOwed(workerId);
    }
  }

  /**
   * Before a dispute pays the worker (release or split): an approved cash
   * bill not yet repaid becomes owed to them. Their payment to the shop was
   * agreed by the requester. A full refund does not call this; that is the
   * admin deciding the item never arrived.
   */
  async settleApprovedCash(taskId: string): Promise<void> {
    const approved = await this.prisma.itemPurchase.findFirst({
      where: { taskId, status: 'APPROVED', method: 'WORKER_CASH', spentRecordedAt: null },
    });
    if (approved) await this.settleCash(approved.id);
  }

  /** Whether the task has a bill the requester has agreed to, for the leave rule. */
  async hasApproved(taskId: string): Promise<boolean> {
    return (await this.prisma.itemPurchase.count({ where: { taskId, status: 'APPROVED' } })) > 0;
  }

  /** An unanswered bill dies with the assignment: the next worker sends their own. */
  async cancelPending(taskId: string): Promise<void> {
    await this.prisma.itemPurchase.updateMany({
      where: { taskId, status: 'PENDING_APPROVAL', topUpCapturedAt: null },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private async finalizeApproval(purchaseId: string): Promise<void> {
    const purchase = await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchaseId }, include: { task: true } });
    if (purchase.status !== 'PENDING_APPROVAL') return;
    if (Number(purchase.topUpPaise) > 0 && !purchase.topUpCapturedAt) return;

    const approved = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.itemPurchase.updateMany({
        where: { id: purchase.id, status: 'PENDING_APPROVAL' },
        data: { status: 'APPROVED', decidedAt: new Date() },
      });
      if (moved.count === 0) return false;
      await tx.task.update({
        where: { id: purchase.taskId },
        data: {
          itemSpentPaise: purchase.amountPaise,
          handoverCode: purchase.task.handoverCode ?? String(randomInt(0, 10_000)).padStart(4, '0'),
        },
      });
      return true;
    });
    if (!approved) return;

    if (purchase.method === 'SHOP_UPI') await this.payShop(purchase.id);
    this.changed(purchase.task);
    await this.notifySafely(purchase.workerId, {
      event: 'ITEM_BILL_DECIDED',
      taskId: purchase.taskId,
      taskTitle: purchase.task.title,
      amountPaise: Number(purchase.amountPaise),
      approved: true,
    });
    this.logger.log(`Task ${purchase.taskId}: bill ${purchase.id} approved (${purchase.method}).`);
  }

  /**
   * Pays the shop from escrow. Claimed with a conditional update so two
   * callers can never pay twice; the ledger entry is written only once the
   * transfer is confirmed. A failure is recorded for the worker to act on.
   */
  private async payShop(purchaseId: string): Promise<void> {
    const purchase = await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    if (!purchase.merchantVpa) return;
    const claimed = await this.prisma.itemPurchase.updateMany({
      where: {
        id: purchase.id,
        status: 'APPROVED',
        method: 'SHOP_UPI',
        OR: [{ shopPaymentStatus: null }, { shopPaymentStatus: 'FAILED' }],
      },
      data: { shopPaymentStatus: 'PROCESSING', shopPaymentAttempts: { increment: 1 }, shopPaymentFailureReason: null },
    });
    if (claimed.count === 0) return;

    const amountPaise = Number(purchase.amountPaise);
    try {
      const { reference } = await this.payouts.payShop({ purchaseId: purchase.id, amountPaise, vpa: purchase.merchantVpa });
      await this.prisma.$transaction(async (tx) => {
        await tx.itemPurchase.update({
          where: { id: purchase.id },
          data: { shopPaymentStatus: 'PROCESSED', shopPaymentReference: reference, spentRecordedAt: new Date() },
        });
        await this.ledger.recordItemSpend({ taskId: purchase.taskId, amountPaise, route: 'SHOP' }, tx);
      });
      this.logger.log(`Bill ${purchase.id}: ${formatPaise(amountPaise)} paid to ${purchase.merchantVpa} (${reference}).`);
    } catch (error) {
      const reason =
        error instanceof PayoutTransferError ? error.message : 'The payment to the shop did not go through. Try again.';
      await this.prisma.itemPurchase.update({
        where: { id: purchase.id },
        data: { shopPaymentStatus: 'FAILED', shopPaymentFailureReason: reason },
      });
      this.logger.warn(`Bill ${purchase.id}: shop payment failed: ${reason}`);
    }
  }

  /** A cash bill becomes owed to the worker, once: out of escrow, into a reimbursement payout. */
  private async settleCash(purchaseId: string): Promise<void> {
    const purchase = await this.prisma.itemPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    const amountPaise = Number(purchase.amountPaise);
    const recorded = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.itemPurchase.updateMany({
        where: { id: purchase.id, status: 'APPROVED', method: 'WORKER_CASH', spentRecordedAt: null },
        data: { spentRecordedAt: new Date() },
      });
      if (claimed.count === 0) return false;
      await this.ledger.recordItemSpend({ taskId: purchase.taskId, amountPaise, route: 'CASH' }, tx);
      return true;
    });
    if (recorded) {
      await this.payouts.recordReimbursement({
        taskId: purchase.taskId,
        workerId: purchase.workerId,
        purchaseId: purchase.id,
        amountPaise,
      });
    }
  }

  /** Pending past its window. A bill whose top-up checkout has started stays open for its grace period. */
  private isExpired(purchase: Pick<ItemPurchase, 'status' | 'expiresAt'>): boolean {
    return purchase.status === 'PENDING_APPROVAL' && purchase.expiresAt.getTime() < Date.now();
  }

  view(p: ItemPurchase) {
    return {
      id: p.id,
      amountPaise: Number(p.amountPaise),
      description: p.description,
      method: p.method,
      merchantVpa: p.merchantVpa,
      merchantName: p.merchantName,
      status: this.isExpired(p) ? ('EXPIRED' as const) : p.status,
      expiresAt: p.expiresAt.toISOString(),
      decidedAt: p.decidedAt?.toISOString() ?? null,
      rejectReason: p.rejectReason,
      topUpPaise: Number(p.topUpPaise),
      topUpPaid: p.topUpCapturedAt !== null,
      shopPayment:
        p.method === 'SHOP_UPI' && p.shopPaymentStatus
          ? { status: p.shopPaymentStatus, reference: p.shopPaymentReference, failureReason: p.shopPaymentFailureReason }
          : null,
      paidOut: p.spentRecordedAt !== null,
      createdAt: p.createdAt.toISOString(),
    };
  }

  /** Both parties' task pages reload on a task:status event, so a bill change reuses it. */
  private changed(task: Pick<Task, 'id' | 'status'>): void {
    this.publisher.toTask(task.id, 'task:status', { taskId: task.id, status: task.status });
  }

  private async requireWorkerTask(taskId: string, workerId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task not found.');
    if (task.assignedWorkerId !== workerId) throw new ForbiddenError('This task is not assigned to you.');
    return task;
  }

  private async requireRequesterTask(taskId: string, requesterId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.requesterId !== requesterId) throw new NotFoundError('Task not found.');
    return task;
  }

  private async requirePurchase(task: Task, purchaseId: string) {
    const purchase = await this.prisma.itemPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.taskId !== task.id) throw new NotFoundError('Bill not found.');
    return purchase;
  }

  private async notifySafely(userId: string, payload: Parameters<NotificationService['notify']>[1]): Promise<void> {
    try {
      await this.notifications.notify(userId, payload);
    } catch (error) {
      this.logger.warn(`Bill notification for ${userId} failed: ${String(error)}`);
    }
  }
}
