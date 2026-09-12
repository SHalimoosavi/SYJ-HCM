import { sqliteTable, text, integer, real, index, uniqueIndex, foreignKey } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Organizations / tenant root
// ---------------------------------------------------------------------------

export const organizations = sqliteTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    slugIdx: uniqueIndex('organizations_slug_idx').on(t.slug)
  })
);

// ---------------------------------------------------------------------------
// Core reference tables
// ---------------------------------------------------------------------------

export const organizationSettings = sqliteTable(
  'organization_settings',
  {
    organizationId: text('organization_id').primaryKey().references(() => organizations.id, { onDelete: 'restrict' }),
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en-IN'),
    dateFormat: text('date_format').notNull().default('YYYY-MM-DD'),
    weekStartDay: integer('week_start_day').notNull().default(1),
    publicCareersEnabled: integer('public_careers_enabled', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  }
);

export const departments = sqliteTable(
  'departments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    organizationIdx: index('departments_organization_idx').on(t.organizationId),
    organizationIdIdIdx: uniqueIndex('departments_organization_id_idx').on(t.organizationId, t.id)
  })
);

// ---------------------------------------------------------------------------
// Auth: users, roles, sessions
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    role: text('role', { enum: ['admin', 'hr', 'employee'] }).notNull().default('employee'),
    employeeId: text('employee_id').references(() => employees.id, { onDelete: 'set null' }),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
    organizationIdx: index('users_organization_idx').on(t.organizationId),
    organizationIdIdIdx: uniqueIndex('users_organization_id_idx').on(t.organizationId, t.id)
  })
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    lastActiveAt: text('last_active_at').notNull().default(sql`(current_timestamp)`),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.organizationId, t.userId),
    organizationIdx: index('sessions_organization_idx').on(t.organizationId)
  })
);

export const loginRateLimits = sqliteTable(
  'login_rate_limits',
  {
    key: text('key').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    windowStartedAt: text('window_started_at').notNull(),
    lockedUntil: text('locked_until'),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    organizationIdx: index('login_rate_limits_organization_idx').on(t.organizationId),
    updatedIdx: index('login_rate_limits_updated_idx').on(t.organizationId, t.updatedAt)
  })
);

export const platformAdministrators = sqliteTable(
  'platform_administrators',
  {
    userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
  }
);

export const platformAuditLogs = sqliteTable(
  'platform_audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: text('metadata'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    entityIdx: index('platform_audit_entity_idx').on(t.entityType, t.entityId),
    actorIdx: index('platform_audit_actor_idx').on(t.actorUserId)
  })
);

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export const employees = sqliteTable(
  'employees',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    employeeCode: text('employee_code').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    workEmail: text('work_email').notNull(),
    personalEmail: text('personal_email'),
    phone: text('phone'),
    dateOfBirth: text('date_of_birth'),
    dateOfJoining: text('date_of_joining').notNull(),
    departmentId: text('department_id').references(() => departments.id, { onDelete: 'set null' }),
    designation: text('designation').notNull(),
    employmentStatus: text('employment_status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    employmentType: text('employment_type', { enum: ['full_time', 'part_time', 'contract', 'intern'] })
      .notNull()
      .default('full_time'),
    managerId: text('manager_id'),
    location: text('location'),
    address: text('address'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    codeIdx: uniqueIndex('employees_code_idx').on(t.organizationId, t.employeeCode),
    emailIdx: uniqueIndex('employees_work_email_idx').on(t.organizationId, t.workEmail),
    deptIdx: index('employees_department_idx').on(t.organizationId, t.departmentId),
    statusIdx: index('employees_status_idx').on(t.organizationId, t.employmentStatus),
    organizationIdIdIdx: uniqueIndex('employees_organization_id_idx').on(t.organizationId, t.id)
  })
);

// ---------------------------------------------------------------------------
// Recruitment / ATS
// ---------------------------------------------------------------------------

