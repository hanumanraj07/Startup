import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/encryption.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { VerificationModule } from '../verification/verification.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [StorageModule, AuthModule, VerificationModule],
  controllers: [UsersController],
  providers: [UsersService, EncryptionService],
  exports: [UsersService],
})
export class UsersModule {}
