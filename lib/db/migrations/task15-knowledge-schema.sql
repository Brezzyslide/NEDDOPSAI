-- Task #15 — Knowledge Schema, Scopes & Secure Upload
--
-- Implements the Organisation Library foundation:
--   knowledge_sources          — core knowledge asset records
--   knowledge_source_scopes    — relational scope assignments
--   knowledge_source_versions  — version lineage
--   knowledge_chunks           — placeholder for Task #16 extraction
--   specialist_training_status — per-specialist training state machine
--   retrieval_audit_events     — placeholder for Task #17 retrieval audit
--
-- REQUIRED_RLS_TABLES: 53 → 59
--
-- Backwards compatibility:
--   - No existing tables are modified.
--   - organisation_memory, specialist_language_profiles, and all Task #14
--     behaviour are fully preserved.
--   - Existing org memory is NOT migrated into knowledge_sources in this task.
--     Task #16 (or a future bridge migration) may optionally do so.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. knowledge_sources
--
-- The Organisation Library — the central organisational knowledge repository.
-- Also tracks task-scoped uploads (source_scope = 'task') separately from
-- the library (source_scope = 'library') with hard enforcement via NOT NULL.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id                          text PRIMARY KEY,
  organization_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

  -- Scope
  source_scope                text NOT NULL DEFAULT 'library',
  task_id                     text,

  -- Identity
  title                       text NOT NULL,
  description                 text,
  source_type                 text NOT NULL,

  -- File metadata
  original_file_name          text,
  mime_type                   text,
  storage_provider            text,
  storage_key                 text,
  external_source_id          text,
  checksum                    text,
  file_size                   integer,

  -- Language & governance
  language                    text NOT NULL DEFAULT 'en',
  status                      text NOT NULL DEFAULT 'uploaded',
  authority_level             text NOT NULL DEFAULT 'supporting',
  sensitivity_classification  text NOT NULL DEFAULT 'internal',

  -- Effective dates
  effective_from              timestamptz,
  effective_to                timestamptz,

  -- Versioning
  version_label               text,
  is_current                  boolean NOT NULL DEFAULT true,
  superseded_by_source_id     text,

  -- Approval & audit
  uploaded_by_user_id         text NOT NULL,
  approved_by_user_id         text,
  approved_at                 timestamptz,
  revoked_at                  timestamptz,

  -- Timestamps
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz
);

COMMENT ON TABLE knowledge_sources IS
  'Organisation Library — central knowledge repository for AI specialist training. '
  'source_scope=''library'' records are eligible for specialist retrieval. '
  'source_scope=''task'' records are private to that task and never trained on.';

COMMENT ON COLUMN knowledge_sources.source_scope IS
  '''library'' = Organisation Library (specialist training eligible). '
  '''task'' = task-scoped upload; never promoted automatically to library.';

COMMENT ON COLUMN knowledge_sources.task_id IS
  'For task-scoped sources: the originating task ID. '
  'NULL for library sources. FK hook for future Completed Work module.';

CREATE INDEX IF NOT EXISTS knowledge_sources_org_idx
  ON knowledge_sources (organization_id);

CREATE INDEX IF NOT EXISTS knowledge_sources_org_scope_idx
  ON knowledge_sources (organization_id, source_scope);

