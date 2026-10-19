'use server';

import { db, setTenantContext } from '@/db/client';
import { applicationHistory, applications, auditLogs, candidateActivities, candidates, departments, employees, jobRequisitions, users } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { requireRoleForAction } from '@/lib/auth';
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
  const hiringManagerEmployeeId = optional(fd, 'hiringManagerEmployeeId');
  const recruiterUserId = optional(fd, 'recruiterUserId');
  const openingDate = optional(fd, 'openingDate');
  const closingDate = optional(fd, 'closingDate');
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(requisitionCode)) return { error: 'Requisition code must be 3–32 characters using letters, numbers, and hyphens.' };
  if (!title || title.length > 200 || !description || !requirements) return { error: 'Title, description, and requirements are required.' };
  if (!employmentTypes.includes(employmentType as typeof employmentTypes[number])) return { error: 'Invalid employment type.' };
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Currency must be a 3-letter code.' };
  if (!Number.isInteger(openings) || openings < 1 || openings > 100000) return { error: 'Openings must be a whole number between 1 and 100000.' };
  if ((salaryMin !== null && (!Number.isFinite(salaryMin) || salaryMin < 0)) || (salaryMax !== null && (!Number.isFinite(salaryMax) || salaryMax < 0)) || (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin)) return { error: 'Salary range is invalid.' };
  if (!validDate(openingDate) || !validDate(closingDate) || (openingDate && closingDate && closingDate < openingDate)) return { error: 'Opening/closing dates are invalid.' };
  const id = nanoid();

  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      await assertDepartmentTenant(actor.organizationId, departmentId);
      await assertEmployeeTenant(actor.organizationId, hiringManagerEmployeeId);
      await assertUserTenant(actor.organizationId, recruiterUserId);
      const existing = await tx.select({ id: jobRequisitions.id }).from(jobRequisitions).where(and(eq(jobRequisitions.organizationId, actor.organizationId), eq(jobRequisitions.requisitionCode, requisitionCode))).limit(1);
      if (existing[0]) throw new Error('That requisition code is already in use.');
      await tx.insert(jobRequisitions).values({
        id, organizationId: actor.organizationId, requisitionCode, title, departmentId, location,
        employmentType: employmentType as typeof jobRequisitions.$inferInsert.employmentType,
        description, requirements, skills, salaryMin, salaryMax, currency, openings,
        hiringManagerEmployeeId, recruiterUserId, status: 'draft', openingDate, closingDate, createdBy: actor.id,
      });
      await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'job_requisition_created', entityType: 'job_requisition', entityId: id });
    });
    revalidatePath('/recruitment'); revalidatePath('/recruitment/jobs');
  } catch (err) { return { error: errorMessage(err, 'Unable to create job requisition.') }; }
  redirect(`/recruitment/jobs/${id}`);
}

export async function updateJobAction(jobId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  const title = textValue(fd, 'title'); const description = textValue(fd, 'description'); const requirements = textValue(fd, 'requirements');
  const departmentId = optional(fd, 'departmentId'); const location = optional(fd, 'location'); const skills = optional(fd, 'skills');
  const openings = Number(textValue(fd, 'openings') || '1'); const salaryMinRaw = optional(fd, 'salaryMin'); const salaryMaxRaw = optional(fd, 'salaryMax');
  const salaryMin = salaryMinRaw === null ? null : Number(salaryMinRaw); const salaryMax = salaryMaxRaw === null ? null : Number(salaryMaxRaw);
  const currency = (textValue(fd, 'currency') || 'INR').toUpperCase(); const hiringManagerEmployeeId = optional(fd, 'hiringManagerEmployeeId'); const recruiterUserId = optional(fd, 'recruiterUserId'); const openingDate = optional(fd, 'openingDate'); const closingDate = optional(fd, 'closingDate');
  if (!title || !description || !requirements) return { error: 'Title, description, and requirements are required.' };
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Currency must be a 3-letter code.' };
  if (!Number.isInteger(openings) || openings < 1 || openings > 100000) return { error: 'Openings must be a whole number between 1 and 100000.' };
  if ((salaryMin !== null && (!Number.isFinite(salaryMin) || salaryMin < 0)) || (salaryMax !== null && (!Number.isFinite(salaryMax) || salaryMax < 0)) || (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin)) return { error: 'Salary range is invalid.' };
  if (!validDate(openingDate) || !validDate(closingDate) || (openingDate && closingDate && closingDate < openingDate)) return { error: 'Opening/closing dates are invalid.' };

  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      const existing = await tx.select({ id: jobRequisitions.id }).from(jobRequisitions).where(and(eq(jobRequisitions.id, jobId), eq(jobRequisitions.organizationId, actor.organizationId))).limit(1);
      if (!existing[0]) throw new Error('Job requisition not found.');
      await assertDepartmentTenant(actor.organizationId, departmentId); await assertEmployeeTenant(actor.organizationId, hiringManagerEmployeeId); await assertUserTenant(actor.organizationId, recruiterUserId);
      await tx.update(jobRequisitions).set({ title, departmentId, location, description, requirements, skills, salaryMin, salaryMax, currency, openings, hiringManagerEmployeeId, recruiterUserId, openingDate, closingDate, updatedAt: new Date().toISOString() }).where(and(eq(jobRequisitions.organizationId, actor.organizationId), eq(jobRequisitions.id, jobId)));
      await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'job_requisition_updated', entityType: 'job_requisition', entityId: jobId });
    });
    revalidatePath(`/recruitment/jobs/${jobId}`); revalidatePath('/recruitment/jobs'); return { error: null };
  } catch (err) { return { error: errorMessage(err, 'Unable to update job requisition.') }; }
}

