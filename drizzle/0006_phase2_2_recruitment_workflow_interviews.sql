-- SYJ-HCM Phase 2.2: recruitment workflow and interview management.
-- Additive only. Historical migrations remain unchanged.

ALTER TABLE application_history ADD COLUMN previous_stage TEXT;
ALTER TABLE application_history ADD COLUMN new_stage TEXT;
ALTER TABLE application_history ADD COLUMN note TEXT;

CREATE TABLE IF NOT EXISTS recruitment_stages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  status_key TEXT NOT NULL CHECK (status_key IN ('applied','screening','shortlisted','interview','evaluation','offer','hired','rejected','withdrawn','archived')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id, status_key),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS recruitment_stages_active_idx ON recruitment_stages(organization_id,is_active,position);

CREATE TABLE IF NOT EXISTS interview_rounds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  application_id TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  name TEXT NOT NULL,
  stage_status TEXT NOT NULL DEFAULT 'interview' CHECK (stage_status IN ('screening','shortlisted','interview','evaluation','offer')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id, application_id, round_number),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,id,application_id),
  FOREIGN KEY (organization_id,application_id) REFERENCES applications(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS interview_rounds_application_idx ON interview_rounds(organization_id,application_id,round_number);

CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  application_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  title TEXT NOT NULL,
  interview_type TEXT NOT NULL CHECK (length(trim(interview_type)) BETWEEN 2 AND 80),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','cancelled','rescheduled','no_show')),
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT NOT NULL,
  timezone TEXT NOT NULL,
  location TEXT,
  meeting_details TEXT,
  organizer_user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,id,application_id),
  FOREIGN KEY (organization_id,application_id) REFERENCES applications(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,round_id,application_id) REFERENCES interview_rounds(organization_id,id,application_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,organizer_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK (scheduled_end > scheduled_start)
);
CREATE INDEX IF NOT EXISTS interviews_application_idx ON interviews(organization_id,application_id,scheduled_start);
CREATE INDEX IF NOT EXISTS interviews_status_start_idx ON interviews(organization_id,status,scheduled_start);
CREATE INDEX IF NOT EXISTS interviews_round_idx ON interviews(organization_id,round_id);