CREATE INDEX IF NOT EXISTS knowledge_sources_org_status_idx
  ON knowledge_sources (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_sources_org_type_idx
  ON knowledge_sources (organization_id, source_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_sources_checksum_org_idx
  ON knowledge_sources (organization_id, checksum)
  WHERE checksum IS NOT NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON knowledge_sources;
CREATE POLICY tenant_isolation ON knowledge_sources
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS needsops_app_access ON knowledge_sources;
CREATE POLICY needsops_app_access ON knowledge_sources
  AS PERMISSIVE FOR ALL
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. knowledge_source_scopes
--
-- Relational scope assignments — a source can belong to multiple scopes.
-- Unique constraint prevents duplicate (source, scopeType, scopeId).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_source_scopes (
  id                  text PRIMARY KEY,
  knowledge_source_id text NOT NULL REFERENCES knowledge_sources (id) ON DELETE CASCADE,
  organization_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope_type          text NOT NULL,
  scope_id            text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE knowledge_source_scopes IS
  'Relational scope assignments. A library source may belong to multiple scopes '
  '(organisation, specialist, department, etc.) simultaneously.';

-- Prevent duplicate scope assignments
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_source_scopes_unique_scope_idx
  ON knowledge_source_scopes (knowledge_source_id, scope_type, scope_id);

CREATE INDEX IF NOT EXISTS knowledge_source_scopes_org_idx
  ON knowledge_source_scopes (organization_id);

CREATE INDEX IF NOT EXISTS knowledge_source_scopes_source_idx
  ON knowledge_source_scopes (knowledge_source_id);

-- Optimise retrieval filtering by scope
CREATE INDEX IF NOT EXISTS knowledge_source_scopes_type_id_idx
  ON knowledge_source_scopes (organization_id, scope_type, scope_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE knowledge_source_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON knowledge_source_scopes;
CREATE POLICY tenant_isolation ON knowledge_source_scopes
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS needsops_app_access ON knowledge_source_scopes;
CREATE POLICY needsops_app_access ON knowledge_source_scopes
  AS PERMISSIVE FOR ALL
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. knowledge_source_versions
--
-- Version lineage for knowledge assets.
-- Only one version per knowledge_source_id may have is_current = true.
-- Superseded versions are retained for audit and citation.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_source_versions (
  id                   text PRIMARY KEY,
  knowledge_source_id  text NOT NULL REFERENCES knowledge_sources (id) ON DELETE CASCADE,
  organization_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  version_label        text NOT NULL,
  checksum             text,
  storage_key          text,
  storage_provider     text,
  file_size            integer,
  mime_type            text,
  original_file_name   text,
  is_current           boolean NOT NULL DEFAULT false,
  status               text NOT NULL DEFAULT 'uploaded',
  effective_from       timestamptz,
  effective_to         timestamptz,
  superseded_by_id     text,
  uploaded_by_user_id  text NOT NULL,
  approved_by_user_id  text,
  approved_at          timestamptz,
  ingestion_status     text NOT NULL DEFAULT 'pending',
  ingestion_metadata   jsonb NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE knowledge_source_versions IS
  'Version lineage for knowledge assets. '
  'Superseded versions are retained for audit and citation; never served as active knowledge.';

CREATE INDEX IF NOT EXISTS knowledge_source_versions_source_idx
  ON knowledge_source_versions (knowledge_source_id);

CREATE INDEX IF NOT EXISTS knowledge_source_versions_org_idx
  ON knowledge_source_versions (organization_id);

-- Partial index: quickly find the current active version
CREATE INDEX IF NOT EXISTS knowledge_source_versions_current_idx
  ON knowledge_source_versions (knowledge_source_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS knowledge_source_versions_ingestion_idx
  ON knowledge_source_versions (organization_id, ingestion_status)
  WHERE ingestion_status != 'complete';

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE knowledge_source_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON knowledge_source_versions;
CREATE POLICY tenant_isolation ON knowledge_source_versions
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS needsops_app_access ON knowledge_source_versions;
CREATE POLICY needsops_app_access ON knowledge_source_versions
  AS PERMISSIVE FOR ALL
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. knowledge_chunks
--
-- PLACEHOLDER — populated by Task #16 (Document Ingestion & Embedding Pipeline).
-- Schema is defined now to avoid a breaking migration in Task #16.
-- embedding column will be altered to vector(N) when pgvector is enabled.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id                    text PRIMARY KEY,
  organization_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  knowledge_source_id   text NOT NULL REFERENCES knowledge_sources (id) ON DELETE CASCADE,
  source_version_id     text NOT NULL REFERENCES knowledge_source_versions (id) ON DELETE CASCADE,
  chunk_index           integer NOT NULL,
  section_title         text,
  page_number           integer,
  heading_path          text,
  text                  text NOT NULL,
  token_count           integer,
  lexical_search_vector text,   -- placeholder: ALTER to tsvector in Task #16
  embedding             jsonb,  -- placeholder: ALTER to vector(N) in Task #16
  embedding_model       text,
  embedding_dimensions  integer,
  content_hash          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

COMMENT ON TABLE knowledge_chunks IS
  'PLACEHOLDER — populated by Task #16 (Document Ingestion & Embedding Pipeline). '
  'lexical_search_vector will be altered to tsvector in Task #16. '
  'embedding will be altered to vector(N) when pgvector is enabled.';

CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx
  ON knowledge_chunks (knowledge_source_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_version_idx
  ON knowledge_chunks (source_version_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_org_idx
  ON knowledge_chunks (organization_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_content_hash_idx
  ON knowledge_chunks (organization_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON knowledge_chunks;
CREATE POLICY tenant_isolation ON knowledge_chunks
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS needsops_app_access ON knowledge_chunks;
CREATE POLICY needsops_app_access ON knowledge_chunks
  AS PERMISSIVE FOR ALL
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. specialist_training_status
--
-- Per-org, per-specialist training readiness state machine.
-- Unique: (organization_id, specialist_id) — one record per specialist per org.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS specialist_training_status (
  id                         text PRIMARY KEY,
  organization_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  specialist_id              text NOT NULL,
  status                     text NOT NULL DEFAULT 'not_started',
  configuration_complete     boolean NOT NULL DEFAULT false,
  knowledge_sources_approved boolean NOT NULL DEFAULT false,
  retrieval_test_passed      boolean NOT NULL DEFAULT false,
  sample_task_passed         boolean NOT NULL DEFAULT false,
  approved_by_user_id        text,
  approved_at                timestamptz,
  last_tested_at             timestamptz,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE specialist_training_status IS
  'Per-specialist training readiness state machine. '
  'Only org owner/admin may transition to ''ready'' status.';

CREATE UNIQUE INDEX IF NOT EXISTS specialist_training_status_org_specialist_idx
  ON specialist_training_status (organization_id, specialist_id);

CREATE INDEX IF NOT EXISTS specialist_training_status_org_idx
  ON specialist_training_status (organization_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE specialist_training_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON specialist_training_status;
CREATE POLICY tenant_isolation ON specialist_training_status
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS needsops_app_access ON specialist_training_status;
CREATE POLICY needsops_app_access ON specialist_training_status
  AS PERMISSIVE FOR ALL
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. retrieval_audit_events
--
-- PLACEHOLDER — populated by Task #17 (Hybrid Retrieval).
-- Provides citation chain from specialist responses to source documents.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS retrieval_audit_events (
  id                text PRIMARY KEY,
  organization_id   text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  specialist_id     text NOT NULL,
  execution_id      text,
  source_ids        jsonb NOT NULL DEFAULT '[]',
  chunk_ids         jsonb NOT NULL DEFAULT '[]',
  retrieval_method  text,
  score_metadata    jsonb NOT NULL DEFAULT '{}',
  token_count       integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE retrieval_audit_events IS
  'PLACEHOLDER — populated by Task #17 (Hybrid Retrieval & Runtime Instruction Wiring). '
  'Provides citation chain from specialist responses to Organisation Library sources.';

CREATE INDEX IF NOT EXISTS retrieval_audit_events_org_idx
  ON retrieval_audit_events (organization_id);

CREATE INDEX IF NOT EXISTS retrieval_audit_events_specialist_idx
  ON retrieval_audit_events (organization_id, specialist_id);

CREATE INDEX IF NOT EXISTS retrieval_audit_events_execution_idx
  ON retrieval_audit_events (execution_id)
  WHERE execution_id IS NOT NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE retrieval_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON retrieval_audit_events;
CREATE POLICY tenant_isolation ON retrieval_audit_events
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS needsops_app_access ON retrieval_audit_events;
CREATE POLICY needsops_app_access ON retrieval_audit_events
  AS PERMISSIVE FOR ALL
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

COMMIT;