export const jobRequisitions = sqliteTable(
  'job_requisitions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    requisitionCode: text('requisition_code').notNull(),
    title: text('title').notNull(),
    departmentId: text('department_id'),
    location: text('location'),
    employmentType: text('employment_type', { enum: ['full_time', 'part_time', 'contract', 'temporary', 'internship'] }).notNull(),
    description: text('description').notNull(),
    requirements: text('requirements').notNull(),
    skills: text('skills'),
    salaryMin: real('salary_min'),
    salaryMax: real('salary_max'),
    currency: text('currency').notNull().default('INR'),
    openings: integer('openings').notNull().default(1),
    hiringManagerEmployeeId: text('hiring_manager_employee_id'),
    recruiterUserId: text('recruiter_user_id'),
    status: text('status', { enum: ['draft', 'open', 'on_hold', 'closed', 'cancelled'] }).notNull().default('draft'),
    openingDate: text('opening_date'),
    closingDate: text('closing_date'),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    codeIdx: uniqueIndex('job_requisitions_code_idx').on(t.organizationId, t.requisitionCode),
    organizationIdIdIdx: uniqueIndex('job_requisitions_organization_id_idx').on(t.organizationId, t.id),
    statusIdx: index('job_requisitions_status_idx').on(t.organizationId, t.status),
    departmentIdx: index('job_requisitions_department_idx').on(t.organizationId, t.departmentId),
    recruiterIdx: index('job_requisitions_recruiter_idx').on(t.organizationId, t.recruiterUserId),
    hiringManagerIdx: index('job_requisitions_hiring_manager_idx').on(t.organizationId, t.hiringManagerEmployeeId),
    createdIdx: index('job_requisitions_created_idx').on(t.organizationId, t.createdAt),
    organizationCodeFk: foreignKey({ columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id], name: 'job_requisitions_department_tenant_fk' }),
    organizationHiringManagerFk: foreignKey({ columns: [t.organizationId, t.hiringManagerEmployeeId], foreignColumns: [employees.organizationId, employees.id], name: 'job_requisitions_hiring_manager_tenant_fk' }),
    organizationRecruiterFk: foreignKey({ columns: [t.organizationId, t.recruiterUserId], foreignColumns: [users.organizationId, users.id], name: 'job_requisitions_recruiter_tenant_fk' }),
    organizationCreatorFk: foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id], name: 'job_requisitions_creator_tenant_fk' })
  })
);

export const candidates = sqliteTable(
  'candidates',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    location: text('location'),
    headline: text('headline'),
    summary: text('summary'),
    source: text('source'),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    emailIdx: uniqueIndex('candidates_email_idx').on(t.organizationId, t.email),
    organizationIdIdIdx: uniqueIndex('candidates_organization_id_idx').on(t.organizationId, t.id),
    nameIdx: index('candidates_name_idx').on(t.organizationId, t.lastName, t.firstName),
    createdIdx: index('candidates_created_idx').on(t.organizationId, t.createdAt),
    creatorFk: foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id], name: 'candidates_creator_tenant_fk' })
  })
);

export const applications = sqliteTable(
  'applications',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    candidateId: text('candidate_id').notNull(),
    requisitionId: text('requisition_id').notNull(),
    applicationReference: text('application_reference').notNull(),
    status: text('status', { enum: ['applied', 'screening', 'shortlisted', 'interview', 'evaluation', 'offer', 'hired', 'rejected', 'withdrawn', 'archived'] }).notNull().default('applied'),
    appliedAt: text('applied_at').notNull().default(sql`(current_timestamp)`),
    source: text('source'),
    currentStage: text('current_stage').notNull().default('applied'),
    notes: text('notes'),
    publicCoverLetter: text('public_cover_letter'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    referenceIdx: uniqueIndex('applications_reference_idx').on(t.organizationId, t.applicationReference),
    organizationIdIdIdx: uniqueIndex('applications_organization_id_idx').on(t.organizationId, t.id),
    organizationIdIdCandidateIdx: uniqueIndex('applications_organization_id_id_candidate_idx').on(t.organizationId,t.id,t.candidateId),
    candidateIdx: index('applications_candidate_idx').on(t.organizationId, t.candidateId),
    requisitionIdx: index('applications_requisition_idx').on(t.organizationId, t.requisitionId),
    statusIdx: index('applications_status_idx').on(t.organizationId, t.status),
    createdIdx: index('applications_created_idx').on(t.organizationId, t.createdAt),
    candidateFk: foreignKey({ columns: [t.organizationId, t.candidateId], foreignColumns: [candidates.organizationId, candidates.id], name: 'applications_candidate_tenant_fk' }),
    requisitionFk: foreignKey({ columns: [t.organizationId, t.requisitionId], foreignColumns: [jobRequisitions.organizationId, jobRequisitions.id], name: 'applications_requisition_tenant_fk' })
  })
);

export const applicationHistory = sqliteTable(
  'application_history',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    applicationId: text('application_id').notNull(),
    previousStatus: text('previous_status'),
    newStatus: text('new_status').notNull(),
    previousStage: text('previous_stage'),
    newStage: text('new_stage'),
    note: text('note'),
    actorUserId: text('actor_user_id').notNull(),
    reason: text('reason'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    applicationIdx: index('application_history_application_idx').on(t.organizationId, t.applicationId, t.createdAt),
    actorIdx: index('application_history_actor_idx').on(t.organizationId, t.actorUserId),
    applicationFk: foreignKey({ columns: [t.organizationId, t.applicationId], foreignColumns: [applications.organizationId, applications.id], name: 'application_history_application_tenant_fk' }),
    actorFk: foreignKey({ columns: [t.organizationId, t.actorUserId], foreignColumns: [users.organizationId, users.id], name: 'application_history_actor_tenant_fk' })
  })
);

