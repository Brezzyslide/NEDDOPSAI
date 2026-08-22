-- 0035 — Runtime, conversation, capability and evidence RLS closure
-- Platform DB: closes the fresh-bootstrap RLS gap for tables added after the
-- original Sprint 7 verifier baseline.

BEGIN;

-- ── Sprint 29K.2 — Durable evidence foundation ───────────────────────────────

CREATE TABLE IF NOT EXISTS completed_work_evidence_snapshots (
  id                     TEXT PRIMARY KEY,
  execution_id           TEXT NOT NULL,
  completed_work_id      TEXT NOT NULL REFERENCES completed_work(id) ON DELETE CASCADE,
  version_id             TEXT NOT NULL REFERENCES completed_work_versions(id) ON DELETE CASCADE,
  organization_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  total_chunks_available INTEGER NOT NULL DEFAULT 0,
  avg_relevance_score    REAL,
  retrieval_method       TEXT,
  retrieval_ms           INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cw_evidence_snapshot_exec_ver_uniq
  ON completed_work_evidence_snapshots (execution_id, version_id);

CREATE TABLE IF NOT EXISTS completed_work_evidence_links (
  id                 TEXT PRIMARY KEY,
  execution_id       TEXT NOT NULL,
  completed_work_id  TEXT NOT NULL REFERENCES completed_work(id) ON DELETE CASCADE,
  version_id         TEXT NOT NULL REFERENCES completed_work_versions(id) ON DELETE CASCADE,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chunk_id           TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  source_version_id  TEXT,
  passage_hash       TEXT NOT NULL,
  passage_snapshot   TEXT NOT NULL,
  section_title      TEXT,
  page_number        INTEGER,
  relevance_score    REAL NOT NULL,
  selection_reason   TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cw_evidence_link_exec_ver_chunk_uniq
  ON completed_work_evidence_links (execution_id, version_id, chunk_id);

-- ── Sprint 29K.3 — Claim emission and evidence binding ───────────────────────

CREATE TABLE IF NOT EXISTS completed_work_claims (
  id                  TEXT PRIMARY KEY,
  execution_id        TEXT NOT NULL,
  completed_work_id   TEXT NOT NULL REFERENCES completed_work(id) ON DELETE CASCADE,
  version_id          TEXT NOT NULL REFERENCES completed_work_versions(id) ON DELETE CASCADE,
  organization_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  claim_text          TEXT NOT NULL,
  claim_type          TEXT NOT NULL,
  section_ref         TEXT,
  confidence          REAL,
  reasoning_summary   TEXT,
  related_claim_ids   TEXT[] DEFAULT ARRAY[]::TEXT[],
  absence_record      JSONB,
  provenance_status   TEXT NOT NULL DEFAULT 'unsupported',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS completed_work_claims_cw_org_idx
  ON completed_work_claims (completed_work_id, organization_id);

CREATE INDEX IF NOT EXISTS completed_work_claims_version_org_idx
  ON completed_work_claims (version_id, organization_id);

CREATE INDEX IF NOT EXISTS completed_work_claims_execution_idx
  ON completed_work_claims (execution_id);

CREATE INDEX IF NOT EXISTS completed_work_claims_type_idx
  ON completed_work_claims (claim_type);

CREATE TABLE IF NOT EXISTS completed_work_claim_evidence (
  id                TEXT PRIMARY KEY,
  claim_id          TEXT NOT NULL REFERENCES completed_work_claims(id) ON DELETE CASCADE,
  evidence_link_id  TEXT NOT NULL REFERENCES completed_work_evidence_links(id) ON DELETE CASCADE,
  organization_id   TEXT NOT NULL,
  relationship      TEXT NOT NULL,
  supporting_span   TEXT,
  span_verified     TEXT NOT NULL DEFAULT 'false',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT completed_work_claim_evidence_unique UNIQUE (claim_id, evidence_link_id, relationship)
);

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'execution_sessions',
    'execution_events',
    'conversations',
    'conversation_messages',
    'conversation_participants',
    'message_attachments',
    'message_reads',
    'capability_decisions',
    'completed_work_evidence_snapshots',
    'completed_work_evidence_links',
    'completed_work_claims',
    'completed_work_claim_evidence'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = NULLIF(current_setting(%L, TRUE), %L))',
      tbl,
      'app.current_organization_id',
      ''
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS cap_decisions_org_isolation ON capability_decisions;

COMMIT;
