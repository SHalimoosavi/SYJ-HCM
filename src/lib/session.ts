import { cookies } from 'next/headers';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { db, sql, setTenantContext, type DbTransaction } from '@/db/client';
import { organizations, sessions, users } from '@/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { isSessionActive, SESSION_ABSOLUTE_TTL_MS, SESSION_TOUCH_INTERVAL_MS } from './session-policy';

const COOKIE_NAME = 'syj_session';

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
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
  return { id: sessionId, expiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS).toISOString(), lastActiveAt: new Date(now).toISOString() };
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
  await db.transaction(async (tx) => {
    await setTenantContext(tx, organizationId);
    await tx.insert(sessions).values({ id: record.id, organizationId, userId, expiresAt: record.expiresAt, lastActiveAt: record.lastActiveAt });
  });
  await setSessionCookie(record.id, record.expiresAt);
}

export async function createSessionRecordInTransaction(tx: DbTransaction, userId: string, organizationId: string): Promise<{ id: string; expiresAt: string; lastActiveAt: string }> {
  const record = makeSessionRecord();
  await setTenantContext(tx, organizationId);
  await tx.insert(sessions).values({ id: record.id, organizationId, userId, expiresAt: record.expiresAt, lastActiveAt: record.lastActiveAt });
  return record;
}

export async function setSessionCookieForRecord(record: { id: string; expiresAt: string }): Promise<void> {
  await setSessionCookie(record.id, record.expiresAt);
}

async function resolveSessionBootstrap(sessionId: string): Promise<{ organizationId: string; userId: string } | null> {
  const rows = await sql<{ organization_id: string; user_id: string }[]>`
    SELECT organization_id, user_id
    FROM resolve_session(${sessionId})
  `;
  const row = rows[0];
  return row ? { organizationId: row.organization_id, userId: row.user_id } : null;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (raw) {
    const sessionId = verify(raw);
    if (sessionId) {
      const bootstrap = await resolveSessionBootstrap(sessionId);
      if (bootstrap) {
        await db.transaction(async (tx) => {
          await setTenantContext(tx, bootstrap.organizationId);
          await tx.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, bootstrap.organizationId)));
        });
      }
    }
  }
  cookieStore.delete(COOKIE_NAME);
}

export async function destroyAllSessionsForUser(userId: string, organizationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await setTenantContext(tx, organizationId);
    await tx.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.organizationId, organizationId)));
  });
}

export async function destroyOtherSessionsForUser(userId: string, organizationId: string): Promise<number> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  const currentSessionId = raw ? verify(raw) : null;
  if (!currentSessionId) return 0;

  return db.transaction(async (tx) => {
    await setTenantContext(tx, organizationId);
    const deleted = await tx.delete(sessions)
      .where(and(eq(sessions.organizationId, organizationId), eq(sessions.userId, userId), ne(sessions.id, currentSessionId)))
      .returning({ id: sessions.id });
    return deleted.length;
  });
}

export type CurrentUser = {
  id: string;
  email: string;
  role: 'admin' | 'hr' | 'employee';
  employeeId: string | null;
  organizationId: string;
  organizationStatus: 'active' | 'suspended';
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const sessionId = verify(raw);
  if (!sessionId) return null;

  const bootstrap = await resolveSessionBootstrap(sessionId);
  if (!bootstrap) return null;

  return db.transaction(async (tx) => {
    await setTenantContext(tx, bootstrap.organizationId);
    const rows = await tx
      .select({
        sessionOrganizationId: sessions.organizationId,
        userOrganizationId: users.organizationId,
        sessionExpiresAt: sessions.expiresAt,
        sessionLastActiveAt: sessions.lastActiveAt,
        userId: users.id,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        employeeId: users.employeeId,
        organizationStatus: organizations.status
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, users.organizationId)))
      .limit(1);

    const row = rows[0];
    if (!row || !row.isActive || row.sessionOrganizationId !== row.userOrganizationId) return null;
    const now = Date.now();
    if (!isSessionActive(now, row.sessionLastActiveAt, row.sessionExpiresAt)) return null;

    if (now - new Date(row.sessionLastActiveAt).getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      await tx.update(sessions)
        .set({ lastActiveAt: new Date(now).toISOString() })
        .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, row.sessionOrganizationId)));
    }

    return {
      id: row.userId,
      email: row.email,
      role: row.role,
      employeeId: row.employeeId,
      organizationId: row.userOrganizationId,
      organizationStatus: row.organizationStatus
    };
  });
}
