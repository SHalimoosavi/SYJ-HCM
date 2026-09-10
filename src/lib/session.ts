import { cookies } from 'next/headers';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { db, sqlite } from '@/db/client';
import { sessions, users } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { isSessionActive, SESSION_ABSOLUTE_TTL_MS, SESSION_TOUCH_INTERVAL_MS } from './session-policy';

const COOKIE_NAME = 'syj_session';

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
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

function makeSessionRecord(): { id: string; expiresAt: string; lastActiveAt: string } {
  const sessionId = randomBytes(32).toString('hex');
  const now = Date.now();
  return {
    id: sessionId,
    expiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS).toISOString(),
    lastActiveAt: new Date(now).toISOString()
  };
}

async function setSessionCookie(sessionId: string, expiresAt: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sign(sessionId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt)
  });
}

export async function createSession(userId: string, organizationId: string): Promise<void> {
  const record = makeSessionRecord();
  await db.insert(sessions).values({
    id: record.id,
    organizationId,
    userId,
    expiresAt: record.expiresAt,
    lastActiveAt: record.lastActiveAt
  });
  await setSessionCookie(record.id, record.expiresAt);
}

export function createSessionRecordInTransaction(userId: string, organizationId: string): { id: string; expiresAt: string; lastActiveAt: string } {
  const record = makeSessionRecord();
  sqlite
    .prepare(`
      INSERT INTO sessions (id, organization_id, user_id, expires_at, last_active_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(record.id, organizationId, userId, record.expiresAt, record.lastActiveAt);
  return record;
}

export async function setSessionCookieForRecord(record: { id: string; expiresAt: string }): Promise<void> {
  await setSessionCookie(record.id, record.expiresAt);
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (raw) {
    const sessionId = verify(raw);
    if (sessionId) {
      const sessionRows = await db
        .select({ organizationId: sessions.organizationId })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      const organizationId = sessionRows[0]?.organizationId;
      if (organizationId) {
        await db.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, organizationId)));
      }
    }
  }
  cookieStore.delete(COOKIE_NAME);
}

export async function destroyAllSessionsForUser(userId: string, organizationId: string): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.organizationId, organizationId)));
}

export async function destroyOtherSessionsForUser(userId: string, organizationId: string): Promise<number> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  const currentSessionId = raw ? verify(raw) : null;
  if (!currentSessionId) return 0;

  const result = sqlite
    .prepare('DELETE FROM sessions WHERE organization_id = ? AND user_id = ? AND id <> ?')
    .run(organizationId, userId, currentSessionId);
  return Number(result.changes);
}

export type CurrentUser = {
  id: string;
  email: string;
  role: 'admin' | 'hr' | 'employee';
  employeeId: string | null;
  organizationId: string;
};

/**
 * Resolves the currently authenticated user from the session cookie.
 * Sessions have both a seven-day absolute lifetime and a 24-hour idle
 * lifetime. Activity refreshes the DB-backed idle timestamp at most every
 * five minutes, while the browser cookie remains bounded by the absolute
 * seven-day expiry.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const sessionId = verify(raw);
  if (!sessionId) return null;

  const rows = await db
    .select({
      sessionOrganizationId: sessions.organizationId,
      userOrganizationId: users.organizationId,
      sessionExpiresAt: sessions.expiresAt,
      sessionLastActiveAt: sessions.lastActiveAt,
      userId: users.id,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      employeeId: users.employeeId
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, users.organizationId)))
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive || row.sessionOrganizationId !== row.userOrganizationId) return null;

  const now = Date.now();
  const lastActive = new Date(row.sessionLastActiveAt).getTime();
  if (!isSessionActive(now, row.sessionLastActiveAt, row.sessionExpiresAt)) {
    return null;
  }

  if (now - lastActive >= SESSION_TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastActiveAt: new Date(now).toISOString() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, row.sessionOrganizationId)));
  }

  return {
    id: row.userId,
    email: row.email,
    role: row.role,
    employeeId: row.employeeId,
    organizationId: row.userOrganizationId
  };
}