// ---------------------------------------------------------------------------
// Phase 2.2 recruitment workflow / interviews
// ---------------------------------------------------------------------------

export const recruitmentStages = sqliteTable('recruitment_stages', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  statusKey: text('status_key', { enum: ['applied','screening','shortlisted','interview','evaluation','offer','hired','rejected','withdrawn','archived'] }).notNull(),
  name: text('name').notNull(), position: integer('position').notNull(), isActive: integer('is_active',{mode:'boolean'}).notNull().default(true),
  createdBy: text('created_by').notNull(), updatedBy: text('updated_by').notNull(), createdAt: text('created_at').notNull().default(sql`(current_timestamp)`), updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
}, (t) => ({ statusIdx: uniqueIndex('recruitment_stages_status_idx').on(t.organizationId,t.statusKey), organizationIdIdIdx: uniqueIndex('recruitment_stages_organization_id_idx').on(t.organizationId,t.id), creatorFk: foreignKey({columns:[t.organizationId,t.createdBy],foreignColumns:[users.organizationId,users.id],name:'recruitment_stages_creator_tenant_fk'}), updaterFk: foreignKey({columns:[t.organizationId,t.updatedBy],foreignColumns:[users.organizationId,users.id],name:'recruitment_stages_updater_tenant_fk'}) }));

export const interviewRounds = sqliteTable('interview_rounds', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id,{onDelete:'restrict'}), applicationId: text('application_id').notNull(), roundNumber: integer('round_number').notNull(), name: text('name').notNull(), stageStatus: text('stage_status',{enum:['screening','shortlisted','interview','evaluation','offer']}).notNull().default('interview'), createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull().default(sql`(current_timestamp)`), updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
}, (t) => ({ uniqueRound: uniqueIndex('interview_rounds_unique_idx').on(t.organizationId,t.applicationId,t.roundNumber), organizationIdIdIdx: uniqueIndex('interview_rounds_organization_id_idx').on(t.organizationId,t.id), organizationIdIdApplicationIdx: uniqueIndex('interview_rounds_organization_id_id_application_idx').on(t.organizationId,t.id,t.applicationId), applicationFk: foreignKey({columns:[t.organizationId,t.applicationId],foreignColumns:[applications.organizationId,applications.id],name:'interview_rounds_application_tenant_fk'}), creatorFk: foreignKey({columns:[t.organizationId,t.createdBy],foreignColumns:[users.organizationId,users.id],name:'interview_rounds_creator_tenant_fk'}) }));

export const interviews = sqliteTable('interviews', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id,{onDelete:'restrict'}), applicationId: text('application_id').notNull(), roundId: text('round_id').notNull(), title: text('title').notNull(), interviewType: text('interview_type').notNull(), status: text('status',{enum:['scheduled','confirmed','completed','cancelled','rescheduled','no_show']}).notNull().default('scheduled'), scheduledStart: text('scheduled_start').notNull(), scheduledEnd: text('scheduled_end').notNull(), timezone: text('timezone').notNull(), location: text('location'), meetingDetails: text('meeting_details'), organizerUserId: text('organizer_user_id').notNull(), createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull().default(sql`(current_timestamp)`), updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
}, (t) => ({ organizationIdIdIdx: uniqueIndex('interviews_organization_id_idx').on(t.organizationId,t.id), organizationIdIdApplicationIdx: uniqueIndex('interviews_organization_id_id_application_idx').on(t.organizationId,t.id,t.applicationId), applicationIdx: index('interviews_application_idx').on(t.organizationId,t.applicationId,t.scheduledStart), statusStartIdx: index('interviews_status_start_idx').on(t.organizationId,t.status,t.scheduledStart), roundIdx: index('interviews_round_idx').on(t.organizationId,t.roundId), applicationFk: foreignKey({columns:[t.organizationId,t.applicationId],foreignColumns:[applications.organizationId,applications.id],name:'interviews_application_tenant_fk'}), roundFk: foreignKey({columns:[t.organizationId,t.roundId,t.applicationId],foreignColumns:[interviewRounds.organizationId,interviewRounds.id,interviewRounds.applicationId],name:'interviews_round_tenant_fk'}), organizerFk: foreignKey({columns:[t.organizationId,t.organizerUserId],foreignColumns:[users.organizationId,users.id],name:'interviews_organizer_tenant_fk'}), creatorFk: foreignKey({columns:[t.organizationId,t.createdBy],foreignColumns:[users.organizationId,users.id],name:'interviews_creator_tenant_fk'}) }));

