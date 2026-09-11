'use server';

import { db, sqlite, withSqliteTransactionSync } from '@/db/client';
import { applicationHistory, applications, candidates, departments, employees, jobRequisitions, users } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireRoleForAction } from '@/lib/auth';
import { recordAuditSync } from '@/lib/audit';
import { canTransitionApplicationStatus, canTransitionJobStatus, type ApplicationStatus, type JobStatus } from '@/lib/recruitment';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export type FormState = { error: string | null };
const textValue = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();
const optional = (fd: FormData, key: string) => textValue(fd, key) || null;
const emailRx = /^\S+@\S+\.\S+$/;
const employmentTypes = ['full_time', 'part_time', 'contract', 'temporary', 'internship'] as const;
const jobStatuses = ['draft', 'open', 'on_hold', 'closed', 'cancelled'] as const;
const applicationStatuses = ['applied', 'screening', 'shortlisted', 'interview', 'evaluation', 'offer', 'hired', 'rejected', 'withdrawn', 'archived'] as const;

function validDate(value: string | null): boolean { return value === null || /^\d{4}-\d{2}-\d{2}$/.test(value); }
function errorMessage(err: unknown, fallback: string) { return err instanceof Error ? err.message : fallback; }

async function assertEmployeeTenant(organizationId: string, employeeId: string | null) {
  if (!employeeId) return;
  const rows = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId), eq(employees.employmentStatus, 'active'))).limit(1);
  if (!rows[0]) throw new Error('Selected hiring manager is not an active employee of your organization.');
}

async function assertUserTenant(organizationId: string, userId: string | null) {
  if (!userId) return;
  const rows = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, organizationId), eq(users.isActive, true))).limit(1);
  if (!rows[0]) throw new Error('Selected recruiter is not an active member of your organization.');
}

async function assertDepartmentTenant(organizationId: string, departmentId: string | null) {
  if (!departmentId) return;
  const rows = await db.select({ id: departments.id }).from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.organizationId, organizationId))).limit(1);
  if (!rows[0]) throw new Error('Selected department is not part of your organization.');
}

export async function createJobAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  const requisitionCode = textValue(fd, 'requisitionCode');
  const title = textValue(fd, 'title');
  const departmentId = optional(fd, 'departmentId');
  const location = optional(fd, 'location');
  const employmentType = textValue(fd, 'employmentType');
  const description = textValue(fd, 'description');
  const requirements = textValue(fd, 'requirements');
  const skills = optional(fd, 'skills');
  const openings = Number(textValue(fd, 'openings') || '1');
  const salaryMinRaw = optional(fd, 'salaryMin');
  const salaryMaxRaw = optional(fd, 'salaryMax');
  const salaryMin = salaryMinRaw === null ? null : Number(salaryMinRaw);
  const salaryMax = salaryMaxRaw === null ? null : Number(salaryMaxRaw);
  const currency = (textValue(fd, 'currency') || 'INR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Currency must be a 3-letter code.' };
  const hiringManagerEmployeeId = optional(fd, 'hiringManagerEmployeeId');
  const recruiterUserId = optional(fd, 'recruiterUserId');
  const openingDate = optional(fd, 'openingDate');
  const closingDate = optional(fd, 'closingDate');
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(requisitionCode)) return { error: 'Requisition code must be 3–32 characters using letters, numbers, and hyphens.' };
  if (!title || title.length > 200 || !description || !requirements) return { error: 'Title, description, and requirements are required.' };
  if (!employmentTypes.includes(employmentType as typeof employmentTypes[number])) return { error: 'Invalid employment type.' };
  if (!Number.isInteger(openings) || openings < 1 || openings > 100000) return { error: 'Openings must be a whole number between 1 and 100000.' };
  if ((salaryMin !== null && (!Number.isFinite(salaryMin) || salaryMin < 0)) || (salaryMax !== null && (!Number.isFinite(salaryMax) || salaryMax < 0)) || (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin)) return { error: 'Salary range is invalid.' };
  if (!validDate(openingDate) || !validDate(closingDate) || (openingDate && closingDate && closingDate < openingDate)) return { error: 'Opening/closing dates are invalid.' };
  const id = nanoid();
  try {
    await assertDepartmentTenant(actor.organizationId, departmentId);
    await assertEmployeeTenant(actor.organizationId, hiringManagerEmployeeId);
    await assertUserTenant(actor.organizationId, recruiterUserId);
    const existing = await db.select({ id: jobRequisitions.id }).from(jobRequisitions).where(and(eq(jobRequisitions.organizationId, actor.organizationId), eq(jobRequisitions.requisitionCode, requisitionCode))).limit(1);
    if (existing[0]) return { error: 'That requisition code is already in use.' };
    withSqliteTransactionSync(() => {
      sqlite.prepare(`INSERT INTO job_requisitions (id, organization_id, requisition_code, title, department_id, location, employment_type, description, requirements, skills, salary_min, salary_max, currency, openings, hiring_manager_employee_id, recruiter_user_id, status, opening_date, closing_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`).run(id, actor.organizationId, requisitionCode, title, departmentId, location, employmentType, description, requirements, skills, salaryMin, salaryMax, currency, openings, hiringManagerEmployeeId, recruiterUserId, openingDate, closingDate, actor.id);
      recordAuditSync({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'job_requisition_created', entityType: 'job_requisition', entityId: id });
    });
    revalidatePath('/recruitment'); revalidatePath('/recruitment/jobs');
  } catch (err) { return { error: errorMessage(err, 'Unable to create job requisition.') }; }
  redirect(`/recruitment/jobs/${id}`);
}

