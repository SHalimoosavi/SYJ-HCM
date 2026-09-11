import { db } from '@/db/client';
import { applications, applicationHistory, candidates, departments, employees, jobRequisitions, users } from '@/db/schema';
import { and, desc, eq, like, or } from 'drizzle-orm';

export const JOB_STATUSES = ['draft', 'open', 'on_hold', 'closed', 'cancelled'] as const;
export const APPLICATION_STATUSES = ['applied', 'screening', 'shortlisted', 'interview', 'evaluation', 'offer', 'hired', 'rejected', 'withdrawn', 'archived'] as const;
export type JobStatus = typeof JOB_STATUSES[number];
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];

const jobTransitions: Record<JobStatus, readonly JobStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['on_hold', 'closed', 'cancelled'],
  on_hold: ['open', 'closed', 'cancelled'],
  closed: [],
  cancelled: []
};

const applicationTransitions: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  applied: ['screening', 'rejected', 'withdrawn'],
  screening: ['shortlisted', 'interview', 'rejected', 'withdrawn'],
  shortlisted: ['interview', 'rejected', 'withdrawn'],
  interview: ['evaluation', 'rejected', 'withdrawn'],
  evaluation: ['offer', 'rejected', 'withdrawn'],
  offer: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: ['archived'],
  withdrawn: ['archived'],
  archived: []
};

export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  return jobTransitions[from]?.includes(to) ?? false;
}

export function canTransitionApplicationStatus(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return applicationTransitions[from]?.includes(to) ?? false;
}

export async function listRecruitmentPeople(organizationId: string) {
  const [orgEmployees, orgUsers, orgDepartments] = await Promise.all([
    db.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName, designation: employees.designation })
      .from(employees).where(and(eq(employees.organizationId, organizationId), eq(employees.employmentStatus, 'active'))),
    db.select({ id: users.id, email: users.email, role: users.role })
      .from(users).where(and(eq(users.organizationId, organizationId), eq(users.isActive, true))),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.organizationId, organizationId))
  ]);
  return { employees: orgEmployees, users: orgUsers, departments: orgDepartments };
}

export async function listJobs(organizationId: string, q = '', status = '') {
  const conditions = [eq(jobRequisitions.organizationId, organizationId)];
  if (q) conditions.push(or(like(jobRequisitions.title, `%${q}%`), like(jobRequisitions.requisitionCode, `%${q}%`))!);
  if (JOB_STATUSES.includes(status as JobStatus)) conditions.push(eq(jobRequisitions.status, status as JobStatus));
  return db.select({
    id: jobRequisitions.id, requisitionCode: jobRequisitions.requisitionCode, title: jobRequisitions.title,
    status: jobRequisitions.status, openings: jobRequisitions.openings, location: jobRequisitions.location,
    employmentType: jobRequisitions.employmentType, openingDate: jobRequisitions.openingDate,
    departmentName: departments.name,
    recruiterEmail: users.email
  }).from(jobRequisitions)
    .leftJoin(departments, and(eq(jobRequisitions.departmentId, departments.id), eq(departments.organizationId, organizationId)))
    .leftJoin(users, and(eq(jobRequisitions.recruiterUserId, users.id), eq(users.organizationId, organizationId)))
    .where(and(...conditions)).orderBy(desc(jobRequisitions.createdAt));
}

export async function listCandidates(organizationId: string, q = '') {
  const conditions = [eq(candidates.organizationId, organizationId)];
  if (q) conditions.push(or(like(candidates.firstName, `%${q}%`), like(candidates.lastName, `%${q}%`), like(candidates.email, `%${q}%`), like(candidates.phone, `%${q}%`))!);
  return db.select().from(candidates).where(and(...conditions)).orderBy(desc(candidates.createdAt));
}

