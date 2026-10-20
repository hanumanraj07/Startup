import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LiveLocationService } from './live-location.service';
import { RealtimeGateway } from './realtime.gateway';

/**
 * PrismaModule (with GeoRepository) is @Global(); TokenService is not, so
 * AuthModule is imported explicitly. RealtimePublisher (which works in the
 * worker process too, with no gateway server) comes from the global
 * RealtimePublisherModule.
 */
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, LiveLocationService],
  exports: [RealtimeGateway, LiveLocationService],
})
export class RealtimeModule {}