CREATE TABLE IF NOT EXISTS interview_participants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  interview_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'interviewer' CHECK (role IN ('interviewer','observer')),
  assigned_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id,interview_id,user_id),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,interview_id) REFERENCES interviews(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,assigned_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS interview_participants_user_idx ON interview_participants(organization_id,user_id,interview_id);

CREATE TABLE IF NOT EXISTS interview_feedback (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  interview_id TEXT NOT NULL,
  interviewer_user_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  recommendation TEXT NOT NULL CHECK (recommendation IN ('strong_yes','yes','neutral','no','strong_no')),
  strengths TEXT NOT NULL,
  concerns TEXT NOT NULL,
  notes TEXT,
  submitted_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id,interview_id,interviewer_user_id),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,interview_id) REFERENCES interviews(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,interview_id,interviewer_user_id) REFERENCES interview_participants(organization_id,interview_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,interviewer_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS interview_feedback_interview_idx ON interview_feedback(organization_id,interview_id,submitted_at);
CREATE INDEX IF NOT EXISTS interview_feedback_interviewer_idx ON interview_feedback(organization_id,interviewer_user_id,submitted_at);

CREATE TABLE IF NOT EXISTS interview_feedback_corrections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  feedback_id TEXT NOT NULL,
  previous_score INTEGER NOT NULL CHECK (previous_score BETWEEN 1 AND 5),
  previous_recommendation TEXT NOT NULL CHECK (previous_recommendation IN ('strong_yes','yes','neutral','no','strong_no')),
  previous_strengths TEXT NOT NULL,
  previous_concerns TEXT NOT NULL,
  previous_notes TEXT,
  new_score INTEGER NOT NULL CHECK (new_score BETWEEN 1 AND 5),
  new_recommendation TEXT NOT NULL CHECK (new_recommendation IN ('strong_yes','yes','neutral','no','strong_no')),
  new_strengths TEXT NOT NULL,
  new_concerns TEXT NOT NULL,
  new_notes TEXT,
  corrected_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,feedback_id) REFERENCES interview_feedback(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,corrected_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS interview_feedback_corrections_feedback_idx ON interview_feedback_corrections(organization_id,feedback_id,created_at);

CREATE TABLE IF NOT EXISTS interview_decisions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  interview_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('advance','hold','reject')),
  rationale TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id,interview_id),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,interview_id,application_id) REFERENCES interviews(organization_id,id,application_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,application_id) REFERENCES applications(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,decided_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS interview_decisions_application_idx ON interview_decisions(organization_id,application_id,created_at);

CREATE UNIQUE INDEX IF NOT EXISTS applications_organization_id_id_candidate_idx ON applications(organization_id,id,candidate_id);

CREATE TABLE IF NOT EXISTS candidate_notes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL,
  application_id TEXT,
  author_user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,candidate_id) REFERENCES candidates(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,application_id,candidate_id) REFERENCES applications(organization_id,id,candidate_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,author_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK (length(trim(content)) BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS candidate_notes_candidate_idx ON candidate_notes(organization_id,candidate_id,created_at);
CREATE INDEX IF NOT EXISTS candidate_notes_application_idx ON candidate_notes(organization_id,application_id,created_at);

CREATE TABLE IF NOT EXISTS candidate_activities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL,
  application_id TEXT,
  interview_id TEXT,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('candidate_created','candidate_updated','application_created','stage_changed','interview_scheduled','interview_rescheduled','interview_cancelled','interviewer_assigned','interviewer_removed','feedback_submitted','interview_completed','interview_no_show','interview_status_changed','feedback_corrected','decision_recorded','candidate_note_added','candidate_note_updated','rejection','withdrawal','archive')),
  actor_user_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,candidate_id) REFERENCES candidates(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,application_id,candidate_id) REFERENCES applications(organization_id,id,candidate_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,interview_id,application_id) REFERENCES interviews(organization_id,id,application_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS candidate_activities_timeline_idx ON candidate_activities(organization_id,candidate_id,created_at,id);
CREATE INDEX IF NOT EXISTS candidate_activities_application_idx ON candidate_activities(organization_id,application_id,created_at);
CREATE INDEX IF NOT EXISTS candidate_activities_interview_idx ON candidate_activities(organization_id,interview_id,created_at);

CREATE TRIGGER IF NOT EXISTS application_history_immutable_update
BEFORE UPDATE ON application_history BEGIN SELECT RAISE(ABORT,'Application history is immutable.'); END;
CREATE TRIGGER IF NOT EXISTS application_history_immutable_delete
BEFORE DELETE ON application_history BEGIN SELECT RAISE(ABORT,'Application history is immutable.'); END;
CREATE TRIGGER IF NOT EXISTS interview_decisions_immutable_update
BEFORE UPDATE ON interview_decisions BEGIN SELECT RAISE(ABORT,'Interview decisions are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS interview_decisions_immutable_delete
BEFORE DELETE ON interview_decisions BEGIN SELECT RAISE(ABORT,'Interview decisions are immutable.'); END;

CREATE TRIGGER IF NOT EXISTS interview_feedback_immutable_update
BEFORE UPDATE ON interview_feedback BEGIN SELECT RAISE(ABORT,'Interview feedback is immutable; use a correction record.'); END;
CREATE TRIGGER IF NOT EXISTS interview_feedback_immutable_delete
BEFORE DELETE ON interview_feedback BEGIN SELECT RAISE(ABORT,'Interview feedback is immutable.'); END;
CREATE TRIGGER IF NOT EXISTS interview_feedback_corrections_immutable_update
BEFORE UPDATE ON interview_feedback_corrections BEGIN SELECT RAISE(ABORT,'Feedback corrections are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS interview_feedback_corrections_immutable_delete
BEFORE DELETE ON interview_feedback_corrections BEGIN SELECT RAISE(ABORT,'Feedback corrections are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS candidate_activities_immutable_update
BEFORE UPDATE ON candidate_activities BEGIN SELECT RAISE(ABORT,'Candidate activities are immutable.'); END;
CREATE TRIGGER IF NOT EXISTS candidate_activities_immutable_delete
BEFORE DELETE ON candidate_activities BEGIN SELECT RAISE(ABORT,'Candidate activities are immutable.'); END;

UPDATE application_history SET new_stage = COALESCE(new_stage,new_status), previous_stage = COALESCE(previous_stage,previous_status) WHERE new_stage IS NULL OR previous_stage IS NULL;

INSERT OR IGNORE INTO recruitment_stages (id,organization_id,status_key,name,position,is_active,created_by,updated_by)
SELECT o.id || ':applied',o.id,'applied','Applied',0,1,u.id,u.id FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);
INSERT OR IGNORE INTO recruitment_stages SELECT o.id || ':screening',o.id,'screening','Screening',1,1,u.id,u.id,current_timestamp,current_timestamp FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);
INSERT OR IGNORE INTO recruitment_stages SELECT o.id || ':shortlisted',o.id,'shortlisted','Shortlisted',2,1,u.id,u.id,current_timestamp,current_timestamp FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);
INSERT OR IGNORE INTO recruitment_stages SELECT o.id || ':interview',o.id,'interview','Interview',3,1,u.id,u.id,current_timestamp,current_timestamp FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);
INSERT OR IGNORE INTO recruitment_stages SELECT o.id || ':evaluation',o.id,'evaluation','Evaluation',4,1,u.id,u.id,current_timestamp,current_timestamp FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);
INSERT OR IGNORE INTO recruitment_stages SELECT o.id || ':offer',o.id,'offer','Offer',5,1,u.id,u.id,current_timestamp,current_timestamp FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);
INSERT OR IGNORE INTO recruitment_stages SELECT o.id || ':hired',o.id,'hired','Hired',6,1,u.id,u.id,current_timestamp,current_timestamp FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);
INSERT OR IGNORE INTO recruitment_stages SELECT o.id || ':rejected',o.id,'rejected','Rejected',7,1,u.id,u.id,current_timestamp,current_timestamp FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);
INSERT OR IGNORE INTO recruitment_stages SELECT o.id || ':withdrawn',o.id,'withdrawn','Withdrawn',8,1,u.id,u.id,current_timestamp,current_timestamp FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);
INSERT OR IGNORE INTO recruitment_stages SELECT o.id || ':archived',o.id,'archived','Archived',9,1,u.id,u.id,current_timestamp,current_timestamp FROM organizations o JOIN users u ON u.id=(SELECT id FROM users WHERE organization_id=o.id AND is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, id LIMIT 1);


