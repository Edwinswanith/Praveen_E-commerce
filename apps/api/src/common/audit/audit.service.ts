import { Injectable } from '@nestjs/common';
import { PrismaService, type Tx } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: { actorId?: string | null; action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown; ip?: string }, tx?: Tx) {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null, action: entry.action, entity: entry.entity, entityId: entry.entityId ?? null,
        before: entry.before === undefined ? undefined : JSON.parse(JSON.stringify(entry.before)),
        after: entry.after === undefined ? undefined : JSON.parse(JSON.stringify(entry.after)),
        ip: entry.ip,
      },
    });
  }
}
