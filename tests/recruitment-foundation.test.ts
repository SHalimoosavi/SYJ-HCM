import './helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { db, setTenantContext } from '../src/db/client';
import { jobRequisitions } from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { canTransitionApplicationStatus, canTransitionJobStatus } from '../src/lib/recruitment';

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationUrl) throw new Error('DATABASE_MIGRATION_URL is required for PostgreSQL test setup.');
const setupDb = postgres(migrationUrl, { max: 1 });

async function reset() {
  await setupDb.begin(async (tx) => {
    // Delete children before parents. users.employee_id references employees,
    // so users must be removed before employees during fixture reset.
    for (const table of [
      'interview_feedback_corrections',
      'interview_decisions',
      'interview_feedback',
      'interview_participants',
      'candidate_activities',
      'candidate_notes',
      'interviews',
      'interview_rounds',
      'recruitment_stages',
      'application_history',
      'applications',
      'candidates',
      'job_requisitions',
      'sessions',
      'departments',
      'organization_settings',
      'users',
      'employees',
    ]) {
      await tx.unsafe(`DELETE FROM "${table}"`);
    }

    await tx.unsafe("INSERT INTO organizations (id,name,slug,status) VALUES ('org_default','Default Organization','default','active'),('org_b','Organization B','organization-b','active') ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,status=excluded.status");

    // employees must exist before any child row that references employees.id.
    await tx.unsafe("INSERT INTO employees (id,organization_id,employee_code,first_name,last_name,work_email,date_of_joining,designation,employment_status,employment_type) VALUES ('emp-a','org_default','E1','A','Employee','emp-a@example.test','2026-01-01','Manager','active','full_time'),('emp-b','org_b','E1','B','Employee','emp-b@example.test','2026-01-01','Manager','active','full_time') ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,employee_code=excluded.employee_code,first_name=excluded.first_name,last_name=excluded.last_name,work_email=excluded.work_email,date_of_joining=excluded.date_of_joining,designation=excluded.designation,employment_status=excluded.employment_status,employment_type=excluded.employment_type");

    await tx.unsafe("INSERT INTO users (id,organization_id,email,password_hash,password_salt,role,is_active) VALUES ('admin-a','org_default','admin-a@example.test','x','x','admin',true),('hr-a','org_default','hr-a@example.test','x','x','hr',true),('admin-b','org_b','admin-b@example.test','x','x','admin',true) ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,email=excluded.email,role=excluded.role,is_active=true");
    await tx.unsafe("INSERT INTO departments (id,organization_id,name) VALUES ('dept-a','org_default','Engineering'),('dept-b','org_b','Engineering') ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,name=excluded.name");
    await tx.unsafe("INSERT INTO organization_settings (organization_id) VALUES ('org_default'),('org_b') ON CONFLICT(organization_id) DO NOTHING");
  });
}

test.after(async () => { await setupDb.end({ timeout: 5 }); });
test.beforeEach(reset);

test('job requisition schema enforces tenant-aware assignments', async () => {
  await assert.rejects(
    () => setupDb`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,hiring_manager_employee_id,recruiter_user_id,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'emp-b','admin-a','admin-a')`,
    /foreign key/i,
  );
  await setupDb`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,hiring_manager_employee_id,recruiter_user_id,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'emp-a','hr-a','admin-a')`;
  const rows = await setupDb`SELECT count(*)::int AS c FROM job_requisitions WHERE organization_id='org_default'`;
  assert.equal(rows[0]?.c, 1);
});

test('job status transitions are controlled', () => {
  assert.equal(canTransitionJobStatus('draft', 'open'), true);
  assert.equal(canTransitionJobStatus('open', 'draft'), false);
  assert.equal(canTransitionJobStatus('closed', 'open'), false);
});

test('candidate is reusable across multiple applications', async () => {
  await setupDb`INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')`;
  for (const [id, code, title] of [['j1', 'REQ-1', 'Engineer'], ['j2', 'REQ-2', 'Analyst']] as const) {
    await setupDb`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES (${id},'org_default',${code},${title},'full_time','d','r',1,'open','admin-a')`;
  }
  await setupDb`INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a1','org_default','c1','j1','APP-1'),('a2','org_default','c1','j2','APP-2')`;
  const rows = await setupDb`SELECT count(*)::int AS c FROM applications WHERE organization_id='org_default' AND candidate_id='c1'`;
  assert.equal(rows[0]?.c, 2);
});

