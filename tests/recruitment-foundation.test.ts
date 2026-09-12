import './helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlite } from '../src/db/client';
import { canTransitionApplicationStatus, canTransitionJobStatus } from '../src/lib/recruitment';

function reset() {
  sqlite.exec(`
    DROP TRIGGER IF EXISTS application_history_immutable_update;
    DROP TRIGGER IF EXISTS application_history_immutable_delete;
    DROP TRIGGER IF EXISTS interview_decisions_immutable_update;
    DROP TRIGGER IF EXISTS interview_decisions_immutable_delete;
    DROP TRIGGER IF EXISTS interview_feedback_immutable_update;
    DROP TRIGGER IF EXISTS interview_feedback_immutable_delete;
    DROP TRIGGER IF EXISTS interview_feedback_corrections_immutable_update;
    DROP TRIGGER IF EXISTS interview_feedback_corrections_immutable_delete;
    DROP TRIGGER IF EXISTS candidate_activities_immutable_update;
    DROP TRIGGER IF EXISTS candidate_activities_immutable_delete;

    DELETE FROM interview_feedback_corrections;
    DELETE FROM interview_decisions;
    DELETE FROM interview_feedback;
    DELETE FROM interview_participants;
    DELETE FROM candidate_activities;
    DELETE FROM candidate_notes;
    DELETE FROM interviews;
    DELETE FROM interview_rounds;
    DELETE FROM recruitment_stages;
    DELETE FROM application_history;
    DELETE FROM applications;
    DELETE FROM candidates;
    DELETE FROM job_requisitions;
    DELETE FROM sessions;
    DELETE FROM employees;
    DELETE FROM departments;
    DELETE FROM users;
  `);

  sqlite.exec(`
    CREATE TRIGGER application_history_immutable_update
    BEFORE UPDATE ON application_history
    BEGIN
      SELECT RAISE(ABORT, 'Application history is immutable.');
    END;

    CREATE TRIGGER application_history_immutable_delete
    BEFORE DELETE ON application_history
    BEGIN
      SELECT RAISE(ABORT, 'Application history is immutable.');
    END;

    CREATE TRIGGER interview_decisions_immutable_update
    BEFORE UPDATE ON interview_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Interview decisions are immutable.');
    END;

    CREATE TRIGGER interview_decisions_immutable_delete
    BEFORE DELETE ON interview_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Interview decisions are immutable.');
    END;

    CREATE TRIGGER interview_feedback_immutable_update
    BEFORE UPDATE ON interview_feedback
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback is immutable.');
    END;

    CREATE TRIGGER interview_feedback_immutable_delete
    BEFORE DELETE ON interview_feedback
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback is immutable.');
    END;

    CREATE TRIGGER interview_feedback_corrections_immutable_update
    BEFORE UPDATE ON interview_feedback_corrections
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback corrections are immutable.');
    END;

    CREATE TRIGGER interview_feedback_corrections_immutable_delete
    BEFORE DELETE ON interview_feedback_corrections
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback corrections are immutable.');
    END;

    CREATE TRIGGER candidate_activities_immutable_update
    BEFORE UPDATE ON candidate_activities
    BEGIN
      SELECT RAISE(ABORT, 'Candidate activities are immutable.');
    END;

    CREATE TRIGGER candidate_activities_immutable_delete
    BEFORE DELETE ON candidate_activities
    BEGIN
      SELECT RAISE(ABORT, 'Candidate activities are immutable.');
    END;
  `);
  sqlite.exec("INSERT INTO organizations (id,name,slug,status) VALUES ('org_default','Default Organization','default','active'),('org_b','Organization B','organization-b','active') ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,status=excluded.status;");
  sqlite.exec("INSERT INTO users (id,organization_id,email,password_hash,password_salt,role,is_active) VALUES ('admin-a','org_default','admin-a@example.test','x','x','admin',1),('hr-a','org_default','hr-a@example.test','x','x','hr',1),('admin-b','org_b','admin-b@example.test','x','x','admin',1);");
  sqlite.exec("INSERT INTO departments (id,organization_id,name) VALUES ('dept-a','org_default','Engineering'),('dept-b','org_b','Engineering');");
  sqlite.exec("INSERT INTO employees (id,organization_id,employee_code,first_name,last_name,work_email,date_of_joining,designation,employment_status,employment_type) VALUES ('emp-a','org_default','E1','A','Employee','emp-a@example.test','2026-01-01','Manager','active','full_time'),('emp-b','org_b','E1','B','Employee','emp-b@example.test','2026-01-01','Manager','active','full_time');");
  sqlite.exec("INSERT INTO organization_settings (organization_id) VALUES ('org_default'),('org_b') ON CONFLICT(organization_id) DO NOTHING;");
}
test.beforeEach(reset);