export const interviewParticipants = sqliteTable('interview_participants', {
  id:text('id').primaryKey(), organizationId:text('organization_id').notNull().references(()=>organizations.id,{onDelete:'restrict'}), interviewId:text('interview_id').notNull(), userId:text('user_id').notNull(), role:text('role',{enum:['interviewer','observer']}).notNull().default('interviewer'), assignedBy:text('assigned_by').notNull(), createdAt:text('created_at').notNull().default(sql`(current_timestamp)`)
}, (t)=>({ uniqueParticipant:uniqueIndex('interview_participants_unique_idx').on(t.organizationId,t.interviewId,t.userId), organizationIdIdIdx:uniqueIndex('interview_participants_organization_id_idx').on(t.organizationId,t.id), interviewFk:foreignKey({columns:[t.organizationId,t.interviewId],foreignColumns:[interviews.organizationId,interviews.id],name:'interview_participants_interview_tenant_fk'}), userFk:foreignKey({columns:[t.organizationId,t.userId],foreignColumns:[users.organizationId,users.id],name:'interview_participants_user_tenant_fk'}), assignerFk:foreignKey({columns:[t.organizationId,t.assignedBy],foreignColumns:[users.organizationId,users.id],name:'interview_participants_assigner_tenant_fk'}), userIdx:index('interview_participants_user_idx').on(t.organizationId,t.userId,t.interviewId) }));

export const interviewFeedback = sqliteTable('interview_feedback', {
  id:text('id').primaryKey(), organizationId:text('organization_id').notNull().references(()=>organizations.id,{onDelete:'restrict'}), interviewId:text('interview_id').notNull(), interviewerUserId:text('interviewer_user_id').notNull(), score:integer('score').notNull(), recommendation:text('recommendation',{enum:['strong_yes','yes','neutral','no','strong_no']}).notNull(), strengths:text('strengths').notNull(), concerns:text('concerns').notNull(), notes:text('notes'), submittedAt:text('submitted_at').notNull().default(sql`(current_timestamp)`)
}, (t)=>({ uniqueFeedback:uniqueIndex('interview_feedback_unique_idx').on(t.organizationId,t.interviewId,t.interviewerUserId), organizationIdIdIdx:uniqueIndex('interview_feedback_organization_id_idx').on(t.organizationId,t.id), interviewIdx:index('interview_feedback_interview_idx').on(t.organizationId,t.interviewId,t.submittedAt), interviewerIdx:index('interview_feedback_interviewer_idx').on(t.organizationId,t.interviewerUserId,t.submittedAt), interviewFk:foreignKey({columns:[t.organizationId,t.interviewId],foreignColumns:[interviews.organizationId,interviews.id],name:'interview_feedback_interview_tenant_fk'}), participantFk:foreignKey({columns:[t.organizationId,t.interviewId,t.interviewerUserId],foreignColumns:[interviewParticipants.organizationId,interviewParticipants.interviewId,interviewParticipants.userId],name:'interview_feedback_participant_tenant_fk'}), interviewerFk:foreignKey({columns:[t.organizationId,t.interviewerUserId],foreignColumns:[users.organizationId,users.id],name:'interview_feedback_interviewer_tenant_fk'}) }));

export const interviewFeedbackCorrections = sqliteTable('interview_feedback_corrections', {
  id:text('id').primaryKey(), organizationId:text('organization_id').notNull().references(()=>organizations.id,{onDelete:'restrict'}), feedbackId:text('feedback_id').notNull(), previousScore:integer('previous_score').notNull(), previousRecommendation:text('previous_recommendation').notNull(), previousStrengths:text('previous_strengths').notNull(), previousConcerns:text('previous_concerns').notNull(), previousNotes:text('previous_notes'), newScore:integer('new_score').notNull(), newRecommendation:text('new_recommendation').notNull(), newStrengths:text('new_strengths').notNull(), newConcerns:text('new_concerns').notNull(), newNotes:text('new_notes'), correctedBy:text('corrected_by').notNull(), reason:text('reason').notNull(), createdAt:text('created_at').notNull().default(sql`(current_timestamp)`)
}, (t)=>({ organizationIdIdIdx:uniqueIndex('interview_feedback_corrections_organization_id_idx').on(t.organizationId,t.id), feedbackIdx:index('interview_feedback_corrections_feedback_idx').on(t.organizationId,t.feedbackId,t.createdAt), feedbackFk:foreignKey({columns:[t.organizationId,t.feedbackId],foreignColumns:[interviewFeedback.organizationId,interviewFeedback.id],name:'interview_feedback_corrections_feedback_tenant_fk'}), actorFk:foreignKey({columns:[t.organizationId,t.correctedBy],foreignColumns:[users.organizationId,users.id],name:'interview_feedback_corrections_actor_tenant_fk'}) }));

