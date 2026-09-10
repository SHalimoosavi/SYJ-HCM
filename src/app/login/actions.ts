'use server';

import { headers } from 'next/headers';
import { db, withSqliteTransactionSync } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/lib/password';
import { createSessionRecordInTransaction, setSessionCookieForRecord } from '@/lib/session';
import { recordAudit, recordAuditSync } from '@/lib/audit';
import {
  checkLoginRateLimit,
  clearLoginFailures,
  getLoginRateLimitKey,
  recordFailedLogin
} from '@/lib/login-rate-limit';
import { redirect } from 'next/navigation';

export type LoginState = { error: string | null };

function getClientAddress(headerStore: Headers): string {
  const forwarded = headerStore.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return headerStore.get('x-real-ip')?.trim() || 'unknown';
}

async function recordFailedAttempt(key: string, rateLimited: boolean): Promise<void> {
  try {
    await recordAudit({
      actorUserId: null,
      action: 'login_failed',
      entityType: 'auth',
      entityId: key,
      metadata: { reason: 'invalid_credentials', rateLimited }
    });
  } catch {
    // Authentication failure logging must never reveal whether an account exists.
  }
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const headerStore = await headers();
  const clientAddress = getClientAddress(headerStore);
  const rateLimitKey = getLoginRateLimitKey(email, clientAddress);
  const genericError = 'Invalid email or password.';

  try {
    const rateStatus = checkLoginRateLimit(rateLimitKey);
    if (!rateStatus.allowed) {
      await recordFailedAttempt(rateLimitKey, true);
      return { error: 'Too many sign-in attempts. Please try again later.' };
    }

    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];

    // Deliberately generic error message - do not reveal whether the email exists.
    if (!user || !user.isActive) {
      recordFailedLogin(rateLimitKey);
      await recordFailedAttempt(rateLimitKey, false);
      return { error: genericError };
    }

    const valid = verifyPassword(password, user.passwordHash, user.passwordSalt);
    if (!valid) {
      const result = recordFailedLogin(rateLimitKey);
      await recordFailedAttempt(rateLimitKey, !result.allowed);
      return result.allowed ? { error: genericError } : { error: 'Too many sign-in attempts. Please try again later.' };
    }

    clearLoginFailures(rateLimitKey);
    const sessionRecord = withSqliteTransactionSync(() => {
      const record = createSessionRecordInTransaction(user.id);
      recordAuditSync({ actorUserId: user.id, action: 'login', entityType: 'user', entityId: user.id });
      return record;
    });
    await setSessionCookieForRecord(sessionRecord);

    redirect('/dashboard');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    console.error('Login action failed:', error);
    return { error: genericError };
  }
}