test('active duplicate application is rejected at database level', async () => {
  await setupDb`INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')`;
  await setupDb`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'open','admin-a')`;
  await setupDb`INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a1','org_default','c1','j1','APP-1')`;
  await assert.rejects(() => setupDb`INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a2','org_default','c1','j1','APP-2')`, /unique/i);
  await setupDb`UPDATE applications SET status='rejected',current_stage='rejected' WHERE id='a1'`;
  await setupDb`INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a2','org_default','c1','j1','APP-2')`;
  const rows = await setupDb`SELECT count(*)::int AS c FROM applications WHERE candidate_id='c1' AND requisition_id='j1'`;
  assert.equal(rows[0]?.c, 2);
});

test('application lifecycle transitions are controlled', () => {
  assert.equal(canTransitionApplicationStatus('applied', 'screening'), true);
  assert.equal(canTransitionApplicationStatus('screening', 'offer'), false);
  assert.equal(canTransitionApplicationStatus('offer', 'hired'), true);
  assert.equal(canTransitionApplicationStatus('hired', 'rejected'), false);
  assert.equal(canTransitionApplicationStatus('rejected', 'archived'), true);
});

test('application history is tenant-bound to its application and actor', async () => {
  await setupDb`INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')`;
  await setupDb`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'open','admin-a')`;
  await setupDb`INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a1','org_default','c1','j1','APP-1')`;
  await setupDb`INSERT INTO application_history (id,organization_id,application_id,new_status,actor_user_id,reason) VALUES ('h1','org_default','a1','applied','hr-a','created')`;
  await assert.rejects(() => setupDb`INSERT INTO application_history (id,organization_id,application_id,new_status,actor_user_id) VALUES ('h2','org_default','a1','screening','admin-b')`, /foreign key/i);
});

test('cross-tenant recruitment reads are blocked by RLS', async () => {
  await setupDb`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('jb','org_b','REQ-B','B Job','full_time','d','r',1,'open','admin-b')`;
  const rows = await db.transaction(async (tx) => {
    await setTenantContext(tx, 'org_default');
    return tx.select({ id: jobRequisitions.id }).from(jobRequisitions).where(and(eq(jobRequisitions.organizationId, 'org_b'), eq(jobRequisitions.id, 'jb')));
  });
  assert.equal(rows.length, 0);
});

test('database rejects invalid job openings and salary range', async () => {
  await assert.rejects(
    () => setupDb`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',0,'draft','admin-a')`,
    /check/i,
  );
  await assert.rejects(
    () => setupDb`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,salary_min,salary_max,status,created_by) VALUES ('j2','org_default','REQ-2','Engineer','full_time','d','r',1,100,50,'draft','admin-a')`,
    /check/i,
  );
});

test('application state and history changes roll back atomically', async () => {
  await setupDb`INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')`;
  await setupDb`INSERT INTO job_requisitions (id,organization_id,requisition_code,title,employment_type,description,requirements,openings,status,created_by) VALUES ('j1','org_default','REQ-1','Engineer','full_time','d','r',1,'open','admin-a')`;
  await assert.rejects(async () => setupDb.begin(async (tx) => {
    await tx`INSERT INTO applications (id,organization_id,candidate_id,requisition_id,application_reference) VALUES ('a1','org_default','c1','j1','APP-1')`;
    await tx`INSERT INTO application_history (id,organization_id,application_id,new_status,actor_user_id) VALUES ('h1','org_default','a1','applied','hr-a')`;
    throw new Error('force rollback');
  }));
  const applicationRows = await setupDb`SELECT count(*)::int AS c FROM applications WHERE id='a1'`;
  const historyRows = await setupDb`SELECT count(*)::int AS c FROM application_history WHERE id='h1'`;
  assert.equal(applicationRows[0]?.c, 0);
  assert.equal(historyRows[0]?.c, 0);
});

test('tenant duplicate candidate email is prevented by unique constraint', async () => {
  await setupDb`INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c1','org_default','Jane','Doe','jane@example.test','hr-a')`;
  await assert.rejects(() => setupDb`INSERT INTO candidates (id,organization_id,first_name,last_name,email,created_by) VALUES ('c2','org_default','Janet','Doe','jane@example.test','hr-a')`, /unique/i);
});
