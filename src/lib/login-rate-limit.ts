import { createHmac } from 'node:crypto';
import { sqlite } from '@/db/client';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
  }
  return secret;
}

export function getLoginRateLimitKey(email: string, clientAddress: string): string {
  return createHmac('sha256', getSecret()).update(`${email}\n${clientAddress}`).digest('hex');
}

function normalizeWindow(nowMs: number, startedAt: string): boolean {
  const startedMs = new Date(startedAt).getTime();
  return !Number.isFinite(startedMs) || nowMs - startedMs >= WINDOW_MS;
}

export type LoginRateLimitStatus = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export function checkLoginRateLimit(key: string, now = new Date()): LoginRateLimitStatus {
  const row = sqlite
    .prepare('SELECT failed_attempts, window_started_at, locked_until FROM login_rate_limits WHERE key = ?')
    .get(key) as { failed_attempts: number; window_started_at: string; locked_until: string | null } | undefined;

  if (!row) return { allowed: true, retryAfterSeconds: 0 };

  const nowMs = now.getTime();
  if (normalizeWindow(nowMs, row.window_started_at)) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (row.locked_until) {
    const lockedMs = new Date(row.locked_until).getTime();
    if (Number.isFinite(lockedMs) && lockedMs > nowMs) {
      return { allowed: false, retryAfterSeconds: Math.ceil((lockedMs - nowMs) / 1000) };
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailedLogin(key: string, now = new Date()): LoginRateLimitStatus {
  const nowIso = now.toISOString();
  const windowStartedIso = new Date(now.getTime()).toISOString();

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.prepare('DELETE FROM login_rate_limits WHERE updated_at < ?').run(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
    const existing = sqlite
      .prepare('SELECT failed_attempts, window_started_at, locked_until FROM login_rate_limits WHERE key = ?')
      .get(key) as { failed_attempts: number; window_started_at: string; locked_until: string | null } | undefined;

    let attempts = 1;
    let windowStarted = windowStartedIso;

    if (existing && !normalizeWindow(now.getTime(), existing.window_started_at)) {
      attempts = existing.failed_attempts + 1;
      windowStarted = existing.window_started_at;
    }

    const lockedUntil = attempts >= MAX_FAILURES
      ? new Date(now.getTime() + LOCKOUT_MS).toISOString()
      : null;

    sqlite
      .prepare(`
        INSERT INTO login_rate_limits
          (key, failed_attempts, window_started_at, locked_until, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          failed_attempts = excluded.failed_attempts,
          window_started_at = excluded.window_started_at,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at
      `)
      .run(key, attempts, windowStarted, lockedUntil, nowIso);

    sqlite.exec('COMMIT');
    return lockedUntil
      ? { allowed: false, retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000) }
      : { allowed: true, retryAfterSeconds: 0 };
  } catch (error) {
    try {
      sqlite.exec('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

export function clearLoginFailures(key: string): void {
  sqlite.prepare('DELETE FROM login_rate_limits WHERE key = ?').run(key);
}
