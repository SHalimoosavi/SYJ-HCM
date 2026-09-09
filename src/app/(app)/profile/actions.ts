'use server';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireUserForAction } from '@/lib/auth';
import { verifyPassword, hashPassword } from '@/lib/password';
import { recordAudit } from '@/lib/audit';

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
  await db
    .update(users)
    .set({ passwordHash: hash, passwordSalt: salt, updatedAt: new Date().toISOString() })
    .where(eq(users.id, user.id));

  await recordAudit({ actorUserId: user.id, action: 'password_changed', entityType: 'user', entityId: user.id });

  return { error: null, success: true };
}
