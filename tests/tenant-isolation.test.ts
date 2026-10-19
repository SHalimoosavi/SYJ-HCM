import '../tests/helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { db, setTenantContext } from '../src/db/client';
import { employees, leaveTypes, leaveBalances, leaveRequests, attendanceRecords, auditLogs, users, sessions, loginRateLimits } from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { canAccessOrganization } from '../src/lib/authorization';

const ORG_A='org_test_a';
const ORG_B='org_test_b';
const migrationUrl=process.env.DATABASE_MIGRATION_URL;
if(!migrationUrl)throw new Error('DATABASE_MIGRATION_URL is required for PostgreSQL test setup.');
const setupDb=postgres(migrationUrl,{max:1});

async function setupTenants(){
  const ids={employeeA:nanoid(),employeeB:nanoid(),userA:nanoid(),userB:nanoid(),leaveTypeA:nanoid(),leaveTypeB:nanoid(),leaveRequestA:nanoid(),leaveRequestB:nanoid(),attendanceA:nanoid(),attendanceB:nanoid(),auditA:nanoid(),auditB:nanoid()};
  await setupDb.begin(async(tx)=>{
    await tx.unsafe("INSERT INTO organizations (id,name,slug,status) VALUES ('org_test_a','Tenant A','tenant-a','active'),('org_test_b','Tenant B','tenant-b','active') ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,status=excluded.status");
    await tx.unsafe("DELETE FROM login_rate_limits WHERE key IN ('rate-a','rate-b')");

    // users.employee_id references employees.id with an immediate PostgreSQL
    // foreign key. Seed the parent employee rows before their user rows so the
    // fixture models the production referential-integrity invariant.
    await tx.unsafe(`INSERT INTO employees (id,organization_id,employee_code,first_name,last_name,work_email,date_of_joining,designation) VALUES ('${ids.employeeA}','${ORG_A}','EMP-A','A','User','a@tenant-a.test','2026-01-01','Tester'),('${ids.employeeB}','${ORG_B}','EMP-B','B','User','b@tenant-b.test','2026-01-01','Tester')`);
    await tx.unsafe(`INSERT INTO users (id,organization_id,email,password_hash,password_salt,role,employee_id,is_active) VALUES ('${ids.userA}', '${ORG_A}', 'admin-a@tenant-a.test','h','s','admin','${ids.employeeA}',true),('${ids.userB}','${ORG_B}','admin-b@tenant-b.test','h','s','admin','${ids.employeeB}',true)`);
    await tx.unsafe(`INSERT INTO leave_types (id,organization_id,name,annual_quota,is_paid) VALUES ('${ids.leaveTypeA}','${ORG_A}','Annual A',10,true),('${ids.leaveTypeB}','${ORG_B}','Annual B',10,true)`);
    await tx.unsafe(`INSERT INTO leave_balances (id,organization_id,employee_id,leave_type_id,year,allocated,used) VALUES ('${nanoid()}','${ORG_A}','${ids.employeeA}','${ids.leaveTypeA}',2026,10,0),('${nanoid()}','${ORG_B}','${ids.employeeB}','${ids.leaveTypeB}',2026,10,0)`);
    await tx.unsafe(`INSERT INTO leave_requests (id,organization_id,employee_id,leave_type_id,start_date,end_date,days,status) VALUES ('${ids.leaveRequestA}','${ORG_A}','${ids.employeeA}','${ids.leaveTypeA}','2026-10-01','2026-10-01',1,'pending'),('${ids.leaveRequestB}','${ORG_B}','${ids.employeeB}','${ids.leaveTypeB}','2026-10-02','2026-10-02',1,'pending')`);
    await tx.unsafe(`INSERT INTO attendance_records (id,organization_id,employee_id,work_date,status) VALUES ('${ids.attendanceA}','${ORG_A}','${ids.employeeA}','2026-09-10','present'),('${ids.attendanceB}','${ORG_B}','${ids.employeeB}','2026-09-10','present')`);
    await tx.unsafe(`INSERT INTO audit_logs (id,organization_id,actor_user_id,action,entity_type,entity_id) VALUES ('${ids.auditA}','${ORG_A}','${ids.userA}','test','employee','${ids.employeeA}'),('${ids.auditB}','${ORG_B}','${ids.userB}','test','employee','${ids.employeeB}')`);
    await tx.unsafe(`INSERT INTO sessions (id,organization_id,user_id,expires_at) VALUES ('${nanoid()}','${ORG_A}','${ids.userA}','2099-01-01T00:00:00.000Z'),('${nanoid()}','${ORG_B}','${ids.userB}','2099-01-01T00:00:00.000Z')`);
    await tx.unsafe(`INSERT INTO login_rate_limits (key,organization_id,failed_attempts,window_started_at) VALUES ('rate-a','${ORG_A}',1,now()),('rate-b','${ORG_B}',1,now()) ON CONFLICT(key) DO UPDATE SET organization_id=excluded.organization_id,failed_attempts=excluded.failed_attempts,window_started_at=excluded.window_started_at`);
  });
  return ids;
}

