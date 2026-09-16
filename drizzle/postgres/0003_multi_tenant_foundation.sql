-- SYJ-HCM Phase 1.2a: multi-tenant foundation.
--
-- This migration deliberately rebuilds the existing tables instead of using
-- ADD COLUMN ... NOT NULL DEFAULT. That keeps organization_id genuinely
-- required for every new row after the one-time backfill and preserves the
-- existing foreign-key model. All data is copied before legacy tables are
-- dropped, and the migration runner wraps this file in one transaction.

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);
CREATE UNIQUE INDEX organizations_slug_idx ON organizations(slug);

INSERT INTO organizations (id, name, slug, status)
VALUES ('org_default', 'Default Organization', 'default', 'active');

-- Existing Phase 1.1 triggers are recreated after the table rebuilds.







-- Rename all legacy tables first. SQLite updates foreign-key definitions to
-- the renamed parent tables, allowing the complete graph to be rebuilt inside
-- the same transaction without disabling foreign-key enforcement.
ALTER TABLE departments RENAME TO departments_legacy;
ALTER TABLE employees RENAME TO employees_legacy;
ALTER TABLE users RENAME TO users_legacy;
ALTER TABLE sessions RENAME TO sessions_legacy;
ALTER TABLE login_rate_limits RENAME TO login_rate_limits_legacy;
ALTER TABLE leave_types RENAME TO leave_types_legacy;
ALTER TABLE leave_balances RENAME TO leave_balances_legacy;
ALTER TABLE leave_requests RENAME TO leave_requests_legacy;
ALTER TABLE attendance_records RENAME TO attendance_records_legacy;
ALTER TABLE audit_logs RENAME TO audit_logs_legacy;

