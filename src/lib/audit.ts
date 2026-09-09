import { db } from '@/db/client';
import { auditLogs } from '@/db/schema';
import { nanoid } from 'nanoid';

export async function recordAudit(params: {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogs).values({
    id: nanoid(),
    actorUserId: params.actorUserId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null
  });
}