export const interviewDecisions = sqliteTable('interview_decisions', {
  id:text('id').primaryKey(), organizationId:text('organization_id').notNull().references(()=>organizations.id,{onDelete:'restrict'}), interviewId:text('interview_id').notNull(), applicationId:text('application_id').notNull(), outcome:text('outcome',{enum:['advance','hold','reject']}).notNull(), rationale:text('rationale').notNull(), decidedBy:text('decided_by').notNull(), createdAt:text('created_at').notNull().default(sql`(current_timestamp)`)
}, (t)=>({ uniqueDecision:uniqueIndex('interview_decisions_unique_idx').on(t.organizationId,t.interviewId), organizationIdIdIdx:uniqueIndex('interview_decisions_organization_id_idx').on(t.organizationId,t.id), applicationIdx:index('interview_decisions_application_idx').on(t.organizationId,t.applicationId,t.createdAt), interviewApplicationFk:foreignKey({columns:[t.organizationId,t.interviewId,t.applicationId],foreignColumns:[interviews.organizationId,interviews.id,interviews.applicationId],name:'interview_decisions_interview_application_tenant_fk'}), interviewFk:foreignKey({columns:[t.organizationId,t.interviewId],foreignColumns:[interviews.organizationId,interviews.id],name:'interview_decisions_interview_tenant_fk'}), applicationFk:foreignKey({columns:[t.organizationId,t.applicationId],foreignColumns:[applications.organizationId,applications.id],name:'interview_decisions_application_tenant_fk'}), actorFk:foreignKey({columns:[t.organizationId,t.decidedBy],foreignColumns:[users.organizationId,users.id],name:'interview_decisions_actor_tenant_fk'}) }));

export const candidateNotes = sqliteTable('candidate_notes', {
  id:text('id').primaryKey(), organizationId:text('organization_id').notNull().references(()=>organizations.id,{onDelete:'restrict'}), candidateId:text('candidate_id').notNull(), applicationId:text('application_id'), authorUserId:text('author_user_id').notNull(), content:text('content').notNull(), createdAt:text('created_at').notNull().default(sql`(current_timestamp)`), updatedAt:text('updated_at').notNull().default(sql`(current_timestamp)`)
}, (t)=>({ organizationIdIdIdx:uniqueIndex('candidate_notes_organization_id_idx').on(t.organizationId,t.id), candidateIdx:index('candidate_notes_candidate_idx').on(t.organizationId,t.candidateId,t.createdAt), applicationIdx:index('candidate_notes_application_idx').on(t.organizationId,t.applicationId,t.createdAt), candidateFk:foreignKey({columns:[t.organizationId,t.candidateId],foreignColumns:[candidates.organizationId,candidates.id],name:'candidate_notes_candidate_tenant_fk'}), applicationFk:foreignKey({columns:[t.organizationId,t.applicationId,t.candidateId],foreignColumns:[applications.organizationId,applications.id,applications.candidateId],name:'candidate_notes_application_tenant_fk'}), authorFk:foreignKey({columns:[t.organizationId,t.authorUserId],foreignColumns:[users.organizationId,users.id],name:'candidate_notes_author_tenant_fk'}) }));

export const candidateActivities = sqliteTable('candidate_activities', {
  id:text('id').primaryKey(), organizationId:text('organization_id').notNull().references(()=>organizations.id,{onDelete:'restrict'}), candidateId:text('candidate_id').notNull(), applicationId:text('application_id'), interviewId:text('interview_id'), activityType:text('activity_type').notNull(), actorUserId:text('actor_user_id').notNull(), summary:text('summary').notNull(), metadata:text('metadata'), createdAt:text('created_at').notNull().default(sql`(current_timestamp)`)
}, (t)=>({ organizationIdIdIdx:uniqueIndex('candidate_activities_organization_id_idx').on(t.organizationId,t.id), timelineIdx:index('candidate_activities_timeline_idx').on(t.organizationId,t.candidateId,t.createdAt,t.id), applicationIdx:index('candidate_activities_application_idx').on(t.organizationId,t.applicationId,t.createdAt), interviewIdx:index('candidate_activities_interview_idx').on(t.organizationId,t.interviewId,t.createdAt), candidateFk:foreignKey({columns:[t.organizationId,t.candidateId],foreignColumns:[candidates.organizationId,candidates.id],name:'candidate_activities_candidate_tenant_fk'}), applicationFk:foreignKey({columns:[t.organizationId,t.applicationId,t.candidateId],foreignColumns:[applications.organizationId,applications.id,applications.candidateId],name:'candidate_activities_application_tenant_fk'}), interviewFk:foreignKey({columns:[t.organizationId,t.interviewId,t.applicationId],foreignColumns:[interviews.organizationId,interviews.id,interviews.applicationId],name:'candidate_activities_interview_tenant_fk'}), actorFk:foreignKey({columns:[t.organizationId,t.actorUserId],foreignColumns:[users.organizationId,users.id],name:'candidate_activities_actor_tenant_fk'}) }));

