-- Sprint 22 — Work Execution Engine & Completed Work
-- Creates 6 new tables with RLS tenant isolation

-- ─── work_blueprints ────────────────────────────────────────────────────────
-- organizationId is nullable: NULL = built-in (visible to all orgs)

CREATE TABLE IF NOT EXISTS work_blueprints (
  id                        TEXT          NOT NULL PRIMARY KEY,
  organization_id           TEXT                    REFERENCES organizations(id) ON DELETE CASCADE,
  code                      TEXT          NOT NULL,
  title                     TEXT          NOT NULL,
  version                   TEXT          NOT NULL DEFAULT '1.0.0',
  objective                 TEXT          NOT NULL,
  primary_specialist        TEXT          NOT NULL,
  supporting_specialists    JSONB         NOT NULL DEFAULT '[]',
  required_library_knowledge JSONB        NOT NULL DEFAULT '[]',
  required_entity_knowledge JSONB         NOT NULL DEFAULT '{}',
  required_memories         JSONB         NOT NULL DEFAULT '[]',
  required_approvals        JSONB         NOT NULL DEFAULT '{}',
  validation_rules          JSONB         NOT NULL DEFAULT '[]',
  quality_rules             JSONB         NOT NULL DEFAULT '[]',
  success_criteria          JSONB         NOT NULL DEFAULT '[]',
  output_types              JSONB         NOT NULL DEFAULT '[]',
  escalation_rules          JSONB         NOT NULL DEFAULT '[]',
  mandatory_citations       JSONB         NOT NULL DEFAULT '[]',
  is_built_in               BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active                 BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_blueprints_org_id
  ON work_blueprints (organization_id);
CREATE INDEX IF NOT EXISTS idx_work_blueprints_code
  ON work_blueprints (code);
CREATE INDEX IF NOT EXISTS idx_work_blueprints_built_in
  ON work_blueprints (is_built_in) WHERE is_active = TRUE;

-- RLS: built-in rows (org_id IS NULL) are accessible to all; org rows are tenant-isolated
ALTER TABLE work_blueprints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON work_blueprints;
CREATE POLICY "tenant_isolation" ON work_blueprints
  USING (
    organization_id IS NULL
    OR organization_id = current_setting('app.current_organization_id', TRUE)
  );
DROP POLICY IF EXISTS "needsops_app_access" ON work_blueprints;
CREATE POLICY "needsops_app_access" ON work_blueprints
  TO needsops_app
  USING (
    organization_id IS NULL
    OR organization_id = current_setting('app.current_organization_id', TRUE)
  );

-- ─── work_package_manifests ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_package_manifests (
  id                            TEXT          NOT NULL PRIMARY KEY,
  organization_id               TEXT          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  completed_work_id             TEXT,
  execution_id                  TEXT          NOT NULL,
  blueprint_id                  TEXT,
  blueprint_version             TEXT,
  primary_specialist            TEXT          NOT NULL,
  supporting_specialists        JSONB         NOT NULL DEFAULT '[]',
  organisation_library_sources  JSONB         NOT NULL DEFAULT '[]',
  cos_memories                  JSONB         NOT NULL DEFAULT '[]',
  specialist_memories           JSONB         NOT NULL DEFAULT '[]',
  entity_knowledge              JSONB         NOT NULL DEFAULT '{}',
  task_uploads                  JSONB         NOT NULL DEFAULT '[]',
  model_version                 TEXT,
  prompt_version                TEXT,
  assembled_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  requester_id                  TEXT,
  created_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_package_manifests_org_id
  ON work_package_manifests (organization_id);
CREATE INDEX IF NOT EXISTS idx_work_package_manifests_execution_id
  ON work_package_manifests (execution_id);
CREATE INDEX IF NOT EXISTS idx_work_package_manifests_completed_work_id
  ON work_package_manifests (completed_work_id);

ALTER TABLE work_package_manifests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON work_package_manifests;
CREATE POLICY "tenant_isolation" ON work_package_manifests
  USING (organization_id = current_setting('app.current_organization_id', TRUE));
DROP POLICY IF EXISTS "needsops_app_access" ON work_package_manifests;
CREATE POLICY "needsops_app_access" ON work_package_manifests
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- ─── completed_work ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS completed_work (
  id                  TEXT          NOT NULL PRIMARY KEY,
  organization_id     TEXT          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id     TEXT,
  blueprint_id        TEXT,
  manifest_id         TEXT,
  primary_specialist  TEXT          NOT NULL,
  title               TEXT          NOT NULL,
  output_type         TEXT          NOT NULL DEFAULT 'general_output',
  status              TEXT          NOT NULL DEFAULT 'draft',
  current_version_id  TEXT,
  approval_workflow   JSONB                   DEFAULT '{}',
  created_by_user_id  TEXT          NOT NULL,
  approved_by_user_id TEXT,
  approved_at         TIMESTAMPTZ,
  rejected_at         TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  reopened_at         TIMESTAMPTZ,
  superseded_by_id    TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_completed_work_org_id
  ON completed_work (organization_id);
CREATE INDEX IF NOT EXISTS idx_completed_work_status
  ON completed_work (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_completed_work_conversation_id
  ON completed_work (conversation_id);
CREATE INDEX IF NOT EXISTS idx_completed_work_specialist
  ON completed_work (organization_id, primary_specialist);

ALTER TABLE completed_work ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON completed_work;
CREATE POLICY "tenant_isolation" ON completed_work
  USING (organization_id = current_setting('app.current_organization_id', TRUE));
DROP POLICY IF EXISTS "needsops_app_access" ON completed_work;
CREATE POLICY "needsops_app_access" ON completed_work
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- ─── completed_work_versions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS completed_work_versions (
  id                  TEXT          NOT NULL PRIMARY KEY,
  completed_work_id   TEXT          NOT NULL REFERENCES completed_work(id) ON DELETE CASCADE,
  organization_id     TEXT          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_number      INTEGER       NOT NULL,
  content_markdown    TEXT,
  quality_score       INTEGER,
  review_dimensions   JSONB                   DEFAULT '[]',
  change_note         TEXT,
  is_auto_revision    TEXT                    DEFAULT 'false',
  created_by_user_id  TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_completed_work_versions_work_id
  ON completed_work_versions (completed_work_id);
CREATE INDEX IF NOT EXISTS idx_completed_work_versions_org_id
  ON completed_work_versions (organization_id);

ALTER TABLE completed_work_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON completed_work_versions;
CREATE POLICY "tenant_isolation" ON completed_work_versions
  USING (organization_id = current_setting('app.current_organization_id', TRUE));
DROP POLICY IF EXISTS "needsops_app_access" ON completed_work_versions;
CREATE POLICY "needsops_app_access" ON completed_work_versions
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- ─── completed_work_comments ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS completed_work_comments (
  id                  TEXT          NOT NULL PRIMARY KEY,
  completed_work_id   TEXT          NOT NULL REFERENCES completed_work(id) ON DELETE CASCADE,
  organization_id     TEXT          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  content             TEXT          NOT NULL,
  author_user_id      TEXT          NOT NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_completed_work_comments_work_id
  ON completed_work_comments (completed_work_id);
CREATE INDEX IF NOT EXISTS idx_completed_work_comments_org_id
  ON completed_work_comments (organization_id);

ALTER TABLE completed_work_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON completed_work_comments;
CREATE POLICY "tenant_isolation" ON completed_work_comments
  USING (organization_id = current_setting('app.current_organization_id', TRUE));
DROP POLICY IF EXISTS "needsops_app_access" ON completed_work_comments;
CREATE POLICY "needsops_app_access" ON completed_work_comments
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- ─── completed_work_assets ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS completed_work_assets (
  id                  TEXT          NOT NULL PRIMARY KEY,
  completed_work_id   TEXT          NOT NULL REFERENCES completed_work(id) ON DELETE CASCADE,
  organization_id     TEXT          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_type          TEXT          NOT NULL,
  asset_id            TEXT          NOT NULL,
  role                TEXT          NOT NULL DEFAULT 'supporting',
  citation_ref        TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_completed_work_assets_work_id
  ON completed_work_assets (completed_work_id);
CREATE INDEX IF NOT EXISTS idx_completed_work_assets_org_id
  ON completed_work_assets (organization_id);
CREATE INDEX IF NOT EXISTS idx_completed_work_assets_asset_id
  ON completed_work_assets (asset_id);

ALTER TABLE completed_work_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON completed_work_assets;
CREATE POLICY "tenant_isolation" ON completed_work_assets
  USING (organization_id = current_setting('app.current_organization_id', TRUE));
DROP POLICY IF EXISTS "needsops_app_access" ON completed_work_assets;
CREATE POLICY "needsops_app_access" ON completed_work_assets
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));
