'use server';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/lib/password';
import { createSession } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { redirect } from 'next/navigation';

export type LoginState = { error: string | null };

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Deliberately generic error message - do not reveal whether the email exists.
  const genericError = 'Invalid email or password.';

  if (!user || !user.isActive) {
    return { error: genericError };
  }

  const valid = verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!valid) {
    return { error: genericError };
  }

  await createSession(user.id);
  await recordAudit({
    actorUserId: user.id,
    action: 'login',
    entityType: 'user',
    entityId: user.id
  });

  redirect('/dashboard');
}
