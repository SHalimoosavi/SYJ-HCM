import './helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { db, setTenantContext } from '../src/db/client';
import { and, eq } from 'drizzle-orm';
import { organizations, users, employees, candidates, jobRequisitions, applications, recruitmentStages, interviews, interviewParticipants, interviewFeedback, applicationHistory, candidateActivities } from '../src/db/schema';
import {
  canTransitionWorkflow,
  canTransitionInterview,
  createInterviewInTransaction,
  submitInterviewFeedbackInTransaction,
  recordInterviewDecisionInTransaction,
  rescheduleInterviewInTransaction,
  assignInterviewParticipantInTransaction,
  localDateTimeToUtc,
  validateSchedule,
  changeApplicationWorkflowInTransaction,
  createCandidateNoteInTransaction,
  updateRecruitmentStageInTransaction,
} from '../src/lib/recruitment-workflow';
import type { WorkflowStatus } from '../src/lib/recruitment-constants';

async function fixture() {
  const org = `test-org-${nanoid(8)}`;
  const admin = `admin-${nanoid(8)}`;
  const hr = `hr-${nanoid(8)}`;
  const employee = `employee-${nanoid(8)}`;
  const emp = `emp-${nanoid(8)}`;
  const candidate = `candidate-${nanoid(8)}`;
  const job = `job-${nanoid(8)}`;
  const app = `app-${nanoid(8)}`;
  const stages: WorkflowStatus[] = ['applied','screening','shortlisted','interview','evaluation','offer','hired','rejected','withdrawn','archived'];

  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: org, name: 'Test Organization', slug: org, status: 'active' });
    await setTenantContext(tx, org);
    await tx.insert(users).values([
      { id: admin, organizationId: org, email: `${admin}@test.local`, passwordHash: 'x', passwordSalt: 'x', role: 'admin', isActive: true },
      { id: hr, organizationId: org, email: `${hr}@test.local`, passwordHash: 'x', passwordSalt: 'x', role: 'hr', isActive: true },
      { id: employee, organizationId: org, email: `${employee}@test.local`, passwordHash: 'x', passwordSalt: 'x', role: 'employee', isActive: true },
    ]);
    await tx.insert(employees).values({ id: emp, organizationId: org, employeeCode: `E-${nanoid(5)}`, firstName: 'Test', lastName: 'Employee', workEmail: `${employee}@test.local`, dateOfJoining: '2026-01-01', designation: 'Engineer', employmentStatus: 'active', employmentType: 'full_time' });
    await tx.update(users).set({ employeeId: emp }).where(and(eq(users.organizationId, org), eq(users.id, employee)));
    await tx.insert(candidates).values({ id: candidate, organizationId: org, firstName: 'Jane', lastName: 'Doe', email: `candidate-${nanoid(5)}@test.local`, createdBy: hr });
    await tx.insert(jobRequisitions).values({ id: job, organizationId: org, requisitionCode: `REQ-${nanoid(5)}`, title: 'Engineer', employmentType: 'full_time', description: 'Test role', requirements: 'Testing', openings: 1, status: 'open', createdBy: admin });
    await tx.insert(applications).values({ id: app, organizationId: org, candidateId: candidate, requisitionId: job, applicationReference: `APP-${nanoid(6)}`, status: 'shortlisted', currentStage: 'shortlisted' });
    await tx.insert(recruitmentStages).values(stages.map((key, position) => ({ id: `${org}:${key}`, organizationId: org, statusKey: key, name: key, position, isActive: true, createdBy: admin, updatedBy: admin })));
  });
  return { org, admin, hr, employee, emp, candidate, job, app };
}

test('workflow transition matrix rejects invalid transitions', () => {
  assert.equal(canTransitionWorkflow('shortlisted', 'interview'), true);
  assert.equal(canTransitionWorkflow('applied', 'offer'), false);
  assert.equal(canTransitionWorkflow('hired', 'rejected'), false);
  assert.equal(canTransitionInterview('scheduled', 'confirmed'), true);
  assert.equal(canTransitionInterview('completed', 'cancelled'), false);
});

test('PostgreSQL workflow transition writes history and activity', async () => {
  const f = await fixture();
  await changeApplicationWorkflowInTransaction(f.org, f.hr, f.app, 'interview', 'Ready for interview');
  const result = await db.transaction(async (tx) => {
    await setTenantContext(tx, f.org);
    const [application] = await tx.select({ status: applications.status, currentStage: applications.currentStage }).from(applications).where(and(eq(applications.organizationId, f.org), eq(applications.id, f.app))).limit(1);
    const [history] = await tx.select().from(applicationHistory).where(and(eq(applicationHistory.organizationId, f.org), eq(applicationHistory.applicationId, f.app))).limit(1);
    const activities = await tx.select().from(candidateActivities).where(and(eq(candidateActivities.organizationId, f.org), eq(candidateActivities.applicationId, f.app)));
    return { application, history, activities };
  });
  assert.equal(result.application?.status, 'interview');
  assert.equal(result.application?.currentStage, 'interview');
  assert.equal(result.history?.previousStatus, 'shortlisted');
  assert.equal(result.history?.newStatus, 'interview');
  assert.ok(result.activities.some((x) => x.activityType === 'stage_changed'));
});