test('job requisition schema enforces tenant-aware assignments', () => {
  assert.throws(() => sqlite.prepare(`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,hiring_manager_employee_id,recruiter_user_id,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'emp-b','admin-a','admin-a')`).run(), /FOREIGN KEY/);
  sqlite.prepare(`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,hiring_manager_employee_id,recruiter_user_id,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'emp-a','hr-a','admin-a')`).run();
  assert.equal(sqlite.prepare("SELECT count(*) c FROM job_requisitions WHERE organization_id='org_default'").get()?.c, 1);
});

test('job status transitions are controlled', () => {
  assert.equal(canTransitionJobStatus('draft','open'), true); assert.equal(canTransitionJobStatus('open','draft'), false); assert.equal(canTransitionJobStatus('closed','open'), false);
});

test('candidate is reusable across multiple applications', () => {
  sqlite.prepare("INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')").run();
  const jobs: Array<[string, string, string]> = [['j1','REQ-1','Engineer'],['j2','REQ-2','Analyst']];
  for (const [id,code,title] of jobs) sqlite.prepare("INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES (?,?,?,?,?,'d','r',1,'open','admin-a')").run(id,'org_default',code,title,'full_time');
  sqlite.prepare("INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a1','org_default','c1','j1','APP-1')").run();
  sqlite.prepare("INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a2','org_default','c1','j2','APP-2')").run();
  assert.equal(sqlite.prepare("SELECT count(*) c FROM applications WHERE organization_id='org_default' AND candidate_id='c1'").get()?.c,2);
});

test('active duplicate application is rejected at database level', () => {
  sqlite.prepare("INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')").run();
  sqlite.prepare("INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'open','admin-a')").run();
  sqlite.prepare("INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a1','org_default','c1','j1','APP-1')").run();
  assert.throws(() => sqlite.prepare("INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a2','org_default','c1','j1','APP-2')").run(), /UNIQUE/);
  sqlite.prepare("UPDATE applications SET status='rejected',current_stage='rejected' WHERE id='a1'").run();
  sqlite.prepare("INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a2','org_default','c1','j1','APP-2')").run();
  assert.equal(sqlite.prepare("SELECT count(*) c FROM applications WHERE candidate_id='c1' AND requisition_id='j1'").get()?.c,2);
});

test('application lifecycle transitions are controlled', () => {
  assert.equal(canTransitionApplicationStatus('applied','screening'),true); assert.equal(canTransitionApplicationStatus('screening','offer'),false); assert.equal(canTransitionApplicationStatus('offer','hired'),true); assert.equal(canTransitionApplicationStatus('hired','rejected'),false); assert.equal(canTransitionApplicationStatus('rejected','archived'),true);
});

test('application history is tenant-bound to its application and actor', () => {
  sqlite.prepare("INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')").run();
  sqlite.prepare("INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'open','admin-a')").run();
  sqlite.prepare("INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a1','org_default','c1','j1','APP-1')").run();
  sqlite.prepare("INSERT INTO application_history (id,organization_id,application_id,new_status,actor_user_id,reason) VALUES ('h1','org_default','a1','applied','hr-a','created')").run();
  assert.throws(() => sqlite.prepare("INSERT INTO application_history (id,organization_id,application_id,new_status,actor_user_id) VALUES ('h2','org_default','a1','screening','admin-b')").run(), /FOREIGN KEY/);
});

test('cross-tenant recruitment reads require explicit organization scope', () => {
  sqlite.prepare("INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('jb','org_b','REQ-B','B Job','full_time','d','r',1,'open','admin-b')").run();
  const row = sqlite.prepare("SELECT id FROM job_requisitions WHERE organization_id=? AND id=?").get('org_default','jb');
  assert.equal(row, undefined);
});

test('database rejects invalid job openings and salary range', () => {
  assert.throws(() => sqlite.prepare("INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',0,'draft','admin-a')").run(), /CHECK/);
  assert.throws(() => sqlite.prepare("INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,salary_min,salary_max,status,created_by) VALUES ('j2','org_default','REQ-2','Engineer','full_time','d','r',1,100,50,'draft','admin-a')").run(), /CHECK/);
});

test('application history records can be inserted atomically with application state', () => {
  sqlite.prepare("INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')").run();
  sqlite.prepare("INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'open','admin-a')").run();
  sqlite.exec('BEGIN IMMEDIATE');
  try { sqlite.prepare("INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a1','org_default','c1','j1','APP-1')").run(); sqlite.prepare("INSERT INTO application_history (id,organization_id,application_id,new_status,actor_user_id) VALUES ('h1','org_default','a1','applied','hr-a')").run(); sqlite.exec('ROLLBACK'); } catch(e) { sqlite.exec('ROLLBACK'); throw e; }
  assert.equal(sqlite.prepare("SELECT count(*) c FROM applications WHERE id='a1'").get()?.c,0); assert.equal(sqlite.prepare("SELECT count(*) c FROM application_history WHERE id='h1'").get()?.c,0);
});

test('tenant duplicate candidate email is prevented by application validation policy', () => {
  sqlite.prepare("INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')").run();
  assert.throws(() => sqlite.prepare("INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c2','org_default','Janet','Doe','jane@example.test','hr-a')").run(), /UNIQUE/);
});
