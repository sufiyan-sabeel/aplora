import type { PrismaClient } from "@aplora/database";

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Administrative actions are written to an append-only table. A database trigger
 * blocks UPDATE and DELETE on audit_logs, so history cannot be rewritten even by
 * someone with SQL access.
 */
export async function recordAudit(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: (entry.metadata ?? {}) as object,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
