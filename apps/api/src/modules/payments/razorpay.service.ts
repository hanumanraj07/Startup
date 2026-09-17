import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import Razorpay from 'razorpay';
import { loadEnv } from '../../config/env';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

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
