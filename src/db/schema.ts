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
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    referenceIdx: uniqueIndex('applications_reference_idx').on(t.organizationId, t.applicationReference),
    organizationIdIdIdx: uniqueIndex('applications_organization_id_idx').on(t.organizationId, t.id),
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
  applications: many(applications)
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