export async function updateJobAction(jobId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  const existing = await db.select().from(jobRequisitions).where(and(eq(jobRequisitions.id, jobId), eq(jobRequisitions.organizationId, actor.organizationId))).limit(1);
  if (!existing[0]) return { error: 'Job requisition not found.' };
  const title = textValue(fd, 'title'); const description = textValue(fd, 'description'); const requirements = textValue(fd, 'requirements');
  const departmentId = optional(fd, 'departmentId'); const location = optional(fd, 'location'); const skills = optional(fd, 'skills');
  const openings = Number(textValue(fd, 'openings') || '1'); const salaryMinRaw = optional(fd, 'salaryMin'); const salaryMaxRaw = optional(fd, 'salaryMax');
  const salaryMin = salaryMinRaw === null ? null : Number(salaryMinRaw); const salaryMax = salaryMaxRaw === null ? null : Number(salaryMaxRaw);
  const currency = (textValue(fd, 'currency') || 'INR').toUpperCase(); const hiringManagerEmployeeId = optional(fd, 'hiringManagerEmployeeId'); const recruiterUserId = optional(fd, 'recruiterUserId'); const openingDate = optional(fd, 'openingDate'); const closingDate = optional(fd, 'closingDate');
  if (!title || !description || !requirements) return { error: 'Title, description, and requirements are required.' };
  if (!Number.isInteger(openings) || openings < 1 || openings > 100000) return { error: 'Openings must be a whole number between 1 and 100000.' };
  if ((salaryMin !== null && (!Number.isFinite(salaryMin) || salaryMin < 0)) || (salaryMax !== null && (!Number.isFinite(salaryMax) || salaryMax < 0)) || (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin)) return { error: 'Salary range is invalid.' };
  if (!validDate(openingDate) || !validDate(closingDate) || (openingDate && closingDate && closingDate < openingDate)) return { error: 'Opening/closing dates are invalid.' };
  try { await assertDepartmentTenant(actor.organizationId, departmentId); await assertEmployeeTenant(actor.organizationId, hiringManagerEmployeeId); await assertUserTenant(actor.organizationId, recruiterUserId);
    withSqliteTransactionSync(() => { sqlite.prepare(`UPDATE job_requisitions SET title=?, department_id=?, location=?, description=?, requirements=?, skills=?, salary_min=?, salary_max=?, currency=?, openings=?, hiring_manager_employee_id=?, recruiter_user_id=?, opening_date=?, closing_date=?, updated_at=? WHERE organization_id=? AND id=?`).run(title, departmentId, location, description, requirements, skills, salaryMin, salaryMax, currency, openings, hiringManagerEmployeeId, recruiterUserId, openingDate, closingDate, new Date().toISOString(), actor.organizationId, jobId); recordAuditSync({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'job_requisition_updated', entityType: 'job_requisition', entityId: jobId }); });
    revalidatePath(`/recruitment/jobs/${jobId}`); revalidatePath('/recruitment/jobs'); return { error: null };
  } catch (err) { return { error: errorMessage(err, 'Unable to update job requisition.') }; }
}

