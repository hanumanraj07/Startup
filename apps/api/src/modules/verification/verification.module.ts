import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/encryption.service';
import { verificationProvider } from '../../config/env';
import { NotificationsModule } from '../notifications/notifications.module';
import { CashfreeVerificationProvider } from './cashfree.provider';
import { MockVerificationProvider } from './mock.provider';
import { VerificationController } from './verification.controller';
import { VERIFICATION_PROVIDER } from './verification.provider';
import { VerificationService } from './verification.service';

/**
 * Identity and payout-account verification. The provider is chosen once at
 * boot from VERIFICATION_PROVIDER; with `none` it is null and every automated
 * check says so instead of pretending. PrismaModule and AuditModule are global.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    EncryptionService,
    {
      provide: VERIFICATION_PROVIDER,
      useFactory: () => {
        const name = verificationProvider();
        if (name === 'cashfree') return new CashfreeVerificationProvider();
        if (name === 'mock') return new MockVerificationProvider();
        return null;
      },
    },
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