export async function changeJobStatusAction(jobId: string, status: string): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');
  if (!jobStatuses.includes(status as JobStatus)) throw new Error('Invalid job status.');
  await db.transaction(async (tx) => {
    await setTenantContext(tx, actor.organizationId);
    const rows = await tx.select({ status: jobRequisitions.status }).from(jobRequisitions).where(and(eq(jobRequisitions.organizationId, actor.organizationId), eq(jobRequisitions.id, jobId))).limit(1);
    const row = rows[0]; if (!row) throw new Error('Job requisition not found.');
    if (!canTransitionJobStatus(row.status, status as JobStatus)) throw new Error(`Cannot move a ${row.status} job to ${status}.`);
    await tx.update(jobRequisitions).set({ status: status as JobStatus, updatedAt: new Date().toISOString() }).where(and(eq(jobRequisitions.organizationId, actor.organizationId), eq(jobRequisitions.id, jobId)));
    await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'job_requisition_status_changed', entityType: 'job_requisition', entityId: jobId, metadata: JSON.stringify({ previousStatus: row.status, newStatus: status }) });
  });
  revalidatePath(`/recruitment/jobs/${jobId}`); revalidatePath('/recruitment/jobs'); revalidatePath('/recruitment');
}

export async function createCandidateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  const firstName = textValue(fd, 'firstName'); const lastName = textValue(fd, 'lastName'); const email = textValue(fd, 'email').toLowerCase();
  const phone = optional(fd, 'phone'); const location = optional(fd, 'location'); const headline = optional(fd, 'headline'); const summary = optional(fd, 'summary'); const source = optional(fd, 'source');
  if (!firstName || firstName.length > 100 || !lastName || lastName.length > 100 || !emailRx.test(email) || email.length > 254) return { error: 'First name, last name, and a valid email address are required.' };
  const id = nanoid();
  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      const duplicate = await tx.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.organizationId, actor.organizationId), eq(candidates.email, email))).limit(1); if (duplicate[0]) throw new Error('A candidate with this email already exists in your organization.');
      await tx.insert(candidates).values({ id, organizationId: actor.organizationId, firstName, lastName, email, phone, location, headline, summary, source, createdBy: actor.id });
      await tx.insert(candidateActivities).values({ id: nanoid(), organizationId: actor.organizationId, candidateId: id, activityType: 'candidate_created', actorUserId: actor.id, summary: 'Candidate created' });
      await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'candidate_created', entityType: 'candidate', entityId: id });
    });
    revalidatePath('/recruitment/candidates'); revalidatePath('/recruitment');
  } catch (err) { return { error: errorMessage(err, 'Unable to create candidate.') }; }
  redirect(`/recruitment/candidates/${id}`);
}

export async function updateCandidateAction(candidateId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  const firstName = textValue(fd, 'firstName'); const lastName = textValue(fd, 'lastName'); const email = textValue(fd, 'email').toLowerCase(); const phone = optional(fd, 'phone'); const location = optional(fd, 'location'); const headline = optional(fd, 'headline'); const summary = optional(fd, 'summary'); const source = optional(fd, 'source');
  if (!firstName || !lastName || !emailRx.test(email) || email.length > 254) return { error: 'First name, last name, and a valid email address are required.' };
  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      const existing = await tx.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.id, candidateId), eq(candidates.organizationId, actor.organizationId))).limit(1); if (!existing[0]) throw new Error('Candidate not found.');
      const duplicate = await tx.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.organizationId, actor.organizationId), eq(candidates.email, email))).limit(1); if (duplicate[0] && duplicate[0].id !== candidateId) throw new Error('Another candidate with this email already exists.');
      await tx.update(candidates).set({ firstName, lastName, email, phone, location, headline, summary, source, updatedAt: new Date().toISOString() }).where(and(eq(candidates.organizationId, actor.organizationId), eq(candidates.id, candidateId)));
      await tx.insert(candidateActivities).values({ id: nanoid(), organizationId: actor.organizationId, candidateId, activityType: 'candidate_updated', actorUserId: actor.id, summary: 'Candidate profile updated' });
      await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'candidate_updated', entityType: 'candidate', entityId: candidateId });
    });
    revalidatePath(`/recruitment/candidates/${candidateId}`); revalidatePath('/recruitment/candidates'); return { error: null };
  } catch (err) { return { error: errorMessage(err, 'Unable to update candidate.') }; }
}

