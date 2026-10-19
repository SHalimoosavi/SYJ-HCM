'use server';

import crypto from 'node:crypto';
import { db, setTenantContext } from '@/db/client';
import { auditLogs, sessions, users } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireUserForAction } from '@/lib/auth';
import { verifyPassword, hashPassword } from '@/lib/password';
import { recordAudit } from '@/lib/audit';
import { createSessionRecordInTransaction, destroyOtherSessionsForUser, setSessionCookieForRecord } from '@/lib/session';

export type ChangePasswordState = { error: string | null; success: boolean };

export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const user = await requireUserForAction();

  const currentPassword = String(formData.get('currentPassword') || '');
  const newPassword = String(formData.get('newPassword') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: 'Please fill in all fields.', success: false };
  }
  if (newPassword.length < 8) {
    return { error: 'New password must be at least 8 characters.', success: false };
  }
  if (newPassword !== confirmPassword) {
    return { error: 'New password and confirmation do not match.', success: false };
  }

  const rows = await db.select().from(users).where(and(eq(users.id, user.id), eq(users.organizationId, user.organizationId))).limit(1);
  const record = rows[0];
  if (!record) {
    return { error: 'Account not found.', success: false };
  }

  const valid = verifyPassword(currentPassword, record.passwordHash, record.passwordSalt);
  if (!valid) {
    return { error: 'Current password is incorrect.', success: false };
  }

  const { hash, salt } = hashPassword(newPassword);
  const now = new Date().toISOString();

  const newSession = await db.transaction(async (tx) => {
    await setTenantContext(tx, user.organizationId);

    // Password rotation invalidates every pre-existing session, including the
    // current one. Delete all old sessions before creating the replacement,
    // keeping the entire rotation atomic inside this transaction.
    await tx
      .delete(sessions)
      .where(
        and(
          eq(sessions.organizationId, user.organizationId),
          eq(sessions.userId, user.id)
        )
      );

    const sessionRecord = await createSessionRecordInTransaction(
      tx,
      user.id,
      user.organizationId
    );

    await tx
      .update(users)
      .set({
        passwordHash: hash,
        passwordSalt: salt,
        updatedAt: now
      })
      .where(
        and(
          eq(users.organizationId, user.organizationId),
          eq(users.id, user.id)
        )
      );

    await tx.insert(auditLogs).values({
      id: crypto.randomUUID(),
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'password_changed',
      entityType: 'user',
      entityId: user.id
    });

    return sessionRecord;
  });

  await setSessionCookieForRecord(newSession);
  return { error: null, success: true };
}

export async function signOutOtherSessionsAction(): Promise<{ count: number }> {
  const user = await requireUserForAction();
  const count = await destroyOtherSessionsForUser(user.id, user.organizationId);
  await recordAudit({
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: 'sessions_revoked',
    entityType: 'user',
    entityId: user.id,
    metadata: { scope: 'other_sessions', count }
  });
  return { count };
}
