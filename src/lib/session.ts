import { cookies } from 'next/headers';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@/db/client';
import { sessions, users } from '@/db/schema';
import { eq } from 'drizzle-orm';

const COOKIE_NAME = 'syj_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET is not configured. Set it in your .env file.');
  }
  return secret;
}

function sign(sessionId: string): string {
  const sig = createHmac('sha256', getSecret()).update(sessionId).digest('hex');
  return `${sessionId}.${sig}`;
}

function verify(cookieValue: string): string | null {
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [sessionId, sig] = parts;
  if (!sessionId || !sig) return null;
  const expected = createHmac('sha256', getSecret()).update(sessionId).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  return sessionId;
}

export async function createSession(userId: string): Promise<void> {
  const sessionId = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await db.insert(sessions).values({ id: sessionId, userId, expiresAt });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sign(sessionId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt)
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (raw) {
    const sessionId = verify(raw);
    if (sessionId) {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    }
  }
  cookieStore.delete(COOKIE_NAME);
}

export type CurrentUser = {
  id: string;
  email: string;
  role: 'admin' | 'hr' | 'employee';
  employeeId: string | null;
};

/**
 * Resolves the currently authenticated user from the session cookie.
 * Returns null if there is no valid, non-expired session. This is the
 * single source of truth for authentication - every server action and
 * page must go through this (or requireUser/requireRole below).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const sessionId = verify(raw);
  if (!sessionId) return null;

  const rows = await db
    .select({
      sessionExpiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      employeeId: users.employeeId
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!row.isActive) return null;
  if (new Date(row.sessionExpiresAt).getTime() < Date.now()) return null;

  return { id: row.userId, email: row.email, role: row.role, employeeId: row.employeeId };
}