// ---------------------------------------------------------------------------
// Leave management
// ---------------------------------------------------------------------------

export const leaveTypes = sqliteTable(
  'leave_types',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    annualQuota: real('annual_quota').notNull(),
    isPaid: integer('is_paid', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    organizationIdx: index('leave_types_organization_idx').on(t.organizationId)
  })
);

export const leaveBalances = sqliteTable(
  'leave_balances',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: text('leave_type_id').notNull().references(() => leaveTypes.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    allocated: real('allocated').notNull(),
    used: real('used').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    uniquePerYear: uniqueIndex('leave_balances_unique').on(t.organizationId, t.employeeId, t.leaveTypeId, t.year),
    employeeIdx: index('leave_balances_employee_idx').on(t.organizationId, t.employeeId)
  })
);

export const leaveRequests = sqliteTable(
  'leave_requests',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: text('leave_type_id').notNull().references(() => leaveTypes.id, { onDelete: 'restrict' }),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    days: real('days').notNull(),
    reason: text('reason'),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'cancelled'] })
      .notNull()
      .default('pending'),
    approverId: text('approver_id').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: text('approved_at'),
    rejectionReason: text('rejection_reason'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    employeeIdx: index('leave_requests_employee_idx').on(t.organizationId, t.employeeId),
    statusIdx: index('leave_requests_status_idx').on(t.organizationId, t.status)
  })
);

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const attendanceRecords = sqliteTable(
  'attendance_records',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    workDate: text('work_date').notNull(),
    clockInAt: text('clock_in_at'),
    clockOutAt: text('clock_out_at'),
    clockInLat: real('clock_in_lat'),
    clockInLng: real('clock_in_lng'),
    clockOutLat: real('clock_out_lat'),
    clockOutLng: real('clock_out_lng'),
    status: text('status', { enum: ['present', 'on_leave', 'absent'] }).notNull().default('present'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    uniquePerDay: uniqueIndex('attendance_employee_date_idx').on(t.organizationId, t.employeeId, t.workDate),
    dateIdx: index('attendance_date_idx').on(t.organizationId, t.workDate)
  })
);

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: text('metadata'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    entityIdx: index('audit_entity_idx').on(t.organizationId, t.entityType, t.entityId),
    actorIdx: index('audit_actor_idx').on(t.organizationId, t.actorUserId)
  })
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  departments: many(departments),
  employees: many(employees),
  users: many(users),
  sessions: many(sessions),
  loginRateLimits: many(loginRateLimits),
  leaveTypes: many(leaveTypes),
  leaveBalances: many(leaveBalances),
  leaveRequests: many(leaveRequests),
  attendanceRecords: many(attendanceRecords),
  auditLogs: many(auditLogs),
  jobRequisitions: many(jobRequisitions),
  candidates: many(candidates),
  applications: many(applications),
  applicationHistory: many(applicationHistory),
  publicJobPublications: many(jobPublications),
  settings: one(organizationSettings, { fields: [organizations.id], references: [organizationSettings.organizationId] })
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  organization: one(organizations, { fields: [employees.organizationId], references: [organizations.id] }),
  department: one(departments, { fields: [employees.departmentId], references: [departments.id] }),
  manager: one(employees, { fields: [employees.managerId], references: [employees.id] }),
  user: many(users),
  leaveRequests: many(leaveRequests),
  leaveBalances: many(leaveBalances),
  attendanceRecords: many(attendanceRecords),
  jobRequisitions: many(jobRequisitions)
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, { fields: [users.organizationId], references: [organizations.id] }),
  employee: one(employees, { fields: [users.employeeId], references: [employees.id] }),
  sessions: many(sessions)
}));

