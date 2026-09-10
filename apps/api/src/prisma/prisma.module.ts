import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GeoRepository } from '../repositories/geo.repository';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    // GeoRepository takes a PrismaClient; PrismaService extends it.
    { provide: PrismaClient, useExisting: PrismaService },
    GeoRepository,
  ],
  exports: [PrismaService, PrismaClient, GeoRepository],
})
export class PrismaModule {}
