-- SYJ-HCM Phase 2.1: recruitment / ATS foundation.
-- Additive only. Historical migrations remain unchanged.

CREATE UNIQUE INDEX IF NOT EXISTS users_organization_id_idx ON users(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS employees_organization_id_idx ON employees(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS departments_organization_id_idx ON departments(organization_id, id);

CREATE TABLE IF NOT EXISTS job_requisitions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  requisition_code TEXT NOT NULL,
  title TEXT NOT NULL,
  department_id TEXT,
  location TEXT,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('full_time','part_time','contract','temporary','internship')),
  description TEXT NOT NULL,
  requirements TEXT NOT NULL,
  skills TEXT,
  salary_min REAL,
  salary_max REAL,
  currency TEXT NOT NULL DEFAULT 'INR',
  openings INTEGER NOT NULL DEFAULT 1 CHECK (openings >= 1),
  hiring_manager_employee_id TEXT,
  recruiter_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','on_hold','closed','cancelled')),
  opening_date TEXT,
  closing_date TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id, requisition_code),
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, hiring_manager_employee_id) REFERENCES employees(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, recruiter_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (salary_min IS NULL OR salary_min >= 0),
  CHECK (salary_max IS NULL OR salary_max >= 0),
  CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min),
  CHECK (closing_date IS NULL OR opening_date IS NULL OR closing_date >= opening_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS job_requisitions_organization_id_idx ON job_requisitions(organization_id, id);
CREATE INDEX IF NOT EXISTS job_requisitions_status_idx ON job_requisitions(organization_id, status);
CREATE INDEX IF NOT EXISTS job_requisitions_department_idx ON job_requisitions(organization_id, department_id);
CREATE INDEX IF NOT EXISTS job_requisitions_recruiter_idx ON job_requisitions(organization_id, recruiter_user_id);
CREATE INDEX IF NOT EXISTS job_requisitions_hiring_manager_idx ON job_requisitions(organization_id, hiring_manager_employee_id);
CREATE INDEX IF NOT EXISTS job_requisitions_created_idx ON job_requisitions(organization_id, created_at);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  location TEXT,
  headline TEXT,
  summary TEXT,
  source TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (length(trim(first_name)) BETWEEN 1 AND 100),
  CHECK (length(trim(last_name)) BETWEEN 1 AND 100),
  CHECK (length(email) BETWEEN 3 AND 254)
);

CREATE UNIQUE INDEX IF NOT EXISTS candidates_organization_id_idx ON candidates(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS candidates_email_idx ON candidates(organization_id, email);
CREATE INDEX IF NOT EXISTS candidates_name_idx ON candidates(organization_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS candidates_created_idx ON candidates(organization_id, created_at);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL,
  requisition_id TEXT NOT NULL,
  application_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','screening','shortlisted','interview','evaluation','offer','hired','rejected','withdrawn','archived')),
  applied_at TEXT NOT NULL DEFAULT (current_timestamp),
  source TEXT,
  current_stage TEXT NOT NULL DEFAULT 'applied',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id, application_reference),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, requisition_id) REFERENCES job_requisitions(organization_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS applications_organization_id_idx ON applications(organization_id, id);
CREATE INDEX IF NOT EXISTS applications_candidate_idx ON applications(organization_id, candidate_id);
CREATE INDEX IF NOT EXISTS applications_requisition_idx ON applications(organization_id, requisition_id);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(organization_id, status);
CREATE INDEX IF NOT EXISTS applications_created_idx ON applications(organization_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS applications_active_candidate_requisition_idx
  ON applications(organization_id, candidate_id, requisition_id)
  WHERE status NOT IN ('rejected', 'withdrawn', 'archived');

CREATE TABLE IF NOT EXISTS application_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  application_id TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL CHECK (new_status IN ('applied','screening','shortlisted','interview','evaluation','offer','hired','rejected','withdrawn','archived')),
  actor_user_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS application_history_application_idx ON application_history(organization_id, application_id, created_at);
CREATE INDEX IF NOT EXISTS application_history_actor_idx ON application_history(organization_id, actor_user_id);