export const jobRequisitionsRelations = relations(jobRequisitions, ({ one, many }) => ({
  organization: one(organizations, { fields: [jobRequisitions.organizationId], references: [organizations.id] }),
  department: one(departments, { fields: [jobRequisitions.departmentId], references: [departments.id] }),
  hiringManager: one(employees, { fields: [jobRequisitions.hiringManagerEmployeeId], references: [employees.id] }),
  recruiter: one(users, { fields: [jobRequisitions.recruiterUserId], references: [users.id] }),
  creator: one(users, { fields: [jobRequisitions.createdBy], references: [users.id] }),
  applications: many(applications),
  publicPublication: one(jobPublications, { fields: [jobRequisitions.organizationId, jobRequisitions.id], references: [jobPublications.organizationId, jobPublications.jobRequisitionId] })
}));

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  organization: one(organizations, { fields: [candidates.organizationId], references: [organizations.id] }),
  creator: one(users, { fields: [candidates.createdBy], references: [users.id] }),
  applications: many(applications)
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  organization: one(organizations, { fields: [applications.organizationId], references: [organizations.id] }),
  candidate: one(candidates, { fields: [applications.candidateId], references: [candidates.id] }),
  requisition: one(jobRequisitions, { fields: [applications.requisitionId], references: [jobRequisitions.id] }),
  history: many(applicationHistory)
}));

export const applicationHistoryRelations = relations(applicationHistory, ({ one }) => ({
  organization: one(organizations, { fields: [applicationHistory.organizationId], references: [organizations.id] }),
  application: one(applications, { fields: [applicationHistory.applicationId], references: [applications.id] }),
  actor: one(users, { fields: [applicationHistory.actorUserId], references: [users.id] })
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  organization: one(organizations, { fields: [leaveRequests.organizationId], references: [organizations.id] }),
  employee: one(employees, { fields: [leaveRequests.employeeId], references: [employees.id] }),
  leaveType: one(leaveTypes, { fields: [leaveRequests.leaveTypeId], references: [leaveTypes.id] }),
  approver: one(users, { fields: [leaveRequests.approverId], references: [users.id] })
}));

export const attendanceRelations = relations(attendanceRecords, ({ one }) => ({
  organization: one(organizations, { fields: [attendanceRecords.organizationId], references: [organizations.id] }),
  employee: one(employees, { fields: [attendanceRecords.employeeId], references: [employees.id] })
}));

export type Organization = typeof organizations.$inferSelect;
export type OrganizationSettings = typeof organizationSettings.$inferSelect;
export type PlatformAdministrator = typeof platformAdministrators.$inferSelect;
export type PlatformAuditLog = typeof platformAuditLogs.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type User = typeof users.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type JobRequisition = typeof jobRequisitions.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type ApplicationHistory = typeof applicationHistory.$inferSelect;
export type RecruitmentStage = typeof recruitmentStages.$inferSelect;
export type InterviewRound = typeof interviewRounds.$inferSelect;
export type Interview = typeof interviews.$inferSelect;
export type InterviewParticipant = typeof interviewParticipants.$inferSelect;
export type InterviewFeedback = typeof interviewFeedback.$inferSelect;
export type InterviewDecision = typeof interviewDecisions.$inferSelect;
export type CandidateNote = typeof candidateNotes.$inferSelect;
export type CandidateActivity = typeof candidateActivities.$inferSelect;
export type JobPublication = typeof jobPublications.$inferSelect;
export type PublicApplicationRateLimit = typeof publicApplicationRateLimits.$inferSelect;


// ---------------------------------------------------------------------------
// Phase 2.4: controlled public job publishing
// ---------------------------------------------------------------------------

export const jobPublications = sqliteTable(
  'job_publications',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    jobRequisitionId: text('job_requisition_id').notNull(),
    publicSlug: text('public_slug').notNull(),
    publicTitle: text('public_title').notNull(),
    publicDescription: text('public_description').notNull(),
    publicLocation: text('public_location'),
    employmentType: text('employment_type').notNull(),
    workplaceType: text('workplace_type').notNull().default('on_site'),
    publicDepartmentName: text('public_department_name'),
    publishedAt: text('published_at'),
    closesAt: text('closes_at'),
    status: text('status', { enum: ['draft', 'published', 'closed', 'archived'] }).notNull().default('draft'),
    applicationEnabled: integer('application_enabled', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    publicSlugIdx: uniqueIndex('job_publications_public_slug_idx').on(t.publicSlug),
    organizationIdx: index('job_publications_organization_idx').on(t.organizationId),
    statusIdx: index('job_publications_status_idx').on(t.organizationId, t.status),
    publishedAtIdx: index('job_publications_published_at_idx').on(t.organizationId, t.publishedAt),
    closesAtIdx: index('job_publications_closes_at_idx').on(t.organizationId, t.closesAt),
    applicationEnabledIdx: index('job_publications_application_enabled_idx').on(t.organizationId, t.applicationEnabled),
    jobIdx: uniqueIndex('job_publications_job_idx').on(t.organizationId, t.jobRequisitionId),
    organizationIdIdIdx: uniqueIndex('job_publications_organization_id_idx').on(t.organizationId, t.id),
    creatorFk: foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id], name: 'job_publications_creator_tenant_fk' }),
    jobFk: foreignKey({ columns: [t.organizationId, t.jobRequisitionId], foreignColumns: [jobRequisitions.organizationId, jobRequisitions.id], name: 'job_publications_job_tenant_fk' })
  })
);

