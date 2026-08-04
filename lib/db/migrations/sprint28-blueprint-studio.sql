-- Sprint 28 — Blueprint Studio & Organisation Workflow Designer
-- Adds blueprint versioning (blueprint_versions) and status lifecycle column
-- to work_blueprints.
-- REQUIRED_RLS_TABLES: 68 → 69

-- ─── Add status column to work_blueprints ────────────────────────────────────
-- Existing org blueprints default to "draft"; built-ins default to "published".
ALTER TABLE work_blueprints
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

-- Backfill: built-in blueprints are treated as published
UPDATE work_blueprints
   SET status = 'published'
 WHERE is_built_in = TRUE;

-- ─── blueprint_versions ──────────────────────────────────────────────────────
-- Immutable snapshots created on each publish action.

CREATE TABLE IF NOT EXISTS blueprint_versions (
  id               TEXT        NOT NULL PRIMARY KEY,
  blueprint_id     TEXT        NOT NULL REFERENCES work_blueprints(id) ON DELETE CASCADE,
  organization_id  TEXT        NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,
  version_label    TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'draft',
  snapshot         JSONB       NOT NULL DEFAULT '{}',
  notes            TEXT,
  created_by       TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blueprint_versions_blueprint_id
  ON blueprint_versions (blueprint_id);
CREATE INDEX IF NOT EXISTS idx_blueprint_versions_org_id
  ON blueprint_versions (organization_id);

-- RLS: tenant isolation
ALTER TABLE blueprint_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON blueprint_versions;
CREATE POLICY "tenant_isolation" ON blueprint_versions
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS "needsops_app_access" ON blueprint_versions;
CREATE POLICY "needsops_app_access" ON blueprint_versions
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));
