-- SYJ-HCM Phase 1.1 follow-up: enforce clock-out ordering on INSERT as well.
-- Historical SQLite trigger 0002 is represented as a PostgreSQL trigger here;
-- the final foundation migration recreates the full integrity-trigger set.

CREATE OR REPLACE FUNCTION syj_attendance_clock_order_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.clock_out_at IS NOT NULL AND NEW.clock_in_at IS NULL THEN
    RAISE EXCEPTION 'Clock-out requires clock-in';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_clock_order_insert_guard
BEFORE INSERT ON attendance_records
EXECUTE FUNCTION syj_attendance_clock_order_insert_guard();