export async function createApplicationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireRoleForAction('admin', 'hr');
  const candidateId = textValue(fd, 'candidateId'); const requisitionId = textValue(fd, 'requisitionId'); const source = optional(fd, 'source'); const notes = optional(fd, 'notes');
  if (!candidateId || !requisitionId) return { error: 'Candidate and job are required.' };
  const id = nanoid(); const reference = `APP-${new Date().getUTCFullYear()}-${nanoid(8).toUpperCase()}`;
  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      const candidate = await tx.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.id,candidateId),eq(candidates.organizationId,actor.organizationId))).limit(1); if (!candidate[0]) throw new Error('Candidate not found in your organization.');
      const job = await tx.select({ id: jobRequisitions.id, status: jobRequisitions.status }).from(jobRequisitions).where(and(eq(jobRequisitions.id,requisitionId),eq(jobRequisitions.organizationId,actor.organizationId))).limit(1); if (!job[0]) throw new Error('Job requisition not found in your organization.'); if (job[0].status !== 'open') throw new Error('Applications can only be created for open jobs.');
      const existing = await tx.select({ id: applications.id, status: applications.status }).from(applications).where(and(eq(applications.organizationId,actor.organizationId),eq(applications.candidateId,candidateId),eq(applications.requisitionId,requisitionId))).limit(1); if (existing[0] && !['rejected','withdrawn','archived'].includes(existing[0].status)) throw new Error('This candidate already has an active application for this job.');
      await tx.insert(applications).values({ id, organizationId: actor.organizationId, candidateId, requisitionId, applicationReference: reference, status: 'applied', source, currentStage: 'applied', notes });
      await tx.insert(applicationHistory).values({ id: nanoid(), organizationId: actor.organizationId, applicationId: id, previousStatus: null, newStatus: 'applied', previousStage: null, newStage: 'applied', actorUserId: actor.id, reason: 'Application created' });
      await tx.insert(candidateActivities).values({ id: nanoid(), organizationId: actor.organizationId, candidateId, applicationId: id, activityType: 'application_created', actorUserId: actor.id, summary: `Application ${reference} created` });
      await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'application_created', entityType: 'application', entityId: id });
    });
    revalidatePath('/recruitment'); revalidatePath('/recruitment/applications'); revalidatePath(`/recruitment/jobs/${requisitionId}`); revalidatePath(`/recruitment/candidates/${candidateId}`);
  } catch (err) { return { error: errorMessage(err, 'Unable to create application.') }; }
  redirect(`/recruitment/applications/${id}`);
}

export async function changeApplicationStatusAction(applicationId: string, status: string, formData?: FormData): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');
  if (!applicationStatuses.includes(status as ApplicationStatus)) throw new Error('Invalid application status.');
  const reason = formData?.get('reason') ? String(formData.get('reason')).trim() : 'Workflow transition';

  await db.transaction(async (tx) => {
    await setTenantContext(tx, actor.organizationId);
    const rows = await tx.select({ status: applications.status, currentStage: applications.currentStage, candidateId: applications.candidateId }).from(applications).where(and(eq(applications.organizationId, actor.organizationId), eq(applications.id, applicationId))).limit(1);
    const current = rows[0]; if (!current) throw new Error('Application not found.');
    if (!canTransitionApplicationStatus(current.status, status as ApplicationStatus)) throw new Error(`Cannot move a ${current.status} application to ${status}.`);
    await tx.update(applications).set({ status: status as ApplicationStatus, currentStage: status, updatedAt: new Date().toISOString() }).where(and(eq(applications.organizationId, actor.organizationId), eq(applications.id, applicationId)));
    await tx.insert(applicationHistory).values({ id: nanoid(), organizationId: actor.organizationId, applicationId, previousStatus: current.status, newStatus: status, previousStage: current.currentStage, newStage: status, actorUserId: actor.id, reason });
    await tx.insert(candidateActivities).values({ id: nanoid(), organizationId: actor.organizationId, candidateId: current.candidateId, applicationId, activityType: 'application_status_changed', actorUserId: actor.id, summary: `Application moved from ${current.status} to ${status}`, metadata: JSON.stringify({ previousStatus: current.status, newStatus: status, reason }) });
    await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'application_status_changed', entityType: 'application', entityId: applicationId, metadata: JSON.stringify({ previousStatus: current.status, newStatus: status, reason }) });
  });
  revalidatePath(`/recruitment/applications/${applicationId}`); revalidatePath('/recruitment/applications'); revalidatePath('/recruitment');
}
