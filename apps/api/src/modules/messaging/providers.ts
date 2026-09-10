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

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export const emailProviderFactory = {
  provide: EMAIL_PROVIDER,
  useFactory: (): EmailProvider => {
    const env = loadEnv();
    // console is the only implemented driver today; smtp/resend are declared
    // in the env schema for Phase 8 and validated there, not wired here yet.
    if (env.EMAIL_PROVIDER !== 'console') {
      throw new Error(`EMAIL_PROVIDER=${env.EMAIL_PROVIDER} has no driver yet. Use "console".`);
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