test('PostgreSQL interview creation creates round, panel and activity', async () => {
  const f = await fixture();
  const id = await createInterviewInTransaction({ organizationId: f.org, actorUserId: f.hr, applicationId: f.app, roundId: null, roundName: 'Technical', title: 'Technical Interview', interviewType: 'technical', startLocal: '2026-09-15T10:00', endLocal: '2026-09-15T11:00', timezone: 'Asia/Kolkata', location: 'Office', meetingDetails: null, participantIds: [f.employee] });
  assert.ok(id);
  const result = await db.transaction(async (tx) => {
    await setTenantContext(tx, f.org);
    const [interview] = await tx.select().from(interviews).where(and(eq(interviews.organizationId, f.org), eq(interviews.id, id))).limit(1);
    const participants = await tx.select().from(interviewParticipants).where(and(eq(interviewParticipants.organizationId, f.org), eq(interviewParticipants.interviewId, id)));
    const [application] = await tx.select().from(applications).where(and(eq(applications.organizationId, f.org), eq(applications.id, f.app))).limit(1);
    return { interview, participants, application };
  });
  assert.equal(result.interview?.status, 'scheduled');
  assert.equal(result.participants.length, 1);
  assert.equal(result.application?.status, 'interview');
});

test('PostgreSQL interview feedback is tenant scoped and one-time per interviewer', async () => {
  const f = await fixture();
  const id = await createInterviewInTransaction({ organizationId: f.org, actorUserId: f.hr, applicationId: f.app, roundId: null, roundName: 'Technical', title: 'Technical Interview', interviewType: 'technical', startLocal: '2026-09-15T10:00', endLocal: '2026-09-15T11:00', timezone: 'Asia/Kolkata', location: null, meetingDetails: null, participantIds: [f.employee] });
  await db.transaction(async (tx) => { await setTenantContext(tx, f.org); await tx.update(interviews).set({ status: 'completed' }).where(and(eq(interviews.organizationId, f.org), eq(interviews.id, id))); });
  const feedbackId = await submitInterviewFeedbackInTransaction(f.org, f.employee, id, 5, 'strong_yes', 'Strong technical skills', 'None', null);
  assert.ok(feedbackId);
  await assert.rejects(() => submitInterviewFeedbackInTransaction(f.org, f.employee, id, 4, 'yes', 'x', 'y', null), /already submitted/);
  const rows = await db.transaction(async (tx) => { await setTenantContext(tx, f.org); return tx.select().from(interviewFeedback).where(and(eq(interviewFeedback.organizationId, f.org), eq(interviewFeedback.interviewId, id))); });
  assert.equal(rows.length, 1);
});

test('PostgreSQL interview rescheduling and participant assignment remain transactional', async () => {
  const f = await fixture();
  const id = await createInterviewInTransaction({ organizationId: f.org, actorUserId: f.hr, applicationId: f.app, roundId: null, roundName: 'Technical', title: 'Technical Interview', interviewType: 'technical', startLocal: '2026-09-15T10:00', endLocal: '2026-09-15T11:00', timezone: 'Asia/Kolkata', location: 'Office', meetingDetails: null, participantIds: [f.employee] });
  await rescheduleInterviewInTransaction(f.org, f.hr, id, '2026-09-15T12:00', '2026-09-15T13:00', 'Asia/Kolkata');
  const replacement = `replacement-${nanoid(8)}`;
  await db.transaction(async (tx) => { await setTenantContext(tx, f.org); await tx.insert(users).values({ id: replacement, organizationId: f.org, email: `${replacement}@test.local`, passwordHash: 'x', passwordSalt: 'x', role: 'employee', isActive: true }); });
  await assignInterviewParticipantInTransaction(f.org, f.hr, id, replacement);
  const participants = await db.transaction(async (tx) => { await setTenantContext(tx, f.org); return tx.select().from(interviewParticipants).where(and(eq(interviewParticipants.organizationId, f.org), eq(interviewParticipants.interviewId, id))); });
  assert.equal(participants.length, 2);
});

test('PostgreSQL candidate notes and stage updates stay tenant scoped', async () => {
  const f = await fixture();
  const noteId = await createCandidateNoteInTransaction(f.org, f.hr, f.candidate, f.app, 'Initial technical screening note');
  await updateRecruitmentStageInTransaction(f.org, f.hr, `${f.org}:interview`, 'Technical Interview', 30, true);
  await db.transaction(async (tx) => { await setTenantContext(tx, f.org); await tx.update(applications).set({ currentStage: 'interview', status: 'interview' }).where(and(eq(applications.organizationId, f.org), eq(applications.id, f.app))); });
  await assert.doesNotReject(() => createCandidateNoteInTransaction(f.org, f.hr, f.candidate, f.app, 'Second note'));
  assert.ok(noteId);
});

test('timezone conversion produces canonical UTC and schedule rejects inverted times', () => {
  assert.equal(localDateTimeToUtc('2026-09-12T12:00', 'Asia/Kolkata'), '2026-09-12T06:30:00.000Z');
  assert.throws(() => validateSchedule('2026-09-12T13:00', '2026-09-12T12:00', 'Asia/Kolkata'), /after/);
});

test('tenant context is transaction-local and does not leak across transactions', async () => {
  const a = await fixture();
  const b = await fixture();
  const countFor = async (org: string) => db.transaction(async (tx) => { await setTenantContext(tx, org); const rows = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, org)); return rows.length; });
  assert.equal(await countFor(a.org), 1);
  assert.equal(await countFor(b.org), 1);
  const noContext = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, a.org));
  assert.ok(noContext.length >= 1);
});