test.after(async()=>{await setupDb.end({timeout:5});});

test('organization boundary blocks cross-tenant reads and mutations by ID',async()=>{
  const ids=await setupTenants();
  assert.equal(canAccessOrganization(ORG_A,ORG_B),false);

  const read=await db.transaction(async(tx)=>{await setTenantContext(tx,ORG_A);return tx.select({id:employees.id}).from(employees).where(eq(employees.id,ids.employeeB));});
  assert.equal(read.length,0);

  const update=await db.transaction(async(tx)=>{await setTenantContext(tx,ORG_A);return tx.update(employees).set({designation:'SHOULD-NOT-CHANGE'}).where(and(eq(employees.organizationId,ORG_A),eq(employees.id,ids.employeeB))).returning({id:employees.id});});
  assert.equal(update.length,0);

  const leaveRead=await db.transaction(async(tx)=>{await setTenantContext(tx,ORG_A);return tx.select({id:leaveRequests.id}).from(leaveRequests).where(eq(leaveRequests.id,ids.leaveRequestB));});
  assert.equal(leaveRead.length,0);
  const leaveUpdate=await db.transaction(async(tx)=>{await setTenantContext(tx,ORG_A);return tx.update(leaveRequests).set({status:'approved'}).where(and(eq(leaveRequests.organizationId,ORG_A),eq(leaveRequests.id,ids.leaveRequestB))).returning({id:leaveRequests.id});});
  assert.equal(leaveUpdate.length,0);

  const attendanceRead=await db.transaction(async(tx)=>{await setTenantContext(tx,ORG_A);return tx.select({id:attendanceRecords.id}).from(attendanceRecords).where(eq(attendanceRecords.id,ids.attendanceB));});
  assert.equal(attendanceRead.length,0);
  const auditRead=await db.transaction(async(tx)=>{await setTenantContext(tx,ORG_A);return tx.select({id:auditLogs.id}).from(auditLogs).where(eq(auditLogs.id,ids.auditB));});
  assert.equal(auditRead.length,0);

  const sessionDelete=await db.transaction(async(tx)=>{await setTenantContext(tx,ORG_A);return tx.delete(sessions).where(and(eq(sessions.organizationId,ORG_A),eq(sessions.userId,ids.userB))).returning({id:sessions.id});});
  assert.equal(sessionDelete.length,0);
  const rateDelete=await db.delete(loginRateLimits).where(and(eq(loginRateLimits.organizationId,ORG_A),eq(loginRateLimits.key,'rate-b'))).returning({key:loginRateLimits.key});
  assert.equal(rateDelete.length,0);
});

test('missing tenant context denies private tenant rows',async()=>{
  const ids=await setupTenants();
  const rows=await db.select({id:employees.id}).from(employees).where(eq(employees.id,ids.employeeA));
  assert.equal(rows.length,0);
});

test('tenant A cannot insert a row claiming tenant B ownership',async()=>{
  const ids=await setupTenants();
  await assert.rejects(()=>db.transaction(async(tx)=>{await setTenantContext(tx,ORG_A);await tx.insert(employees).values({id:nanoid(),organizationId:ORG_B,employeeCode:'FORGED',firstName:'F',lastName:'G',workEmail:`${nanoid()}@test.local`,dateOfJoining:'2026-01-01',designation:'Forged'});}),/row-level security|violates row-level security/i);
});
