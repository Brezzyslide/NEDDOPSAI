-- Sprint 21 — Knowledge Curation Jobs
-- Creates knowledge_curation_jobs table with RLS tenant isolation

CREATE TABLE IF NOT EXISTS knowledge_curation_jobs (
  id                   TEXT        NOT NULL PRIMARY KEY,
  organization_id      TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  knowledge_source_id  TEXT        NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  source_version_id    TEXT,
  previous_version_id  TEXT,
  trigger_event        TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending',
  proposals_generated  INTEGER     NOT NULL DEFAULT 0,
  proposals_accepted   INTEGER     NOT NULL DEFAULT 0,
  version_summary      JSONB,
  processing_log       JSONB,
  error_message        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_knowledge_curation_jobs_org_id
  ON knowledge_curation_jobs (organization_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_curation_jobs_source_id
  ON knowledge_curation_jobs (knowledge_source_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_curation_jobs_status
  ON knowledge_curation_jobs (organization_id, status);

-- RLS tenant isolation
ALTER TABLE knowledge_curation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON knowledge_curation_jobs;
CREATE POLICY "tenant_isolation" ON knowledge_curation_jobs
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS "needsops_app_access" ON knowledge_curation_jobs;
CREATE POLICY "needsops_app_access" ON knowledge_curation_jobs
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));
