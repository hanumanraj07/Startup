import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountAwareThrottlerGuard } from './common/account-aware-throttler.guard';
import { AuditModule } from './common/audit.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { RedisThrottlerStorage } from './common/redis-throttler-storage';
import { loadEnv } from './config/env';
import { LoggingModule } from './logging/logging.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ChatModule } from './modules/chat/chat.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { HealthModule } from './modules/health/health.module';
import { MatchingModule } from './modules/matching/matching.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SafetyModule } from './modules/safety/safety.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TrustModule } from './modules/trust/trust.module';
import { QueueModule } from './queue/queue.module';
import { UsersModule } from './modules/users/users.module';
import { WorkersModule } from './modules/workers/workers.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Parsed and validated once. The process refuses to boot on bad
      // configuration rather than failing later at an inconvenient moment.
      validate: () => loadEnv(),
    }),
    LoggingModule,
    // A baseline limit. Per-endpoint-class limits from
    // docs/07-api-specification.md are applied on the routes themselves, with
    // the strictest on auth and payments. `storage` is Redis-backed — see
    // RedisThrottlerStorage's comment on why the library's in-memory default
    // is wrong the moment there is more than one API replica.
    //
    // `default`, `account` and `user` must ALL be declared here, at the
    // module level: ThrottlerGuard.canActivate only ever iterates the
    // throttlers named in this array — a route's @Throttle() can override an
    // existing name's limit/ttl, but cannot introduce a name that isn't
    // already registered here. `account` and `user`'s default limits are
    // deliberately huge, so routes that never override them are effectively
    // unthrottled on those dimensions; only the routes that opt in (see
    // AccountAwareThrottlerGuard's own comment for which, and why) bring
    // them down to something real.
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60_000, limit: 300 },
        { name: 'account', ttl: 60_000, limit: 1_000_000 },
        { name: 'user', ttl: 60_000, limit: 1_000_000 },
      ],
      storage: new RedisThrottlerStorage(),
    }),
    PrismaModule,
    AuditModule,
    MessagingModule,
    QueueModule,
    HealthModule,
    CategoriesModule,
    PaymentsModule,
    NotificationsModule,
    RealtimeModule,
    SafetyModule,
    MatchingModule,
    TasksModule,
    ChatModule,
    TrustModule,
    DisputesModule,
    AdminModule,
    // AuthModule registers the global JwtAuthGuard, so every route in every
    // module requires a valid access token unless marked @Public().
    AuthModule,
    UsersModule,
    WorkersModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    // Throttler runs first: even an unauthenticated flood is rate limited
    // before the JWT guard does any work.
    { provide: APP_GUARD, useClass: AccountAwareThrottlerGuard },
  ],
})
export class AppModule {}
