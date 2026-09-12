export const WORKFLOW_STATUSES = ['applied','screening','shortlisted','interview','evaluation','offer','hired','rejected','withdrawn','archived'] as const;
export type WorkflowStatus = typeof WORKFLOW_STATUSES[number];

export const INTERVIEW_STATUSES = ['scheduled','confirmed','completed','cancelled','rescheduled','no_show'] as const;
export type InterviewStatus = typeof INTERVIEW_STATUSES[number];

export const FEEDBACK_RECOMMENDATIONS = ['strong_yes','yes','neutral','no','strong_no'] as const;
export type FeedbackRecommendation = typeof FEEDBACK_RECOMMENDATIONS[number];

export const DECISION_OUTCOMES = ['advance','hold','reject'] as const;
export type DecisionOutcome = typeof DECISION_OUTCOMES[number];

export const INTERVIEW_TYPES = ['phone_screen','technical','hr','manager','panel','final','other'] as const;

export const ACTIVITY_TYPES = [
  'candidate_created',
  'candidate_updated',
  'application_created',
  'stage_changed',
  'interview_scheduled',
  'interview_rescheduled',
  'interview_cancelled',
  'interviewer_assigned',
  'interviewer_removed',
  'feedback_submitted',
  'interview_completed',
  'interview_no_show',
  'interview_status_changed',
  'feedback_corrected',
  'decision_recorded',
  'candidate_note_added',
  'candidate_note_updated',
  'rejection',
  'withdrawal',
  'archive',
] as const;
