import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The one place every admin write is recorded. docs/15-admin-panel.md:
 * "Every admin write produces an audit log entry: actor, IP, action, entity,
 * before and after. No exceptions, including manual payment intervention."
 * `AuditLog` is append-only — nothing in this codebase ever updates or
 * deletes a row here, including admin tooling itself (docs/15's "deliberately
 * excluded" list).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    actorUserId?: string;
    actorIp?: string;
    action: string;
    entityType: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        actorIp: params.actorIp,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        before: (params.before ?? undefined) as object | undefined,
        after: (params.after ?? undefined) as object | undefined,
      },
    });
  }
}
