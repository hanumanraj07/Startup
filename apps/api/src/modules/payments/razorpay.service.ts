import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import Razorpay from 'razorpay';
import { loadEnv } from '../../config/env';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

/** The fields of a Razorpay refund this codebase reads, from the API or a webhook. */
export interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
  notes?: Record<string, string | number> | unknown[];
}

/** Our refund id, carried on the gateway refund so a retry can find it. */
export const REFUND_REFERENCE_NOTE = 'onsite_refund_id';

/**
 * Thin wrapper around the Razorpay SDK. Kept separate from PaymentsService so
 * that service stays testable against a fake without needing real
 * credentials — nothing outside this file ever imports the `razorpay`
 * package directly.
 */
@Injectable()
export class RazorpayService {
  private client(): Razorpay {
    const env = loadEnv();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    }
    return new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }

  /**
   * Creates a real order against Razorpay's API. The amount is always what
   * the caller (PaymentsService, reading the task's own budget) passes in —
   * this class never reads a client-supplied amount, per
   * docs/16-security-requirements.md.
   */
  async createOrder(params: { amountPaise: number; receipt: string }): Promise<RazorpayOrder> {
    const order = await this.client().orders.create({
      amount: params.amountPaise,
      currency: 'INR',
      receipt: params.receipt,
      // Escrow, not an instant transfer: capture happens once the webhook
      // confirms it, never assumed from a client-side checkout callback.
      payment_capture: true,
    });
    return { id: order.id, amount: Number(order.amount), currency: order.currency };
  }

  /**
   * Refunds part or all of a captured payment, at normal speed (free). Our
   * refund id goes in the notes and the receipt, so a retry after an
   * unanswered call can find the refund instead of sending a second one.
   */
  async createRefund(params: { gatewayPaymentId: string; amountPaise: number; refundId: string }): Promise<RazorpayRefundEntity> {
    const refund = await this.client().payments.refund(params.gatewayPaymentId, {
      amount: params.amountPaise,
      speed: 'normal',
      receipt: `rf-${params.refundId}`.slice(0, 40),
      notes: { [REFUND_REFERENCE_NOTE]: params.refundId },
    });
    return refund as unknown as RazorpayRefundEntity;
  }

  /** A refund on this payment that carries our refund id, if the gateway has one. */
  async findRefund(gatewayPaymentId: string, refundId: string): Promise<RazorpayRefundEntity | null> {
    const list = await this.client().payments.fetchMultipleRefund(gatewayPaymentId, { count: 100 });
    const items = (list.items ?? []) as unknown as RazorpayRefundEntity[];
    return items.find((r) => refundReference(r) === refundId) ?? null;
  }

  async fetchRefund(gatewayPaymentId: string, gatewayRefundId: string): Promise<RazorpayRefundEntity> {
    const refund = await this.client().payments.fetchRefund(gatewayPaymentId, gatewayRefundId);
    return refund as unknown as RazorpayRefundEntity;
  }

  /** The captured payment on an order, for a record that never stored its payment id. */
  async capturedPaymentForOrder(orderId: string): Promise<string | null> {
    const list = await this.client().orders.fetchPayments(orderId);
    const items = (list.items ?? []) as unknown as { id: string; status: string }[];
    return items.find((p) => p.status === 'captured' || p.status === 'refunded')?.id ?? null;
  }

  /**
   * HMAC-SHA256 over the raw webhook body, per Razorpay's own verification
   * scheme. `timingSafeEqual` rather than `===`, so comparing a forged
   * signature doesn't leak timing information about how much of it matched.
   * Length-checked first because `timingSafeEqual` throws on mismatched
   * buffer lengths rather than just returning false.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const env = loadEnv();
    if (!signatureHeader || !env.RAZORPAY_WEBHOOK_SECRET) return false;

    const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  }
}

/** Our refund id on a gateway refund, from its notes. */
export function refundReference(refund: Pick<RazorpayRefundEntity, 'notes'>): string | undefined {
  const notes = refund.notes;
  if (!notes || Array.isArray(notes)) return undefined;
  const value = notes[REFUND_REFERENCE_NOTE];
  return value === undefined ? undefined : String(value);
}
