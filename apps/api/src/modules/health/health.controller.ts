import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Liveness and readiness are deliberately separate.
 *
 * Only readiness gates traffic. If liveness checked dependencies too, a brief
 * Redis blip would restart otherwise healthy containers and turn a small
 * incident into an outage.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness. No dependency checks: is this process alive at all? */
  @Public()
  @Get()
  live(): { status: string; role: string; uptimeSeconds: number } {
    return {
      status: 'ok',
      role: process.env.ROLE ?? 'api',
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /** Readiness. Can this instance actually serve a request? */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string; checks: Record<string, boolean> }> {
    const database = await this.prisma.isHealthy();
    const checks = { database };
    const allPassing = Object.values(checks).every(Boolean);

    return { status: allPassing ? 'ready' : 'degraded', checks };
  }
}
