-- SYJ-HCM Phase 1.2c: productization / SaaS foundation.
-- Additive only. Historical migrations remain unchanged.

CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  locale TEXT NOT NULL DEFAULT 'en-IN',
  date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
  week_start_day INTEGER NOT NULL DEFAULT 1 CHECK (week_start_day BETWEEN 0 AND 6),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

INSERT INTO organization_settings (organization_id)
SELECT id FROM organizations ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_administrators (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE INDEX IF NOT EXISTS platform_audit_entity_idx ON platform_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS platform_audit_actor_idx ON platform_audit_logs(actor_user_id);