export async function listApplications(organizationId: string, status = '') {
  const conditions = [eq(applications.organizationId, organizationId)];
  if (APPLICATION_STATUSES.includes(status as ApplicationStatus)) conditions.push(eq(applications.status, status as ApplicationStatus));
  return db.select({
    id: applications.id, applicationReference: applications.applicationReference, status: applications.status,
    appliedAt: applications.appliedAt, candidateId: candidates.id, candidateFirstName: candidates.firstName,
    candidateLastName: candidates.lastName, candidateEmail: candidates.email, requisitionId: jobRequisitions.id,
    requisitionCode: jobRequisitions.requisitionCode, requisitionTitle: jobRequisitions.title
  }).from(applications)
    .innerJoin(candidates, and(eq(applications.candidateId, candidates.id), eq(candidates.organizationId, organizationId)))
    .innerJoin(jobRequisitions, and(eq(applications.requisitionId, jobRequisitions.id), eq(jobRequisitions.organizationId, organizationId)))
    .where(and(...conditions)).orderBy(desc(applications.updatedAt));
}

export async function getJob(organizationId: string, id: string) {
  const rows = await db.select({
    job: jobRequisitions,
    departmentName: departments.name,
    recruiterEmail: users.email,
    hiringManagerFirstName: employees.firstName,
    hiringManagerLastName: employees.lastName
  }).from(jobRequisitions)
    .leftJoin(departments, and(eq(jobRequisitions.departmentId, departments.id), eq(departments.organizationId, organizationId)))
    .leftJoin(users, and(eq(jobRequisitions.recruiterUserId, users.id), eq(users.organizationId, organizationId)))
    .leftJoin(employees, and(eq(jobRequisitions.hiringManagerEmployeeId, employees.id), eq(employees.organizationId, organizationId)))
    .where(and(eq(jobRequisitions.id, id), eq(jobRequisitions.organizationId, organizationId))).limit(1);
  return rows[0] ?? null;
}

export async function getCandidate(organizationId: string, id: string) {
  const rows = await db.select().from(candidates).where(and(eq(candidates.id, id), eq(candidates.organizationId, organizationId))).limit(1);
  if (!rows[0]) return null;
  const candidateApplications = await listApplicationsForCandidate(organizationId, id);
  return { candidate: rows[0], applications: candidateApplications };
}

export async function listApplicationsForCandidate(organizationId: string, candidateId: string) {
  return db.select({
    id: applications.id, applicationReference: applications.applicationReference, status: applications.status,
    appliedAt: applications.appliedAt, requisitionId: jobRequisitions.id, requisitionCode: jobRequisitions.requisitionCode,
    requisitionTitle: jobRequisitions.title
  }).from(applications)
    .innerJoin(jobRequisitions, and(eq(applications.requisitionId, jobRequisitions.id), eq(jobRequisitions.organizationId, organizationId)))
    .where(and(eq(applications.organizationId, organizationId), eq(applications.candidateId, candidateId)))
    .orderBy(desc(applications.appliedAt));
}

export async function getApplication(organizationId: string, id: string) {
  const rows = await db.select({
    application: applications,
    candidateFirstName: candidates.firstName, candidateLastName: candidates.lastName, candidateEmail: candidates.email,
    candidatePhone: candidates.phone, candidateLocation: candidates.location,
    requisitionCode: jobRequisitions.requisitionCode, requisitionTitle: jobRequisitions.title,
    requisitionStatus: jobRequisitions.status
  }).from(applications)
    .innerJoin(candidates, and(eq(applications.candidateId, candidates.id), eq(candidates.organizationId, organizationId)))
    .innerJoin(jobRequisitions, and(eq(applications.requisitionId, jobRequisitions.id), eq(jobRequisitions.organizationId, organizationId)))
    .where(and(eq(applications.id, id), eq(applications.organizationId, organizationId))).limit(1);
  if (!rows[0]) return null;
  const history = await db.select().from(applicationHistory)
    .where(and(eq(applicationHistory.organizationId, organizationId), eq(applicationHistory.applicationId, id)))
    .orderBy(desc(applicationHistory.createdAt));
  return { ...rows[0], history };
}
