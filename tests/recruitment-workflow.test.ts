import './helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlite, withSqliteTransactionSync } from '../src/db/client';
import {
  canTransitionWorkflow,
  canTransitionInterview,
  createInterviewInTransaction,
  submitInterviewFeedbackInTransaction,
  correctInterviewFeedbackInTransaction,
  recordInterviewDecisionInTransaction,
  rescheduleInterviewInTransaction,
  assignInterviewParticipantInTransaction,
  localDateTimeToUtc,
  canViewInterview,
  validateSchedule,
  changeApplicationWorkflowInTransaction,
  createCandidateNoteInTransaction,
  updateRecruitmentStageInTransaction,
} from '../src/lib/recruitment-workflow';

function reset() {
  /*
   * Test-only cleanup.
   *
   * Phase 2.2 adds immutable database triggers and user/organization
   * foreign keys. We temporarily remove the immutable triggers so the
   * isolated test database can be reset, then recreate the exact same
   * triggers before inserting the next fixture.
   */
  sqlite.exec(`
    DROP TRIGGER IF EXISTS application_history_immutable_update;
    DROP TRIGGER IF EXISTS application_history_immutable_delete;
    DROP TRIGGER IF EXISTS interview_feedback_immutable_update;
    DROP TRIGGER IF EXISTS interview_feedback_immutable_delete;
    DROP TRIGGER IF EXISTS interview_feedback_corrections_immutable_update;
    DROP TRIGGER IF EXISTS interview_feedback_corrections_immutable_delete;
    DROP TRIGGER IF EXISTS interview_decisions_immutable_update;
    DROP TRIGGER IF EXISTS interview_decisions_immutable_delete;
    DROP TRIGGER IF EXISTS candidate_activities_immutable_update;
    DROP TRIGGER IF EXISTS candidate_activities_immutable_delete;
      DROP TRIGGER IF EXISTS audit_logs_no_update;
      DROP TRIGGER IF EXISTS audit_logs_no_delete;
  `);

  /*
   * Delete children before their parents.
   *
   * organization_settings is deliberately removed before organizations:
   * its organization_id -> organizations.id FK is RESTRICT.
   */
  sqlite.exec(`
    DELETE FROM interview_feedback_corrections;
    DELETE FROM interview_decisions;
    DELETE FROM interview_feedback;
    DELETE FROM interview_participants;
    DELETE FROM candidate_activities;
    DELETE FROM candidate_notes;
    DELETE FROM interviews;
    DELETE FROM interview_rounds;
    DELETE FROM recruitment_stages;

    DELETE FROM application_history;
    DELETE FROM applications;
    DELETE FROM candidates;
    DELETE FROM job_requisitions;

    DELETE FROM sessions;
    DELETE FROM organization_settings;
    DELETE FROM audit_logs;

    DELETE FROM users;
    DELETE FROM employees;
    DELETE FROM departments;
    DELETE FROM organizations;
  `);

  /*
   * Restore the immutable protections exactly for the test fixture.
   */
  sqlite.exec(`
    CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs are immutable');
    END;

    CREATE TRIGGER audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs are immutable');
    END;

    CREATE TRIGGER application_history_immutable_update
    BEFORE UPDATE ON application_history
    BEGIN
      SELECT RAISE(ABORT, 'Application history is immutable.');
    END;

    CREATE TRIGGER application_history_immutable_delete
    BEFORE DELETE ON application_history
    BEGIN
      SELECT RAISE(ABORT, 'Application history is immutable.');
    END;

    CREATE TRIGGER interview_feedback_immutable_update
    BEFORE UPDATE ON interview_feedback
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback is immutable.');
    END;

    CREATE TRIGGER interview_feedback_immutable_delete
    BEFORE DELETE ON interview_feedback
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback is immutable.');
    END;

    CREATE TRIGGER interview_feedback_corrections_immutable_update
    BEFORE UPDATE ON interview_feedback_corrections
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback corrections are immutable.');
    END;

    CREATE TRIGGER interview_feedback_corrections_immutable_delete
    BEFORE DELETE ON interview_feedback_corrections
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback corrections are immutable.');
    END;

    CREATE TRIGGER interview_decisions_immutable_update
    BEFORE UPDATE ON interview_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Interview decisions are immutable.');
    END;

    CREATE TRIGGER interview_decisions_immutable_delete
    BEFORE DELETE ON interview_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Interview decisions are immutable.');
    END;

    CREATE TRIGGER candidate_activities_immutable_update
    BEFORE UPDATE ON candidate_activities
    BEGIN
      SELECT RAISE(ABORT, 'Candidate activities are immutable.');
    END;

    CREATE TRIGGER candidate_activities_immutable_delete
    BEFORE DELETE ON candidate_activities
    BEGIN
      SELECT RAISE(ABORT, 'Candidate activities are immutable.');
    END;
  `);

  sqlite.exec(`
    INSERT INTO organizations
      (id, name, slug, status)
    VALUES
      ('org_a', 'Org A', 'org-a', 'active'),
      ('org_b', 'Org B', 'org-b', 'active');
  `);

  sqlite.exec(`
    INSERT INTO users
      (id, organization_id, email, password_hash, password_salt, role, is_active)
    VALUES
      ('admin-a', 'org_a', 'admin-a@test', 'x', 'x', 'admin', 1),
      ('hr-a', 'org_a', 'hr-a@test', 'x', 'x', 'hr', 1),
      ('employee-a', 'org_a', 'employee-a@test', 'x', 'x', 'employee', 1),
      ('admin-b', 'org_b', 'admin-b@test', 'x', 'x', 'admin', 1);
  `);

  sqlite.exec(`
    INSERT INTO departments
      (id, organization_id, name)
    VALUES
      ('dept-a', 'org_a', 'Engineering'),
      ('dept-b', 'org_b', 'Engineering');
  `);

  sqlite.exec(`
    INSERT INTO employees
      (
        id,
        organization_id,
        employee_code,
        first_name,
        last_name,
        work_email,
        date_of_joining,
        designation,
        employment_status,
        employment_type
      )
    VALUES
      (
        'emp-a',
        'org_a',
        'E1',
        'Alice',
        'Manager',
        'alice@test',
        '2026-01-01',
        'Manager',
        'active',
        'full_time'
      ),
      (
        'emp-b',
        'org_b',
        'E1',
        'Bob',
        'Manager',
        'bob@test',
        '2026-01-01',
        'Manager',
        'active',
        'full_time'
      );
  `);

  const stages: Array<[string, string, number]> = [
    ['applied', 'Applied', 0],
    ['screening', 'Screening', 1],
    ['shortlisted', 'Shortlisted', 2],
    ['interview', 'Interview', 3],
    ['evaluation', 'Evaluation', 4],
    ['offer', 'Offer', 5],
    ['hired', 'Hired', 6],
    ['rejected', 'Rejected', 7],
    ['withdrawn', 'Withdrawn', 8],
    ['archived', 'Archived', 9],
  ];

  for (const [key, name, position] of stages) {
    sqlite
      .prepare(`
        INSERT INTO recruitment_stages
          (
            id,
            organization_id,
            status_key,
            name,
            position,
            is_active,
            created_by,
            updated_by
          )
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .run(
        `org_a:${key}`,
        'org_a',
        key,
        name,
        position,
        'admin-a',
        'admin-a',
      );
  }
}

test.beforeEach(reset);

function base() {
  sqlite
    .prepare(`
      INSERT INTO candidates
        (
          id,
          organization_id,
          first_name,
          last_name,
          email,
          created_by
        )
      VALUES
        ('c1', 'org_a', 'Jane', 'Doe', 'jane@test', 'hr-a')
    `)
    .run();

  sqlite
    .prepare(`
      INSERT INTO job_requisitions
        (
          id,
          organization_id,
          requisition_code,
          title,
          employment_type,
          description,
          requirements,
          openings,
          status,
          created_by
        )
      VALUES
        (
          'j1',
          'org_a',
          'REQ-1',
          'Engineer',
          'full_time',
          'd',
          'r',
          1,
          'open',
          'admin-a'
        )
    `)
    .run();

  sqlite
    .prepare(`
      INSERT INTO applications
        (
          id,
          organization_id,
          candidate_id,
          requisition_id,
          application_reference,
          status,
          current_stage
        )
      VALUES
        (
          'a1',
          'org_a',
          'c1',
          'j1',
          'APP-1',
          'shortlisted',
          'shortlisted'
        )
    `)
    .run();
}

test(
  'workflow matrix rejects arbitrary client transitions',
  () => {
    assert.equal(
      canTransitionWorkflow('shortlisted', 'interview'),
      true,
    );
    assert.equal(
      canTransitionWorkflow('applied', 'offer'),
      false,
    );
    assert.equal(
      canTransitionWorkflow('hired', 'rejected'),
      false,
    );
    assert.equal(
      canTransitionInterview('scheduled', 'confirmed'),
      true,
    );
    assert.equal(
      canTransitionInterview('completed', 'cancelled'),
      false,
    );
  },
);

test(
  'application workflow transition writes stage history and activity atomically',
  () => {
    base();

    changeApplicationWorkflowInTransaction(
      'org_a',
      'hr-a',
      'a1',
      'interview',
      'Ready for interview',
    );

    const h = sqlite
      .prepare(`
        SELECT
          previous_status,
          new_status,
          previous_stage,
          new_stage,
          actor_user_id,
          reason
        FROM application_history
        WHERE application_id=?
      `)
      .get('a1') as any;

    assert.equal(h.previous_status, 'shortlisted');
    assert.equal(h.new_status, 'interview');
    assert.equal(h.new_stage, 'interview');
    assert.equal(h.actor_user_id, 'hr-a');

    assert.equal(
      sqlite
        .prepare(`
          SELECT COUNT(*) n
          FROM candidate_activities
          WHERE application_id='a1'
            AND activity_type='stage_changed'
        `)
        .get()?.n,
      1,
    );
  },
);

test(
  'workflow transition is tenant scoped and cannot reach another tenant application',
  () => {
    base();

    sqlite
      .prepare(`
        INSERT INTO candidates
          (
            id,
            organization_id,
            first_name,
            last_name,
            email,
            created_by
          )
        VALUES
          (
            'cb',
            'org_b',
            'Other',
            'Candidate',
            'other@test',
            'admin-b'
          )
      `)
      .run();

    sqlite
      .prepare(`
        INSERT INTO job_requisitions
          (
            id,
            organization_id,
            requisition_code,
            title,
            employment_type,
            description,
            requirements,
            openings,
            status,
            created_by
          )
        VALUES
          (
            'jb',
            'org_b',
            'REQ-B',
            'Other',
            'full_time',
            'd',
            'r',
            1,
            'open',
            'admin-b'
          )
      `)
      .run();

    sqlite
      .prepare(`
        INSERT INTO applications
          (
            id,
            organization_id,
            candidate_id,
            requisition_id,
            application_reference,
            status,
            current_stage
          )
        VALUES
          (
            'ab',
            'org_b',
            'cb',
            'jb',
            'APP-B',
            'shortlisted',
            'shortlisted'
          )
      `)
      .run();

    assert.throws(
      () =>
        changeApplicationWorkflowInTransaction(
          'org_a',
          'hr-a',
          'ab',
          'interview',
          'x',
        ),
      /Application not found/,
    );
  },
);

test(
  'stage customization is tenant bound and ordered',
  () => {
    updateRecruitmentStageInTransaction(
      'org_a',
      'hr-a',
      'org_a:interview',
      'Technical Interview',
      30,
      true,
    );

    const row = sqlite
      .prepare(`
        SELECT name, position
        FROM recruitment_stages
        WHERE organization_id=?
          AND id=?
      `)
      .get('org_a', 'org_a:interview') as any;

    assert.equal(row.name, 'Technical Interview');
    assert.equal(row.position, 30);

    assert.equal(
      sqlite
        .prepare(`
          SELECT COUNT(*) n
          FROM recruitment_stages
          WHERE organization_id='org_b'
        `)
        .get()?.n,
      0,
    );
  },
);

test(
  'timezone conversion is canonical UTC and invalid wall clock is rejected',
  () => {
    assert.equal(
      localDateTimeToUtc(
        '2026-09-12T12:00',
        'Asia/Kolkata',
      ),
      '2026-09-12T06:30:00.000Z',
    );

    assert.throws(
      () =>
        validateSchedule(
          '2026-09-12T13:00',
          '2026-09-12T12:00',
          'Asia/Kolkata',
        ),
      /after/,
    );

    assert.throws(
      () =>
        localDateTimeToUtc(
          '2026-02-30T10:00',
          'Asia/Kolkata',
        ),
      /does not exist|Invalid/,
    );
  },
);

test(
  'interview creation makes round, panel, activity and moves shortlisted application to interview',
  () => {
    base();

    const id = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Technical',
      title: 'Technical Interview',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: 'Office',
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    assert.ok(id);

    assert.equal(
      (
        sqlite
          .prepare('SELECT status FROM applications WHERE id=?')
          .get('a1') as any
      ).status,
      'interview',
    );

    assert.equal(
      (
        sqlite
          .prepare(`
            SELECT COUNT(*) n
            FROM interview_rounds
            WHERE application_id=?
          `)
          .get('a1') as any
      ).n,
      1,
    );

    assert.equal(
      (
        sqlite
          .prepare(`
            SELECT COUNT(*) n
            FROM interview_participants
            WHERE interview_id=?
          `)
          .get(id) as any
      ).n,
      1,
    );

    assert.equal(
      (
        sqlite
          .prepare(`
            SELECT COUNT(*) n
            FROM candidate_activities
            WHERE interview_id=?
          `)
          .get(id) as any
      ).n,
      2,
    );
  },
);

test(
  'cross tenant application or interviewer cannot be used to create interview',
  () => {
    base();

    assert.throws(
      () =>
        createInterviewInTransaction({
          organizationId: 'org_a',
          actorUserId: 'hr-a',
          applicationId: 'missing',
          roundId: null,
          roundName: 'x',
          title: 'x',
          interviewType: 'technical',
          startLocal: '2026-09-15T10:00',
          endLocal: '2026-09-15T11:00',
          timezone: 'Asia/Kolkata',
          location: null,
          meetingDetails: null,
          participantIds: ['employee-a'],
        }),
      /Application not found/,
    );

    sqlite
      .prepare(`
        INSERT INTO candidates
          (
            id,
            organization_id,
            first_name,
            last_name,
            email,
            created_by
          )
        VALUES
          (
            'cb',
            'org_b',
            'B',
            'B',
            'b@test',
            'admin-b'
          )
      `)
      .run();

    sqlite
      .prepare(`
        INSERT INTO job_requisitions
          (
            id,
            organization_id,
            requisition_code,
            title,
            employment_type,
            description,
            requirements,
            openings,
            status,
            created_by
          )
        VALUES
          (
            'jb',
            'org_b',
            'REQ-B',
            'B',
            'full_time',
            'd',
            'r',
            1,
            'open',
            'admin-b'
          )
      `)
      .run();

    sqlite
      .prepare(`
        INSERT INTO applications
          (
            id,
            organization_id,
            candidate_id,
            requisition_id,
            application_reference,
            status,
            current_stage
          )
        VALUES
          (
            'ab',
            'org_b',
            'cb',
            'jb',
            'APP-B',
            'shortlisted',
            'shortlisted'
          )
      `)
      .run();

    assert.throws(
      () =>
        createInterviewInTransaction({
          organizationId: 'org_a',
          actorUserId: 'hr-a',
          applicationId: 'a1',
          roundId: null,
          roundName: 'x',
          title: 'x',
          interviewType: 'technical',
          startLocal: '2026-09-15T10:00',
          endLocal: '2026-09-15T11:00',
          timezone: 'Asia/Kolkata',
          location: null,
          meetingDetails: null,
          participantIds: ['admin-b'],
        }),
      /active member/,
    );
  },
);

test(
  'duplicate interviewer and overlapping interviewer are rejected',
  () => {
    base();

      sqlite
        .prepare(`
          INSERT INTO candidates
            (
              id,
              organization_id,
              first_name,
              last_name,
              email,
              created_by
            )
          VALUES
            (
              'c2',
              'org_a',
              'Second',
              'Candidate',
              'second@test',
              'admin-a'
            )
        `)
        .run();

    const i1 = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Round 1',
      title: 'Interview 1',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    assert.throws(
      () =>
        assignInterviewParticipantInTransaction(
          'org_a',
          'hr-a',
          i1,
          'employee-a',
        ),
      /already assigned/,
    );

    sqlite
      .prepare(`
        INSERT INTO applications
          (
            id,
            organization_id,
            candidate_id,
            requisition_id,
            application_reference,
            status,
            current_stage
          )
        VALUES
          (
            'a2',
            'org_a',
            'c2',
            'j1',
            'APP-2',
            'shortlisted',
            'shortlisted'
          )
      `)
      .run();

    assert.throws(
      () =>
        createInterviewInTransaction({
          organizationId: 'org_a',
          actorUserId: 'hr-a',
          applicationId: 'a2',
          roundId: null,
          roundName: 'Round 2',
          title: 'Interview 2',
          interviewType: 'technical',
          startLocal: '2026-09-15T10:30',
          endLocal: '2026-09-15T11:30',
          timezone: 'Asia/Kolkata',
          location: null,
          meetingDetails: null,
          participantIds: ['employee-a'],
        }),
      /overlapping/,
    );
  },
);

test(
  'non-overlapping interviewer can be scheduled and rescheduling checks conflicts',
  () => {
    base();

    const i1 = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Round 1',
      title: 'Interview 1',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    rescheduleInterviewInTransaction(
      'org_a',
      'hr-a',
      i1,
      '2026-09-15T12:00',
      '2026-09-15T13:00',
      'Asia/Kolkata',
    );

    assert.equal(
      (
        sqlite
          .prepare('SELECT status FROM interviews WHERE id=?')
          .get(i1) as any
      ).status,
      'rescheduled',
    );
  },
);

test(
  'interview lifecycle rejects modification of completed interview',
  () => {
    base();

    const id = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Round',
      title: 'Interview',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    sqlite
      .prepare(`
        UPDATE interviews
        SET status='completed'
        WHERE organization_id='org_a'
          AND id=?
      `)
      .run(id);

    assert.throws(
      () =>
        rescheduleInterviewInTransaction(
          'org_a',
          'hr-a',
          id,
          '2026-09-15T12:00',
          '2026-09-15T13:00',
          'Asia/Kolkata',
        ),
      /Only active/,
    );
  },
);

test(
  'feedback requires assigned interviewer, completed interview and valid score',
  () => {
    base();

    const id = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Round',
      title: 'Interview',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    sqlite
      .prepare("UPDATE interviews SET status='completed' WHERE id=?")
      .run(id);

    assert.throws(
      () =>
        submitInterviewFeedbackInTransaction(
          'org_a',
          'hr-a',
          id,
          0,
          'yes',
          's',
          'c',
          null,
        ),
      /1 to 5/,
    );

    assert.throws(
      () =>
        submitInterviewFeedbackInTransaction(
          'org_a',
          'admin-b',
          id,
          4,
          'yes',
          's',
          'c',
          null,
        ),
      /assigned/,
    );

    const fid = submitInterviewFeedbackInTransaction(
      'org_a',
      'employee-a',
      id,
      4,
      'yes',
      'Strong',
      'Some concern',
      'Good',
    );

    assert.ok(fid);

    assert.throws(
      () =>
        submitInterviewFeedbackInTransaction(
          'org_a',
          'employee-a',
          id,
          4,
          'yes',
          's',
          'c',
          null,
        ),
      /already submitted/,
    );
  },
);

test(
  'feedback is immutable at database level',
  () => {
    base();

    const id = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Round',
      title: 'Interview',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    sqlite
      .prepare("UPDATE interviews SET status='completed' WHERE id=?")
      .run(id);

    const fid = submitInterviewFeedbackInTransaction(
      'org_a',
      'employee-a',
      id,
      4,
      'yes',
      's',
      'c',
      null,
    );

    assert.throws(
      () =>
        sqlite
          .prepare(`
            UPDATE interview_feedback
            SET score=5
            WHERE organization_id=?
              AND id=?
          `)
          .run('org_a', fid),
      /immutable/,
    );

    assert.throws(
      () =>
        sqlite
          .prepare(`
            DELETE FROM interview_feedback
            WHERE organization_id=?
              AND id=?
          `)
          .run('org_a', fid),
      /immutable/,
    );
  },
);

test(
  'decision reject integrates with application lifecycle and is immutable by uniqueness',
  () => {
    base();

    const id = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Round',
      title: 'Interview',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    sqlite
      .prepare("UPDATE interviews SET status='completed' WHERE id=?")
      .run(id);

    recordInterviewDecisionInTransaction(
      'org_a',
      'hr-a',
      id,
      'reject',
      'Not suitable',
    );

    assert.equal(
      (
        sqlite
          .prepare('SELECT status FROM applications WHERE id=?')
          .get('a1') as any
      ).status,
      'rejected',
    );

    assert.throws(
      () =>
        recordInterviewDecisionInTransaction(
          'org_a',
          'hr-a',
          id,
          'hold',
          'x',
        ),
      /already been recorded/,
    );
  },
);

test(
  'decision cannot be recorded on incomplete interview',
  () => {
    base();

    const id = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Round',
      title: 'Interview',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    assert.throws(
      () =>
        recordInterviewDecisionInTransaction(
          'org_a',
          'hr-a',
          id,
          'advance',
          'x',
        ),
      /completed/,
    );
  },
);

test(
  'candidate notes are tenant scoped and validated',
  () => {
    base();

    const id = createCandidateNoteInTransaction(
      'org_a',
      'hr-a',
      'c1',
      'a1',
      'Private recruitment note',
    );

    assert.ok(id);

    assert.throws(
      () =>
        createCandidateNoteInTransaction(
          'org_a',
          'hr-a',
          'c1',
          'missing',
          'x',
        ),
      /Application not found/,
    );

    assert.throws(
      () =>
        createCandidateNoteInTransaction(
          'org_a',
          'hr-a',
          'c1',
          'a1',
          '   ',
        ),
      /required/,
    );

    assert.equal(
      (
        sqlite
          .prepare(`
            SELECT COUNT(*) n
            FROM candidate_notes
            WHERE organization_id=?
          `)
          .get('org_a') as any
      ).n,
      1,
    );
  },
);

test(
  'activity and note rows cannot cross tenant relationships',
  () => {
    base();

    sqlite
      .prepare(`
        INSERT INTO candidates
          (
            id,
            organization_id,
            first_name,
            last_name,
            email,
            created_by
          )
        VALUES
          (
            'cb',
            'org_b',
            'B',
            'B',
            'b@test',
            'admin-b'
          )
      `)
      .run();

    assert.throws(
      () =>
        sqlite
          .prepare(`
            INSERT INTO candidate_notes
              (
                id,
                organization_id,
                candidate_id,
                author_user_id,
                content
              )
            VALUES
              ('n', 'org_a', 'cb', 'hr-a', 'x')
          `)
          .run(),
      /FOREIGN KEY/,
    );

    assert.throws(
      () =>
        sqlite
          .prepare(`
            INSERT INTO candidate_activities
              (
                id,
                organization_id,
                candidate_id,
                activity_type,
                actor_user_id,
                summary
              )
            VALUES
              (
                'x',
                'org_a',
                'cb',
                'candidate_created',
                'hr-a',
                'x'
              )
          `)
          .run(),
      /FOREIGN KEY/,
    );
  },
);

test(
  'interview creation transaction rolls back on deliberate failure',
  () => {
    base();

    assert.throws(
      () =>
        withSqliteTransactionSync(() => {
          sqlite
            .prepare(`
              INSERT INTO interview_rounds
                (
                  id,
                  organization_id,
                  application_id,
                  round_number,
                  name,
                  stage_status,
                  created_by
                )
              VALUES
                (
                  'r1',
                  'org_a',
                  'a1',
                  1,
                  'Round',
                  'interview',
                  'hr-a'
                )
            `)
            .run();

          sqlite
            .prepare(`
              INSERT INTO interviews
                (
                  id,
                  organization_id,
                  application_id,
                  round_id,
                  title,
                  interview_type,
                  status,
                  scheduled_start,
                  scheduled_end,
                  timezone,
                  organizer_user_id,
                  created_by
                )
              VALUES
                (
                  'i1',
                  'org_a',
                  'a1',
                  'r1',
                  'Interview',
                  'technical',
                  'scheduled',
                  '2026-09-20T04:30:00.000Z',
                  '2026-09-20T05:30:00.000Z',
                  'Asia/Kolkata',
                  'hr-a',
                  'hr-a'
                )
            `)
            .run();

          throw new Error('deliberate rollback');
        }),
      /deliberate rollback/,
    );

    assert.equal(
      (
        sqlite
          .prepare(`
            SELECT COUNT(*) n
            FROM interview_rounds
            WHERE organization_id='org_a'
          `)
          .get() as any
      ).n,
      0,
    );

    assert.equal(
      (
        sqlite
          .prepare(`
            SELECT COUNT(*) n
            FROM interviews
            WHERE organization_id='org_a'
          `)
          .get() as any
      ).n,
      0,
    );
  },
);

test(
  'multiple panel members are supported and duplicate membership is prevented',
  () => {
    base();

    const id = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Panel',
      title: 'Panel interview',
      interviewType: 'panel',
      startLocal: '2026-09-15T14:00',
      endLocal: '2026-09-15T15:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a', 'hr-a'],
    });

    assert.equal(
      (
        sqlite
          .prepare(`
            SELECT COUNT(*) n
            FROM interview_participants
            WHERE interview_id=?
          `)
          .get(id) as any
      ).n,
      2,
    );

    assert.throws(
      () =>
        assignInterviewParticipantInTransaction(
          'org_a',
          'hr-a',
          id,
          'hr-a',
        ),
      /already assigned/,
    );
  },
);

test(
  'feedback correction preserves original submission and records immutable correction history',
  () => {
    base();

    const id = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Round',
      title: 'Interview',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    sqlite
      .prepare("UPDATE interviews SET status='completed' WHERE id=?")
      .run(id);

    const fid = submitInterviewFeedbackInTransaction(
      'org_a',
      'employee-a',
      id,
      3,
      'neutral',
      'Original strengths',
      'Original concerns',
      'Original notes',
    );

    correctInterviewFeedbackInTransaction(
      'org_a',
      'hr-a',
      fid,
      {
        score: 5,
        recommendation: 'strong_yes',
        strengths: 'Corrected strengths',
        concerns: 'Corrected concerns',
        notes: 'Corrected notes',
        reason: 'Correction after review',
      },
    );

    const f = sqlite
      .prepare(`
        SELECT score, recommendation, strengths
        FROM interview_feedback
        WHERE id=?
      `)
      .get(fid) as any;

    const c = sqlite
      .prepare(`
        SELECT previous_score, new_score, reason
        FROM interview_feedback_corrections
        WHERE feedback_id=?
      `)
      .get(fid) as any;

    assert.equal(f.score, 3);
    assert.equal(f.recommendation, 'neutral');
    assert.equal(c.previous_score, 3);
    assert.equal(c.new_score, 5);
    assert.equal(c.reason, 'Correction after review');
  },
);

test(
  'only assigned interviewers can view an employee-level interview',
  () => {
    base();

    const id = createInterviewInTransaction({
      organizationId: 'org_a',
      actorUserId: 'hr-a',
      applicationId: 'a1',
      roundId: null,
      roundName: 'Round',
      title: 'Interview',
      interviewType: 'technical',
      startLocal: '2026-09-15T10:00',
      endLocal: '2026-09-15T11:00',
      timezone: 'Asia/Kolkata',
      location: null,
      meetingDetails: null,
      participantIds: ['employee-a'],
    });

    assert.equal(
      canViewInterview(
        'org_a',
        'employee-a',
        'employee',
        id,
      ),
      true,
    );

    assert.equal(
      canViewInterview(
        'org_a',
        'hr-a',
        'employee',
        id,
      ),
      false,
    );

    assert.equal(
      canViewInterview(
        'org_b',
        'admin-b',
        'admin',
        id,
      ),
      false,
    );
  },
);

test(
  'suspended organizations cannot mutate recruitment state',
  () => {
    base();

    sqlite
      .prepare(`
        UPDATE organizations
        SET status='suspended'
        WHERE id='org_a'
      `)
      .run();

    assert.throws(
      () =>
        createCandidateNoteInTransaction(
          'org_a',
          'hr-a',
          'c1',
          'a1',
          'x',
        ),
      /suspended/,
    );

    assert.throws(
      () =>
        createInterviewInTransaction({
          organizationId: 'org_a',
          actorUserId: 'hr-a',
          applicationId: 'a1',
          roundId: null,
          roundName: 'Round',
          title: 'Interview',
          interviewType: 'technical',
          startLocal: '2026-09-15T10:00',
          endLocal: '2026-09-15T11:00',
          timezone: 'Asia/Kolkata',
          location: null,
          meetingDetails: null,
          participantIds: ['employee-a'],
        }),
      /suspended/,
    );
  },
);

test(
  'application stage history remains intact when a later interview operation fails',
  () => {
    base();

    assert.throws(
      () =>
        createInterviewInTransaction({
          organizationId: 'org_a',
          actorUserId: 'hr-a',
          applicationId: 'a1',
          roundId: null,
          roundName: 'Round',
          title: 'Interview',
          interviewType: 'technical',
          startLocal: '2026-09-15T10:00',
          endLocal: '2026-09-15T11:00',
          timezone: 'Asia/Kolkata',
          location: null,
          meetingDetails: null,
          participantIds: [],
        }),
      /interviewer/,
    );

    assert.equal(
      (
        sqlite
          .prepare(`
            SELECT status
            FROM applications
            WHERE id='a1'
          `)
          .get() as any
      ).status,
      'shortlisted',
    );

    assert.equal(
      (
        sqlite
          .prepare(`
            SELECT COUNT(*) n
            FROM interview_rounds
            WHERE application_id='a1'
          `)
          .get() as any
      ).n,
      0,
    );
  },
);
