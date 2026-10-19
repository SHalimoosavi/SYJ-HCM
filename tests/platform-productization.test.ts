import './helpers/setup-test-db';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { db } from '../src/db/client';
import { auditLogs, organizationSettings, organizations, platformAdministrators, platformAuditLogs, sessions, users } from '../src/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { hashPassword, verifyPassword } from '../src/lib/password';
import type { CurrentUser } from '../src/lib/session';
import { ForbiddenError } from '../src/lib/auth';
import { assertPlatformAdministrator, isPlatformAdministrator, provisionOrganizationInTransaction, setOrganizationStatusInTransaction, updateOrganizationConfigurationInTransaction, validateOrganizationConfig, validateProvisioningInput } from '../src/lib/platform';

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationUrl) throw new Error('DATABASE_MIGRATION_URL is required for PostgreSQL test setup.');
const adminDb = postgres(migrationUrl, { max: 1 });

let sequence=0;
let admin:CurrentUser;let hr:CurrentUser;let employee:CurrentUser;let orgId:string;

async function fixture(){
  sequence++;
  const suffix=`platform-${process.pid}-${sequence}-${nanoid(6).toLowerCase()}`;
  orgId=`org_${suffix}`;const adminId=`usr_${suffix}`;const hrId=`usr_${suffix}-hr`;const employeeId=`usr_${suffix}-emp`;
  const {hash,salt}=hashPassword('StrongInitialPassword123!');
  await adminDb.unsafe(`insert into organizations(id,name,slug,status) values ($1,$2,$3,'active'),($4,$5,$6,'active')`,[orgId,'Default Organization',suffix,`org_other_${suffix}`,'Other Organization',`other-${suffix}`]);
  await adminDb.unsafe(`insert into organization_settings(organization_id) values ($1),($2)`,[orgId,`org_other_${suffix}`]);
  await adminDb.unsafe(`insert into users(id,organization_id,email,password_hash,password_salt,role,is_active) values ($1,$2,$3,'x','x','admin',true),($4,$2,$5,'x','x','hr',true),($6,$2,$7,'x','x','employee',true),($8,$9,$10,'x','x','admin',true)`,[adminId,orgId,`${suffix}@example.test`,hrId,`${suffix}-hr@example.test`,employeeId,`${suffix}-employee@example.test`,`usr_other_${suffix}`,`org_other_${suffix}`,`other-${suffix}@example.test`]);
  await adminDb.unsafe(`update users set password_hash=$1,password_salt=$2 where organization_id=$3`,[hash,salt,orgId]);
  await adminDb.unsafe(`insert into platform_administrators(user_id) values ($1)`,[adminId]);
  admin={id:adminId,email:`${suffix}@example.test`,role:'admin',employeeId:null,organizationId:orgId,organizationStatus:'active'};
  hr={...admin,id:hrId,email:`${suffix}-hr@example.test`,role:'hr'};
  employee={...admin,id:employeeId,email:`${suffix}-employee@example.test`,role:'employee'};
}

beforeEach(fixture);
test.after(async()=>{await adminDb.end({timeout:5});});

test('platform capability is separate from organization roles',async()=>{assert.equal(await isPlatformAdministrator(admin.id),true);assert.equal(await isPlatformAdministrator(hr.id),false);assert.equal(await isPlatformAdministrator(employee.id),false);await assert.rejects(()=>assertPlatformAdministrator(hr.id),ForbiddenError);await assert.rejects(()=>assertPlatformAdministrator(employee.id),ForbiddenError);});

test('valid provisioning creates organization defaults and initial admin atomically',async()=>{const result=await provisionOrganizationInTransaction(admin,{name:'New Customer',slug:`new-customer-${sequence}`,adminEmail:`owner-${sequence}@new-customer.test`,adminPassword:'StrongInitialPassword123!'});assert.ok(result.organizationId.startsWith('org_'));assert.ok(result.adminUserId.startsWith('usr_'));const org=(await adminDb`SELECT name,slug,status FROM organizations WHERE id=${result.organizationId} LIMIT 1`)[0];const config=(await adminDb`SELECT organization_id,timezone,locale FROM organization_settings WHERE organization_id=${result.organizationId} LIMIT 1`)[0];const user=(await adminDb`SELECT organization_id,role,is_active,password_hash,password_salt FROM users WHERE id=${result.adminUserId} LIMIT 1`)[0];assert.equal(org?.slug,`new-customer-${sequence}`);assert.equal(org?.status,'active');assert.equal(config?.organization_id,result.organizationId);assert.equal(config?.timezone,'UTC');assert.equal(user?.organization_id,result.organizationId);assert.equal(user?.role,'admin');assert.equal(user?.is_active,true);assert.equal(verifyPassword('StrongInitialPassword123!',user!.password_hash,user!.password_salt),true);const audits=await adminDb`SELECT id FROM platform_audit_logs WHERE entity_id in (${result.organizationId},${result.adminUserId})`;assert.equal(audits.length,2);});

