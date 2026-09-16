-- SYJ-HCM Phase 1.1 security hardening
-- Safe to re-run through the migration runner because every object is guarded.

ALTER TABLE sessions ADD COLUMN last_active_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE sessions SET last_active_at = created_at WHERE last_active_at = '1970-01-01 00:00:00';

CREATE TABLE IF NOT EXISTS login_rate_limits (
  key TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);
CREATE INDEX IF NOT EXISTS login_rate_limits_updated_idx ON login_rate_limits(updated_at);

-- Attendance coordinates are sensitive and must remain valid whenever present.
-- Leave requests have an intentionally narrow state machine.
-- Application code never updates or deletes audit records. SQLite also enforces
-- that invariant for direct access through this database connection.
