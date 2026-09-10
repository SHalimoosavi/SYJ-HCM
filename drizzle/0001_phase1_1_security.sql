-- SYJ-HCM Phase 1.1 security hardening
-- Safe to re-run through the migration runner because every object is guarded.

ALTER TABLE sessions ADD COLUMN last_active_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE sessions SET last_active_at = created_at WHERE last_active_at = '1970-01-01 00:00:00';

CREATE TABLE IF NOT EXISTS login_rate_limits (
  key TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX IF NOT EXISTS login_rate_limits_updated_idx ON login_rate_limits(updated_at);

-- Attendance coordinates are sensitive and must remain valid whenever present.
CREATE TRIGGER IF NOT EXISTS attendance_coordinates_insert_guard
BEFORE INSERT ON attendance_records
WHEN (NEW.clock_in_lat IS NOT NULL AND (NEW.clock_in_lat < -90 OR NEW.clock_in_lat > 90))
  OR (NEW.clock_in_lng IS NOT NULL AND (NEW.clock_in_lng < -180 OR NEW.clock_in_lng > 180))
  OR (NEW.clock_out_lat IS NOT NULL AND (NEW.clock_out_lat < -90 OR NEW.clock_out_lat > 90))
  OR (NEW.clock_out_lng IS NOT NULL AND (NEW.clock_out_lng < -180 OR NEW.clock_out_lng > 180))
  OR ((NEW.clock_in_lat IS NULL) <> (NEW.clock_in_lng IS NULL))
  OR ((NEW.clock_out_lat IS NULL) <> (NEW.clock_out_lng IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'Invalid attendance coordinates');
END;

CREATE TRIGGER IF NOT EXISTS attendance_coordinates_update_guard
BEFORE UPDATE OF clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng ON attendance_records
WHEN (NEW.clock_in_lat IS NOT NULL AND (NEW.clock_in_lat < -90 OR NEW.clock_in_lat > 90))
  OR (NEW.clock_in_lng IS NOT NULL AND (NEW.clock_in_lng < -180 OR NEW.clock_in_lng > 180))
  OR (NEW.clock_out_lat IS NOT NULL AND (NEW.clock_out_lat < -90 OR NEW.clock_out_lat > 90))
  OR (NEW.clock_out_lng IS NOT NULL AND (NEW.clock_out_lng < -180 OR NEW.clock_out_lng > 180))
  OR ((NEW.clock_in_lat IS NULL) <> (NEW.clock_in_lng IS NULL))
  OR ((NEW.clock_out_lat IS NULL) <> (NEW.clock_out_lng IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'Invalid attendance coordinates');
END;

CREATE TRIGGER IF NOT EXISTS attendance_clock_order_guard
BEFORE UPDATE OF clock_in_at, clock_out_at ON attendance_records
WHEN NEW.clock_out_at IS NOT NULL AND NEW.clock_in_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Clock-out requires clock-in');
END;

-- Leave requests have an intentionally narrow state machine.
CREATE TRIGGER IF NOT EXISTS leave_request_transition_guard
BEFORE UPDATE OF status ON leave_requests
WHEN NOT (
  (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
  OR OLD.status = NEW.status
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid leave request state transition');
END;

-- Application code never updates or deletes audit records. SQLite also enforces
-- that invariant for direct access through this database connection.
CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Audit logs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Audit logs are immutable');
END;
