import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Core reference tables
// ---------------------------------------------------------------------------

export const departments = sqliteTable('departments', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
});

// ---------------------------------------------------------------------------
// Auth: users, roles, sessions
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
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
    emailIdx: uniqueIndex('users_email_idx').on(t.email)
  })
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    lastActiveAt: text('last_active_at').notNull().default(sql`(current_timestamp)`),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId)
  })
);

export const loginRateLimits = sqliteTable('login_rate_limits', {
  key: text('key').primaryKey(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  windowStartedAt: text('window_started_at').notNull(),
  lockedUntil: text('locked_until'),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
});

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export const employees = sqliteTable(
  'employees',
  {
    id: text('id').primaryKey(),
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
    codeIdx: uniqueIndex('employees_code_idx').on(t.employeeCode),
    emailIdx: uniqueIndex('employees_work_email_idx').on(t.workEmail),
    deptIdx: index('employees_department_idx').on(t.departmentId),
    statusIdx: index('employees_status_idx').on(t.employmentStatus)
  })
);

// ---------------------------------------------------------------------------
// Leave management
// ---------------------------------------------------------------------------

export const leaveTypes = sqliteTable('leave_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  annualQuota: real('annual_quota').notNull(),
  isPaid: integer('is_paid', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
});

export const leaveBalances = sqliteTable(
  'leave_balances',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: text('leave_type_id').notNull().references(() => leaveTypes.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    allocated: real('allocated').notNull(),
    used: real('used').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    uniquePerYear: uniqueIndex('leave_balances_unique').on(t.employeeId, t.leaveTypeId, t.year)
  })
);

export const leaveRequests = sqliteTable(
  'leave_requests',
  {
    id: text('id').primaryKey(),
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
    employeeIdx: index('leave_requests_employee_idx').on(t.employeeId),
    statusIdx: index('leave_requests_status_idx').on(t.status)
  })
);

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const attendanceRecords = sqliteTable(
  'attendance_records',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    workDate: text('work_date').notNull(), // YYYY-MM-DD, server-derived
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
    uniquePerDay: uniqueIndex('attendance_employee_date_idx').on(t.employeeId, t.workDate),
    dateIdx: index('attendance_date_idx').on(t.workDate)
  })
);

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: text('metadata'), // JSON string, non-sensitive fields only
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`)
  },
  (t) => ({
    entityIdx: index('audit_entity_idx').on(t.entityType, t.entityId),
    actorIdx: index('audit_actor_idx').on(t.actorUserId)
  })
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const employeesRelations = relations(employees, ({ one, many }) => ({
  department: one(departments, { fields: [employees.departmentId], references: [departments.id] }),
  manager: one(employees, { fields: [employees.managerId], references: [employees.id] }),
  user: many(users),
  leaveRequests: many(leaveRequests),
  leaveBalances: many(leaveBalances),
  attendanceRecords: many(attendanceRecords)
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  employee: one(employees, { fields: [users.employeeId], references: [employees.id] }),
  sessions: many(sessions)
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(employees, { fields: [leaveRequests.employeeId], references: [employees.id] }),
  leaveType: one(leaveTypes, { fields: [leaveRequests.leaveTypeId], references: [leaveTypes.id] }),
  approver: one(users, { fields: [leaveRequests.approverId], references: [users.id] })
}));

export const attendanceRelations = relations(attendanceRecords, ({ one }) => ({
  employee: one(employees, { fields: [attendanceRecords.employeeId], references: [employees.id] })
}));

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type User = typeof users.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
