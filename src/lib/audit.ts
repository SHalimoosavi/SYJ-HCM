import { db, sqlite } from '@/db/client';
import { auditLogs } from '@/db/schema';
import { nanoid } from 'nanoid';

export type AuditParams = {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
};

function serializeMetadata(metadata?: Record<string, unknown>): string | null {
  if (!metadata) return null;
  return JSON.stringify(metadata);
}

export async function recordAudit(params: AuditParams): Promise<void> {
  await db.insert(auditLogs).values({
    id: nanoid(),
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: serializeMetadata(params.metadata)
  });
}

/**
 * Synchronous audit insert for short SQLite transactions. Do not call this
 * outside a transaction when the surrounding business operation requires
 * atomic audit + state changes.
 */
export function recordAuditSync(params: AuditParams): void {
  sqlite
    .prepare(`
      INSERT INTO audit_logs
        (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      nanoid(),
      params.organizationId,
      params.actorUserId,
      params.action,
      params.entityType,
      params.entityId,
      serializeMetadata(params.metadata)
    );
}
