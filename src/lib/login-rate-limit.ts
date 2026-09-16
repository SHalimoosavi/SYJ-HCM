import { createHmac } from 'node:crypto';
import { sql } from '@/db/client';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
  return secret;
}

export function getLoginRateLimitKey(email: string, clientAddress: string, organizationId: string): string {
  return createHmac('sha256', getSecret()).update(`${organizationId}\n${email}\n${clientAddress}`).digest('hex');
}

function normalizeWindow(nowMs: number, startedAt: string): boolean {
  const startedMs = new Date(startedAt).getTime();
  return !Number.isFinite(startedMs) || nowMs - startedMs >= WINDOW_MS;
}

export type LoginRateLimitStatus = { allowed: boolean; retryAfterSeconds: number };

type LoginRateRow = { failed_attempts: number; window_started_at: string; locked_until: string | null };

export async function checkLoginRateLimit(key: string, organizationId: string, now = new Date()): Promise<LoginRateLimitStatus> {
  const rows = await sql<LoginRateRow[]>`
    SELECT failed_attempts, window_started_at, locked_until
    FROM login_rate_limits
    WHERE organization_id = ${organizationId} AND key = ${key}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  const nowMs = now.getTime();
  if (normalizeWindow(nowMs, row.window_started_at)) return { allowed: true, retryAfterSeconds: 0 };
  if (row.locked_until) {
    const lockedMs = new Date(row.locked_until).getTime();
    if (Number.isFinite(lockedMs) && lockedMs > nowMs) return { allowed: false, retryAfterSeconds: Math.ceil((lockedMs - nowMs) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordFailedLogin(key: string, organizationId: string, now = new Date()): Promise<LoginRateLimitStatus> {
  return sql.begin(async (tx) => {
    const nowIso = now.toISOString();
    const windowStartedIso = nowIso;
    await tx`DELETE FROM login_rate_limits WHERE organization_id = ${organizationId} AND updated_at < ${new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()}`;
    const existing = await tx<LoginRateRow[]>`
      SELECT failed_attempts, window_started_at, locked_until
      FROM login_rate_limits
      WHERE organization_id = ${organizationId} AND key = ${key}
      LIMIT 1
    `;
    let attempts = 1;
    let windowStarted = windowStartedIso;
    if (existing[0] && !normalizeWindow(now.getTime(), existing[0].window_started_at)) {
      attempts = existing[0].failed_attempts + 1;
      windowStarted = existing[0].window_started_at;
    }
    const lockedUntil = attempts >= MAX_FAILURES ? new Date(now.getTime() + LOCKOUT_MS).toISOString() : null;
    await tx`
      INSERT INTO login_rate_limits (key, organization_id, failed_attempts, window_started_at, locked_until, updated_at)
      VALUES (${key}, ${organizationId}, ${attempts}, ${windowStarted}, ${lockedUntil}, ${nowIso})
      ON CONFLICT(key) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        failed_attempts = EXCLUDED.failed_attempts,
        window_started_at = EXCLUDED.window_started_at,
        locked_until = EXCLUDED.locked_until,
        updated_at = EXCLUDED.updated_at
    `;
    return lockedUntil ? { allowed: false, retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000) } : { allowed: true, retryAfterSeconds: 0 };
  });
}

export async function clearLoginFailures(key: string, organizationId: string): Promise<void> {
  await sql`DELETE FROM login_rate_limits WHERE organization_id = ${organizationId} AND key = ${key}`;
}
