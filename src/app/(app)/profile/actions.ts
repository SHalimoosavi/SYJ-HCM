'use server';

import { db, sqlite, withSqliteTransactionSync } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireUserForAction } from '@/lib/auth';
import { verifyPassword, hashPassword } from '@/lib/password';
import { recordAudit, recordAuditSync } from '@/lib/audit';
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

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
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

  const newSession = withSqliteTransactionSync(() => {
    const sessionRecord = createSessionRecordInTransaction(user.id);
    // Password rotation invalidates every pre-existing session, including the
    // current one. The transaction immediately creates the replacement.
    const deleteStatement = `DELETE FROM sessions WHERE user_id = ? AND id <> ?`;
    // Keep the replacement session while removing all old sessions.
    sqlite.prepare(deleteStatement).run(user.id, sessionRecord.id);
    sqlite
      .prepare(`
        UPDATE users
        SET password_hash = ?, password_salt = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(hash, salt, now, user.id);
    recordAuditSync({ actorUserId: user.id, action: 'password_changed', entityType: 'user', entityId: user.id });
    return sessionRecord;
  });

  await setSessionCookieForRecord(newSession);
  return { error: null, success: true };
}

export async function signOutOtherSessionsAction(): Promise<{ count: number }> {
  const user = await requireUserForAction();
  const count = await destroyOtherSessionsForUser(user.id);
  await recordAudit({
    actorUserId: user.id,
    action: 'sessions_revoked',
    entityType: 'user',
    entityId: user.id,
    metadata: { scope: 'other_sessions', count }
  });
  return { count };
}
