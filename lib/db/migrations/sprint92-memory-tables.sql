-- Sprint 9.2 — Tenant-Aware Chief of Staff Memory
-- Platform DB tables: organisation_memory and conversation_memory
-- Run against the platform database.

BEGIN;

-- ── organisation_memory ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organisation_memory (
  id                  TEXT            NOT NULL PRIMARY KEY,
  organization_id     TEXT            NOT NULL
                        REFERENCES organizations(id) ON DELETE CASCADE,
  memory_type         TEXT            NOT NULL DEFAULT 'other'
                        CHECK (memory_type IN (
                          'organisation_profile','operating_preference','terminology',
                          'approval_rule','reporting_line','system_information','workflow',
                          'policy_reference','customer_preference','risk_constraint',
                          'compliance_context','other'
                        )),
  title               TEXT            NOT NULL,
  content             TEXT            NOT NULL,
  structured_content  JSONB           NOT NULL DEFAULT '{}',
  source_type         TEXT            NOT NULL DEFAULT 'conversation',
  source_id           TEXT,
  status              TEXT            NOT NULL DEFAULT 'proposed'
                        CHECK (status IN ('proposed','approved','rejected','superseded','expired')),
  confidence          NUMERIC(3,2)    NOT NULL DEFAULT 0.80
                        CHECK (confidence >= 0 AND confidence <= 1),
  importance          INTEGER         NOT NULL DEFAULT 5
                        CHECK (importance >= 1 AND importance <= 10),
  effective_from      TIMESTAMPTZ,
  effective_to        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  created_by          TEXT            NOT NULL,
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  superseded_by       TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_memory_org_status
  ON organisation_memory (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_org_memory_type
  ON organisation_memory (organization_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_org_memory_importance
  ON organisation_memory (organization_id, importance DESC);
CREATE INDEX IF NOT EXISTS idx_org_memory_updated
  ON organisation_memory (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_memory_source
  ON organisation_memory (source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE organisation_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON organisation_memory;
CREATE POLICY tenant_isolation ON organisation_memory
  USING (
    organization_id = current_setting('app.current_organization_id', TRUE)
    OR current_setting('app.current_organization_id', TRUE) IS NULL
    OR current_setting('app.current_organization_id', TRUE) = ''
  );

DROP POLICY IF EXISTS needsops_app ON organisation_memory;
CREATE POLICY needsops_app ON organisation_memory
  TO needsops_app USING (true) WITH CHECK (true);

-- ── conversation_memory ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_memory (
  id                             TEXT        NOT NULL PRIMARY KEY,
  organization_id                TEXT        NOT NULL
                                   REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id                TEXT        NOT NULL
                                   REFERENCES conversations(id) ON DELETE CASCADE,
  summary                        TEXT        NOT NULL DEFAULT '',
  structured_summary             JSONB       NOT NULL DEFAULT '{}',
  summary_version                INTEGER     NOT NULL DEFAULT 1,
  summarised_through_message_id  TEXT,
  summarised_message_count       INTEGER     NOT NULL DEFAULT 0,
  unresolved_questions           JSONB       NOT NULL DEFAULT '[]',
  pinned_decisions               JSONB       NOT NULL DEFAULT '[]',
  assumptions                    JSONB       NOT NULL DEFAULT '[]',
  participants                   JSONB       NOT NULL DEFAULT '[]',
  related_task_ids               JSONB       NOT NULL DEFAULT '[]',
  last_updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_conv_memory_conversation UNIQUE (conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_memory_org
  ON conversation_memory (organization_id);
CREATE INDEX IF NOT EXISTS idx_conv_memory_conversation
  ON conversation_memory (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_memory_summarised_through
  ON conversation_memory (summarised_through_message_id)
  WHERE summarised_through_message_id IS NOT NULL;

ALTER TABLE conversation_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON conversation_memory;
CREATE POLICY tenant_isolation ON conversation_memory
  USING (
    organization_id = current_setting('app.current_organization_id', TRUE)
    OR current_setting('app.current_organization_id', TRUE) IS NULL
    OR current_setting('app.current_organization_id', TRUE) = ''
  );

DROP POLICY IF EXISTS needsops_app ON conversation_memory;
CREATE POLICY needsops_app ON conversation_memory
  TO needsops_app USING (true) WITH CHECK (true);

COMMIT;
