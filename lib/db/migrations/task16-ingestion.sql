-- Task #16 — Document Ingestion & Embedding Pipeline
-- Knowledge Hub: enable pgvector, upgrade knowledge_chunks, add ingestion_jobs
--
-- SAFE TO RE-RUN: uses IF NOT EXISTS / DROP IF EXISTS / IF EXISTS guards.
-- All Task #15 knowledge_* tables are new (no production data) so column
-- alterations are non-destructive.

BEGIN;

-- ─── 1. Enable pgvector ───────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── 2. Upgrade knowledge_chunks ─────────────────────────────────────────────

-- 2a. Add chunking strategy columns
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS chunking_strategy         TEXT NOT NULL DEFAULT 'heading_aware_v1',
  ADD COLUMN IF NOT EXISTS chunking_strategy_version TEXT NOT NULL DEFAULT '1.0.0';

-- 2b. Replace JSONB embedding with proper vector(1536) column
--     (drops the Task #15 placeholder; safe — no real data yet)
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE knowledge_chunks ADD COLUMN embedding vector(1536);

-- 2c. Replace TEXT lexical_search_vector with generated tsvector stored column
--     (pgvector must already be enabled; tsvector is always available)
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS lexical_search_vector;
ALTER TABLE knowledge_chunks ADD COLUMN lexical_search_vector
  tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;

-- 2d. Vector similarity index (HNSW — best for all dataset sizes in pgvector 0.5+)
--     Skips if index already exists.
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

-- 2e. GIN index for full-text search
CREATE INDEX IF NOT EXISTS knowledge_chunks_lexical_gin_idx
  ON knowledge_chunks
  USING gin (lexical_search_vector);

-- ─── 3. Create ingestion_jobs table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id                        TEXT        PRIMARY KEY,
  organization_id           TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  knowledge_source_id       TEXT        NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  source_version_id         TEXT        NOT NULL REFERENCES knowledge_source_versions(id) ON DELETE CASCADE,

  -- Status tracking
  status                    TEXT        NOT NULL DEFAULT 'queued',
  attempt_count             INTEGER     NOT NULL DEFAULT 0,
  max_attempts              INTEGER     NOT NULL DEFAULT 3,
  last_error_code           TEXT,
  last_error_message        TEXT,       -- safe (non-sensitive) error description

  -- Provider metadata (written on completion / failure)
  extraction_provider       TEXT,
  extraction_provider_version TEXT,
  embedding_provider        TEXT,
  embedding_model           TEXT,
  embedding_dimensions      INTEGER,
  chunking_strategy         TEXT        DEFAULT 'heading_aware_v1',
  chunking_strategy_version TEXT        DEFAULT '1.0.0',
  chunk_count               INTEGER,
  embedding_count           INTEGER,

  -- Security flags
  prompt_injection_flags    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  requires_human_review     BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Arbitrary pipeline metadata
  metadata                  JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  started_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  last_attempt_at           TIMESTAMPTZ,
  claimed_at                TIMESTAMPTZ,
  claimed_by                TEXT,       -- worker instance ID
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ingestion_jobs IS
  'Knowledge Hub — document ingestion job queue. One active job per source version at a time. Statuses: queued → fetching → extracting → normalising → chunking → embedding → review_required → approved | failed | cancelled | revoked.';

-- ─── 4. Indexes on ingestion_jobs ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ingestion_jobs_org_idx      ON ingestion_jobs (organization_id);
CREATE INDEX IF NOT EXISTS ingestion_jobs_source_idx   ON ingestion_jobs (knowledge_source_id);
CREATE INDEX IF NOT EXISTS ingestion_jobs_version_idx  ON ingestion_jobs (source_version_id);
CREATE INDEX IF NOT EXISTS ingestion_jobs_status_idx   ON ingestion_jobs (status);
CREATE INDEX IF NOT EXISTS ingestion_jobs_created_idx  ON ingestion_jobs (created_at DESC);
-- Partial index: only one active (non-terminal) job per version
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_jobs_active_version_uniq
  ON ingestion_jobs (source_version_id)
  WHERE status NOT IN ('failed', 'cancelled', 'approved');

-- ─── 5. RLS on ingestion_jobs ─────────────────────────────────────────────────
ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON ingestion_jobs;
CREATE POLICY "tenant_isolation" ON ingestion_jobs
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS "needsops_app_access" ON ingestion_jobs;
CREATE POLICY "needsops_app_access" ON ingestion_jobs
  TO needsops_app
  USING (TRUE)
  WITH CHECK (TRUE);

COMMIT;