-- Backfill genuine business activity from Phase 2.1 records for existing tenants.
INSERT OR IGNORE INTO candidate_activities (id,organization_id,candidate_id,application_id,activity_type,actor_user_id,summary,created_at)
SELECT 'activity:candidate:' || c.id,c.organization_id,c.id,NULL,'candidate_created',c.created_by,'Candidate created',c.created_at FROM candidates c;
INSERT OR IGNORE INTO candidate_activities (id,organization_id,candidate_id,application_id,activity_type,actor_user_id,summary,created_at)
SELECT 'activity:application:' || a.id,a.organization_id,a.candidate_id,a.id,'application_created',COALESCE((SELECT actor_user_id FROM application_history h WHERE h.organization_id=a.organization_id AND h.application_id=a.id ORDER BY h.created_at,h.id LIMIT 1),(SELECT id FROM users u WHERE u.organization_id=a.organization_id AND u.role='admin' ORDER BY u.id LIMIT 1)),'Application created',a.created_at FROM applications a;
INSERT OR IGNORE INTO candidate_activities (id,organization_id,candidate_id,application_id,activity_type,actor_user_id,summary,metadata,created_at)
SELECT 'activity:history:' || h.id,h.organization_id,a.candidate_id,h.application_id,'stage_changed',h.actor_user_id,'Application stage changed',json_object('previousStatus',h.previous_status,'newStatus',h.new_status),h.created_at
FROM application_history h JOIN applications a ON a.organization_id=h.organization_id AND a.id=h.application_id WHERE h.previous_status IS NOT NULL;
