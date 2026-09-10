-- SYJ-HCM Phase 1.1 follow-up: enforce clock-out ordering on INSERT as well.
-- Existing 0001 migration is intentionally left immutable.

CREATE TRIGGER IF NOT EXISTS attendance_clock_order_insert_guard
BEFORE INSERT ON attendance_records
WHEN NEW.clock_out_at IS NOT NULL AND NEW.clock_in_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Clock-out requires clock-in');
END;