-- Legacy index names are global in SQLite. Remove them before recreating the
-- same logical indexes on the tenant-aware tables.
DROP INDEX IF EXISTS employees_code_idx;
DROP INDEX IF EXISTS employees_work_email_idx;
DROP INDEX IF EXISTS employees_department_idx;
DROP INDEX IF EXISTS employees_status_idx;
DROP INDEX IF EXISTS users_email_idx;
DROP INDEX IF EXISTS sessions_user_idx;
DROP INDEX IF EXISTS login_rate_limits_updated_idx;
DROP INDEX IF EXISTS leave_balances_unique;
DROP INDEX IF EXISTS leave_requests_employee_idx;
DROP INDEX IF EXISTS leave_requests_status_idx;
DROP INDEX IF EXISTS attendance_employee_date_idx;
DROP INDEX IF EXISTS attendance_date_idx;
DROP INDEX IF EXISTS audit_entity_idx;
DROP INDEX IF EXISTS audit_actor_idx;

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_code TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  work_email TEXT NOT NULL,
  personal_email TEXT,
  phone TEXT,
  date_of_birth TEXT,
  date_of_joining TEXT NOT NULL,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  designation TEXT NOT NULL,
  employment_status TEXT NOT NULL DEFAULT 'active',
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  manager_id TEXT,
  location TEXT,
  address TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE login_rate_limits (
  key TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE leave_types (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  annual_quota DOUBLE PRECISION NOT NULL,
  is_paid INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE leave_balances (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  allocated DOUBLE PRECISION NOT NULL,
  used DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days DOUBLE PRECISION NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE attendance_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  clock_in_at TEXT,
  clock_out_at TEXT,
  clock_in_lat DOUBLE PRECISION,
  clock_in_lng DOUBLE PRECISION,
  clock_out_lat DOUBLE PRECISION,
  clock_out_lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'present',
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

-- Backfill all existing rows into the single organization that represents the
-- pre-multi-tenant deployment. No row is dropped or left orphaned.
INSERT INTO departments (id, organization_id, name, created_at)
SELECT id, 'org_default', name, created_at FROM departments_legacy;

INSERT INTO employees (
  id, organization_id, employee_code, first_name, last_name, work_email,
  personal_email, phone, date_of_birth, date_of_joining, department_id,
  designation, employment_status, employment_type, manager_id, location,
  address, emergency_contact_name, emergency_contact_phone, created_at, updated_at
)
SELECT
  id, 'org_default', employee_code, first_name, last_name, work_email,
  personal_email, phone, date_of_birth, date_of_joining, department_id,
  designation, employment_status, employment_type, manager_id, location,
  address, emergency_contact_name, emergency_contact_phone, created_at, updated_at
FROM employees_legacy;

INSERT INTO users (
  id, organization_id, email, password_hash, password_salt, role, employee_id,
  is_active, created_at, updated_at
)
SELECT
  id, 'org_default', email, password_hash, password_salt, role, employee_id,
  is_active, created_at, updated_at
FROM users_legacy;

INSERT INTO sessions (id, organization_id, user_id, expires_at, last_active_at, created_at)
SELECT id, 'org_default', user_id, expires_at, last_active_at, created_at
FROM sessions_legacy;

INSERT INTO login_rate_limits (
  key, organization_id, failed_attempts, window_started_at, locked_until, updated_at
)
SELECT key, 'org_default', failed_attempts, window_started_at, locked_until, updated_at
FROM login_rate_limits_legacy;

INSERT INTO leave_types (id, organization_id, name, annual_quota, is_paid, created_at)
SELECT id, 'org_default', name, annual_quota, is_paid, created_at
FROM leave_types_legacy;

INSERT INTO leave_balances (
  id, organization_id, employee_id, leave_type_id, year, allocated, used, updated_at
)
SELECT id, 'org_default', employee_id, leave_type_id, year, allocated, used, updated_at
FROM leave_balances_legacy;

INSERT INTO leave_requests (
  id, organization_id, employee_id, leave_type_id, start_date, end_date, days,
  reason, status, approver_id, approved_at, rejection_reason, created_at, updated_at
)
SELECT
  id, 'org_default', employee_id, leave_type_id, start_date, end_date, days,
  reason, status, approver_id, approved_at, rejection_reason, created_at, updated_at
FROM leave_requests_legacy;

INSERT INTO attendance_records (
  id, organization_id, employee_id, work_date, clock_in_at, clock_out_at,
  clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng, status, created_at, updated_at
)
SELECT
  id, 'org_default', employee_id, work_date, clock_in_at, clock_out_at,
  clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng, status, created_at, updated_at
FROM attendance_records_legacy;

INSERT INTO audit_logs (
  id, organization_id, actor_user_id, action, entity_type, entity_id, metadata, created_at
)
SELECT
  id, 'org_default', actor_user_id, action, entity_type, entity_id, metadata, created_at
FROM audit_logs_legacy;

-- The new tables now own every foreign-key relationship. Drop legacy tables
-- only after every dependent table has been copied to the new graph.
DROP TABLE audit_logs_legacy;
DROP TABLE attendance_records_legacy;
DROP TABLE leave_requests_legacy;
DROP TABLE leave_balances_legacy;
DROP TABLE sessions_legacy;
DROP TABLE login_rate_limits_legacy;
DROP TABLE users_legacy;
DROP TABLE employees_legacy;
DROP TABLE leave_types_legacy;
DROP TABLE departments_legacy;

CREATE UNIQUE INDEX employees_code_idx ON employees(organization_id, employee_code);
CREATE UNIQUE INDEX employees_work_email_idx ON employees(organization_id, work_email);
CREATE INDEX employees_department_idx ON employees(organization_id, department_id);
CREATE INDEX employees_status_idx ON employees(organization_id, employment_status);

-- User email remains globally unique for this phase because the current login
-- flow identifies the account by email before authentication. Organization
-- context is then taken only from the authenticated user's database row.
CREATE UNIQUE INDEX users_email_idx ON users(email);
CREATE INDEX users_organization_idx ON users(organization_id);

CREATE INDEX sessions_user_idx ON sessions(organization_id, user_id);
CREATE INDEX sessions_organization_idx ON sessions(organization_id);
CREATE INDEX login_rate_limits_updated_idx ON login_rate_limits(organization_id, updated_at);

CREATE INDEX leave_types_organization_idx ON leave_types(organization_id);
CREATE UNIQUE INDEX leave_balances_unique ON leave_balances(organization_id, employee_id, leave_type_id, year);
CREATE INDEX leave_balances_employee_idx ON leave_balances(organization_id, employee_id);
CREATE INDEX leave_requests_employee_idx ON leave_requests(organization_id, employee_id);
CREATE INDEX leave_requests_status_idx ON leave_requests(organization_id, status);
CREATE UNIQUE INDEX attendance_employee_date_idx ON attendance_records(organization_id, employee_id, work_date);
CREATE INDEX attendance_date_idx ON attendance_records(organization_id, work_date);
CREATE INDEX audit_entity_idx ON audit_logs(organization_id, entity_type, entity_id);
CREATE INDEX audit_actor_idx ON audit_logs(organization_id, actor_user_id);

-- Reinstall Phase 1.1 integrity protections on the rebuilt tables.
