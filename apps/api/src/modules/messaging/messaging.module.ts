import { Global, Module } from '@nestjs/common';
import { EMAIL_PROVIDER, SMS_PROVIDER, emailProviderFactory, smsProviderFactory } from './providers';

@Global()
@Module({
  providers: [emailProviderFactory, smsProviderFactory],
  exports: [EMAIL_PROVIDER, SMS_PROVIDER],
})
export class MessagingModule {}
