import { db, setTenantContext } from '@/db/client';
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
  return metadata ? JSON.stringify(metadata) : null;
}

export async function recordAudit(params: AuditParams): Promise<void> {
  await db.transaction(async (tx) => {
    await setTenantContext(tx, params.organizationId);
    await tx.insert(auditLogs).values({
      id: nanoid(), organizationId: params.organizationId, actorUserId: params.actorUserId,
      action: params.action, entityType: params.entityType, entityId: params.entityId,
      metadata: serializeMetadata(params.metadata)
    });
  });
}

/**
 * Compatibility marker for application code that has not yet been migrated in
 * Foundation A. PostgreSQL is asynchronous, so callers must move to
 * `await recordAudit(...)` as part of the application-wide Prompt B refactor.
 */
export function recordAuditSync(_params: AuditParams): never {
  throw new Error('recordAuditSync is unavailable on PostgreSQL; use await recordAudit(...) inside a transaction.');
}