export const publicApplicationRateLimits = sqliteTable(
  'public_application_rate_limits',
  {
    key: text('key').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    publicationId: text('publication_id').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    windowStartedAt: text('window_started_at').notNull(),
    lastSubmittedAt: text('last_submitted_at'),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    organizationIdx: index('public_application_rate_limits_organization_idx').on(t.organizationId, t.updatedAt),
    publicationIdx: index('public_application_rate_limits_publication_idx').on(t.organizationId, t.publicationId, t.updatedAt),
    publicationFk: foreignKey({ columns: [t.organizationId, t.publicationId], foreignColumns: [jobPublications.organizationId, jobPublications.id], name: 'public_application_rate_limits_publication_tenant_fk' })
  })
);

export const candidateDocuments = sqliteTable(
  'candidate_documents',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    candidateId: text('candidate_id').notNull(),
    applicationId: text('application_id'),
    documentType: text('document_type', { enum: ['resume','cover_letter','certificate','portfolio','other'] }).notNull(),
    originalFilename: text('original_filename').notNull(),
    sanitizedFilename: text('sanitized_filename').notNull(),
    declaredMimeType: text('declared_mime_type'),
    detectedMimeType: text('detected_mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    storageProvider: text('storage_provider', { enum: ['local'] }).notNull(),
    storageKey: text('storage_key').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    lifecycleStatus: text('lifecycle_status', { enum: ['pending','available','archived','failed'] }).notNull().default('pending'),
    scanStatus: text('scan_status', { enum: ['pending_scan','clean','infected','scan_failed','scanner_unavailable','rejected'] }).notNull().default('pending_scan'),
    uploadedBy: text('uploaded_by').notNull(),
    archivedAt: text('archived_at'),
    deletedAt: text('deleted_at'),
    retentionUntil: text('retention_until'),
    legalHold: integer('legal_hold', { mode: 'boolean' }).notNull().default(false),
    supersedesDocumentId: text('supersedes_document_id'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    organizationIdx: index('candidate_documents_organization_idx').on(t.organizationId),
    candidateIdx: index('candidate_documents_candidate_idx').on(t.organizationId,t.candidateId,t.createdAt),
    applicationIdx: index('candidate_documents_application_idx').on(t.organizationId,t.applicationId,t.createdAt),
    typeIdx: index('candidate_documents_type_idx').on(t.organizationId,t.documentType,t.createdAt),
    statusIdx: index('candidate_documents_status_idx').on(t.organizationId,t.lifecycleStatus,t.scanStatus),
    createdIdx: index('candidate_documents_created_idx').on(t.organizationId,t.createdAt),
    checksumIdx: index('candidate_documents_checksum_idx').on(t.organizationId,t.checksumSha256),
    storageUnique: uniqueIndex('candidate_documents_storage_key_idx').on(t.storageKey),
    organizationIdIdIdx: uniqueIndex('candidate_documents_organization_id_idx').on(t.organizationId,t.id),
    candidateFk: foreignKey({ columns:[t.organizationId,t.candidateId], foreignColumns:[candidates.organizationId,candidates.id], name:'candidate_documents_candidate_tenant_fk' }),
    applicationFk: foreignKey({ columns:[t.organizationId,t.applicationId,t.candidateId], foreignColumns:[applications.organizationId,applications.id,applications.candidateId], name:'candidate_documents_application_candidate_tenant_fk' }),
    uploaderFk: foreignKey({ columns:[t.organizationId,t.uploadedBy], foreignColumns:[users.organizationId,users.id], name:'candidate_documents_uploader_tenant_fk' }),
    supersedesFk: foreignKey({ columns:[t.organizationId,t.supersedesDocumentId], foreignColumns:[t.organizationId,t.id], name:'candidate_documents_supersedes_tenant_fk' })
  })
);