export async function changeJobStatusAction(jobId: string, status: string): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');
  if (!jobStatuses.includes(status as JobStatus)) throw new Error('Invalid job status.');
  withSqliteTransactionSync(() => {
    const row = sqlite.prepare('SELECT status FROM job_requisitions WHERE organization_id = ? AND id = ?').get(actor.organizationId, jobId) as { status?: JobStatus } | undefined;
    if (!row) throw new Error('Job requisition not found.');
    if (!canTransitionJobStatus(row.status!, status as JobStatus)) throw new Error(`Cannot move a ${row.status} job to ${status}.`);
    sqlite.prepare('UPDATE job_requisitions SET status=?, updated_at=? WHERE organization_id=? AND id=?').run(status, new Date().toISOString(), actor.organizationId, jobId);
    recordAuditSync({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'job_requisition_status_changed', entityType: 'job_requisition', entityId: jobId, metadata: { previousStatus: row.status, newStatus: status } });
  });
  revalidatePath(`/recruitment/jobs/${jobId}`); revalidatePath('/recruitment/jobs'); revalidatePath('/recruitment');
}

export async function createCandidateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  const firstName = textValue(fd, 'firstName'); const lastName = textValue(fd, 'lastName'); const email = textValue(fd, 'email').toLowerCase();
  const phone = optional(fd, 'phone'); const location = optional(fd, 'location'); const headline = optional(fd, 'headline'); const summary = optional(fd, 'summary'); const source = optional(fd, 'source');
  if (!firstName || firstName.length > 100 || !lastName || lastName.length > 100 || !emailRx.test(email) || email.length > 254) return { error: 'First name, last name, and a valid email address are required.' };
  const duplicate = await db.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.organizationId, actor.organizationId), eq(candidates.email, email))).limit(1);
  if (duplicate[0]) return { error: 'A candidate with this email already exists in your organization.' };
  const id = nanoid();
  try { withSqliteTransactionSync(() => { sqlite.prepare(`INSERT INTO candidates (id, organization_id, first_name, last_name, email, phone, location, headline, summary, source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, actor.organizationId, firstName, lastName, email, phone, location, headline, summary, source, actor.id); recordAuditSync({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'candidate_created', entityType: 'candidate', entityId: id }); }); revalidatePath('/recruitment/candidates'); revalidatePath('/recruitment'); } catch (err) { return { error: errorMessage(err, 'Unable to create candidate.') }; }
  redirect(`/recruitment/candidates/${id}`);
}

export async function updateCandidateAction(candidateId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  const existing = await db.select().from(candidates).where(and(eq(candidates.id, candidateId), eq(candidates.organizationId, actor.organizationId))).limit(1); if (!existing[0]) return { error: 'Candidate not found.' };
  const firstName = textValue(fd, 'firstName'); const lastName = textValue(fd, 'lastName'); const email = textValue(fd, 'email').toLowerCase(); const phone = optional(fd, 'phone'); const location = optional(fd, 'location'); const headline = optional(fd, 'headline'); const summary = optional(fd, 'summary'); const source = optional(fd, 'source');
  if (!firstName || !lastName || !emailRx.test(email) || email.length > 254) return { error: 'First name, last name, and a valid email address are required.' };
  const duplicate = await db.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.organizationId, actor.organizationId), eq(candidates.email, email))).limit(1); if (duplicate[0] && duplicate[0].id !== candidateId) return { error: 'Another candidate with this email already exists.' };
  try { withSqliteTransactionSync(() => { sqlite.prepare(`UPDATE candidates SET first_name=?, last_name=?, email=?, phone=?, location=?, headline=?, summary=?, source=?, updated_at=? WHERE organization_id=? AND id=?`).run(firstName,lastName,email,phone,location,headline,summary,source,new Date().toISOString(),actor.organizationId,candidateId); recordAuditSync({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'candidate_updated', entityType: 'candidate', entityId: candidateId }); }); revalidatePath(`/recruitment/candidates/${candidateId}`); revalidatePath('/recruitment/candidates'); return { error: null }; } catch(err) { return { error: errorMessage(err,'Unable to update candidate.') }; }
}

export async function createApplicationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  const candidateId = textValue(fd, 'candidateId'); const requisitionId = textValue(fd, 'requisitionId'); const source = optional(fd, 'source'); const notes = optional(fd, 'notes');
  if (!candidateId || !requisitionId) return { error: 'Candidate and job are required.' };
  const candidate = await db.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.id,candidateId),eq(candidates.organizationId,actor.organizationId))).limit(1); if (!candidate[0]) return { error: 'Candidate not found in your organization.' };
  const job = await db.select({ id: jobRequisitions.id, status: jobRequisitions.status }).from(jobRequisitions).where(and(eq(jobRequisitions.id,requisitionId),eq(jobRequisitions.organizationId,actor.organizationId))).limit(1); if (!job[0]) return { error: 'Job requisition not found in your organization.' }; if (job[0].status !== 'open') return { error: 'Applications can only be created for open jobs.' };
  const existing = await db.select({ id: applications.id, status: applications.status }).from(applications).where(and(eq(applications.organizationId,actor.organizationId),eq(applications.candidateId,candidateId),eq(applications.requisitionId,requisitionId))).limit(1); if (existing[0] && !['rejected','withdrawn','archived'].includes(existing[0].status)) return { error: 'This candidate already has an active application for this job.' };
  const id=nanoid(); const reference=`APP-${new Date().getUTCFullYear()}-${nanoid(8).toUpperCase()}`;
  try { withSqliteTransactionSync(() => { sqlite.prepare(`INSERT INTO applications (id, organization_id, candidate_id, requisition_id, application_reference, status, source, current_stage, notes) VALUES (?, ?, ?, ?, ?, 'applied', ?, 'applied', ?)`).run(id,actor.organizationId,candidateId,requisitionId,reference,source,notes); sqlite.prepare(`INSERT INTO application_history (id, organization_id, application_id, previous_status, new_status, actor_user_id, reason) VALUES (?, ?, ?, NULL, 'applied', ?, ?)`).run(nanoid(),actor.organizationId,id,actor.id,'Application created'); recordAuditSync({organizationId:actor.organizationId,actorUserId:actor.id,action:'application_created',entityType:'application',entityId:id}); }); revalidatePath('/recruitment'); revalidatePath('/recruitment/applications'); revalidatePath(`/recruitment/jobs/${requisitionId}`); revalidatePath(`/recruitment/candidates/${candidateId}`); } catch(err) { return {error:errorMessage(err,'Unable to create application.')}; }
  redirect(`/recruitment/applications/${id}`);
}

export async function changeApplicationStatusAction(applicationId: string, status: string, formData?: FormData): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');
  const reason = formData?.get('reason') ? String(formData.get('reason')).trim() : undefined;
  if (!applicationStatuses.includes(status as ApplicationStatus)) throw new Error('Invalid application status.');
  withSqliteTransactionSync(() => {
    const row = sqlite.prepare('SELECT status FROM applications WHERE organization_id=? AND id=?').get(actor.organizationId,applicationId) as {status?: string}|undefined; if(!row) throw new Error('Application not found.');
    if (!applicationStatuses.includes(row.status as ApplicationStatus)) throw new Error('Application has an invalid current status.');
    const previousStatus = row.status as ApplicationStatus;
    const nextStatus = status as ApplicationStatus;
    if(!canTransitionApplicationStatus(previousStatus,nextStatus)) throw new Error(`Cannot move a ${previousStatus} application to ${nextStatus}.`);
    sqlite.prepare('UPDATE applications SET status=?, current_stage=?, updated_at=? WHERE organization_id=? AND id=?').run(nextStatus,nextStatus,new Date().toISOString(),actor.organizationId,applicationId);
    sqlite.prepare(`INSERT INTO application_history (id, organization_id, application_id, previous_status, new_status, actor_user_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(nanoid(),actor.organizationId,applicationId,previousStatus,nextStatus,actor.id,reason?.trim()||null);
    recordAuditSync({organizationId:actor.organizationId,actorUserId:actor.id,action:'application_status_changed',entityType:'application',entityId:applicationId,metadata:{previousStatus,newStatus:nextStatus,reason:reason?.trim()||null}});
  });
  revalidatePath(`/recruitment/applications/${applicationId}`); revalidatePath('/recruitment/applications'); revalidatePath('/recruitment');
}
