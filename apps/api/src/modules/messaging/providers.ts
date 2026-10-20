import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../config/env';

/**
 * Minimal send-only providers for auth flows: email verification links,
 * password reset links, and phone OTPs.
 *
 * This is deliberately small. The full event-to-channel notification system
 * from docs/13-notification-system.md, with templates, batching and Web
 * Push, is Phase 8. This exists only so Phase 3's auth flows have somewhere
 * to send a message, and the console drivers mean the entire flow — signup,
 * verify email, verify phone, reset password — runs with no third-party
 * account, matching the "everything runs offline" promise in the README.
 */

export interface EmailProvider {
  send(params: { to: string; subject: string; body: string }): Promise<void>;
}

export interface SmsProvider {
  send(params: { to: string; body: string }): Promise<void>;
}

@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('EmailProvider(console)');

  async send(params: { to: string; subject: string; body: string }): Promise<void> {
    this.logger.log(`\n  To:      ${params.to}\n  Subject: ${params.subject}\n  ${params.body}\n`);
  }
}

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SmsProvider(console)');

  async send(params: { to: string; body: string }): Promise<void> {
    this.logger.log(`  To: ${params.to}  ${params.body}`);
  }
}

/**
 * Sends through Resend's HTTP API (docs/22, #6: production had only the
 * console driver, so verification and password-reset emails never left the
 * server). No SDK: one POST. A failure throws, so NotificationService's
 * delivery retries it; auth emails are sent directly and their callers
 * already treat a failure as non-fatal.
 */
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(params: { to: string; subject: string; body: string }): Promise<void> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [params.to], subject: params.subject, text: params.body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend refused the email (${res.status}): ${detail.slice(0, 300)}`);
    }
  }
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export const emailProviderFactory = {
  provide: EMAIL_PROVIDER,
  useFactory: (): EmailProvider => {
    const env = loadEnv();
    if (env.EMAIL_PROVIDER === 'resend') {
      if (!env.RESEND_API_KEY) throw new Error('EMAIL_PROVIDER=resend needs RESEND_API_KEY.');
      return new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
    }
    // smtp is declared in the env schema but has no driver; Resend covers the need.
    if (env.EMAIL_PROVIDER !== 'console') {
      throw new Error(`EMAIL_PROVIDER=${env.EMAIL_PROVIDER} has no driver yet. Use "resend" or "console".`);
    }
    return new ConsoleEmailProvider();
  },
};

export const smsProviderFactory = {
  provide: SMS_PROVIDER,
  useFactory: (): SmsProvider => {
    const env = loadEnv();
    if (env.SMS_PROVIDER !== 'console') {
      throw new Error(`SMS_PROVIDER=${env.SMS_PROVIDER} has no driver yet. Use "console".`);
    }
    return new ConsoleSmsProvider();
  },
};
