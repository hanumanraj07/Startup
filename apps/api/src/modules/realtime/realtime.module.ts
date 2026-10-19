import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LiveLocationService } from './live-location.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.publisher';

/**
 * PrismaModule (with GeoRepository) is @Global(); TokenService is not, so
 * AuthModule is imported explicitly. RealtimePublisher works in the worker
 * process too, which has no gateway server.
 */
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RealtimePublisher, LiveLocationService],
  exports: [RealtimeGateway, RealtimePublisher, LiveLocationService],
})
export class RealtimeModule {}