test('provisioning rejects duplicate slug and duplicate account identity',async()=>{await assert.rejects(()=>provisionOrganizationInTransaction(admin,{name:'Duplicate',slug:`${admin.email.split('@')[0]}`,adminEmail:`new-${sequence}@example.test`,adminPassword:'StrongInitialPassword123!'}),/slug is already|already in use/i);await assert.rejects(()=>provisionOrganizationInTransaction(admin,{name:'Duplicate',slug:`unique-${sequence}`,adminEmail:admin.email,adminPassword:'StrongInitialPassword123!'}),/email is already|registered/i);});

test('provisioning rolls back all records on a deliberate required-step failure',async()=>{const slug=`rollback-${sequence}`;await assert.rejects(()=>provisionOrganizationInTransaction(admin,{name:'Rollback Tenant',slug,adminEmail:`rollback-${sequence}@example.test`,adminPassword:'StrongInitialPassword123!'},()=>{throw new Error('deliberate provisioning failure');}),/deliberate provisioning failure/);assert.equal((await adminDb`SELECT id FROM organizations WHERE slug=${slug} LIMIT 1`).length,0);});

test('suspension revokes tenant sessions and preserves tenant data for recovery',async()=>{const target=`org_target_${process.pid}_${sequence}`;const targetUser=`usr_target_${process.pid}_${sequence}`;const {hash,salt}=hashPassword('StrongInitialPassword123!');await adminDb`INSERT INTO organizations(id,name,slug,status) VALUES (${target},'Target',${`target-${process.pid}-${sequence}`},'active')`;await adminDb`INSERT INTO organization_settings(organization_id) VALUES (${target})`;await adminDb`INSERT INTO users(id,organization_id,email,password_hash,password_salt,role,is_active) VALUES (${targetUser},${target},${`target-${sequence}@example.test`},${hash},${salt},'admin',true)`;await adminDb`INSERT INTO sessions(id,organization_id,user_id,expires_at,last_active_at) VALUES (${`sess-${process.pid}-${sequence}`},${target},${targetUser},'2099-01-01T00:00:00.000Z',${new Date().toISOString()})`;await setOrganizationStatusInTransaction(admin,target,'suspended');assert.equal((await adminDb`SELECT status FROM organizations WHERE id=${target} LIMIT 1`)[0]?.status,'suspended');assert.equal((await adminDb`SELECT id FROM sessions WHERE organization_id=${target}`).length,0);assert.equal((await adminDb`SELECT organization_id FROM organization_settings WHERE organization_id=${target}`).length,1);await assert.rejects(()=>setOrganizationStatusInTransaction(hr,target,'active'),/Platform administration/);await setOrganizationStatusInTransaction(admin,target,'active');assert.equal((await adminDb`SELECT status FROM organizations WHERE id=${target} LIMIT 1`)[0]?.status,'active');const auditCount=await adminDb`SELECT id FROM platform_audit_logs WHERE entity_id=${target}`;assert.equal(auditCount.length,2);});

test('platform cannot suspend the organization containing its current account',async()=>{await assert.rejects(()=>setOrganizationStatusInTransaction(admin,admin.organizationId,'suspended'),/cannot suspend/i);});

test('organization configuration is tenant-scoped validated and audited',async()=>{await updateOrganizationConfigurationInTransaction(admin,{timezone:'Asia/Kolkata',locale:'en-IN',dateFormat:'DD-MM-YYYY',weekStartDay:1});const cfg=(await adminDb`SELECT timezone,date_format FROM organization_settings WHERE organization_id=${orgId} LIMIT 1`)[0];assert.equal(cfg?.timezone,'Asia/Kolkata');assert.equal(cfg?.date_format,'DD-MM-YYYY');assert.equal(validateOrganizationConfig({timezone:'Mars/Colony',locale:'en-IN',dateFormat:'YYYY-MM-DD',weekStartDay:1})?.includes('Unsupported timezone'),true);assert.equal(validateOrganizationConfig({timezone:'UTC',locale:'bad_locale',dateFormat:'YYYY-MM-DD',weekStartDay:1})?.includes('Locale'),true);const audit=await adminDb`SELECT action FROM audit_logs WHERE organization_id=${orgId} AND entity_type='organization_settings' AND entity_id=${orgId} ORDER BY created_at DESC LIMIT 1`;assert.equal(audit[0]?.action,'organization_configuration_changed');});

test('platform and tenant audit logs remain immutable',async()=>{await assert.rejects(adminDb`UPDATE platform_audit_logs SET action='tampered'`,/immutable/i);await assert.rejects(adminDb`DELETE FROM platform_audit_logs`,/immutable/i);});

test('validation rejects unsafe provisioning input',()=>{assert.equal(validateProvisioningInput({name:'Valid',slug:'valid-org',adminEmail:'owner@example.test',adminPassword:'StrongInitialPassword123!'}),null);assert.match(validateProvisioningInput({name:'x',slug:'valid-org',adminEmail:'owner@example.test',adminPassword:'StrongInitialPassword123!'})??'',/between 2/);assert.match(validateProvisioningInput({name:'Valid',slug:'bad slug',adminEmail:'owner@example.test',adminPassword:'StrongInitialPassword123!'})??'',/lowercase/);assert.match(validateProvisioningInput({name:'Valid',slug:'valid-org',adminEmail:'owner@example.test',adminPassword:'short'})??'',/12/);});