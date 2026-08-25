-- 0040 — Durable task creation idempotency ledger
--
-- Prevents duplicate canonical task rows when the same idempotency scope is
-- submitted concurrently. Existing duplicate task rows are preserved for
-- forensic review; the backfill records the earliest canonical task per key.

CREATE TABLE IF NOT EXISTS task_creation_idempotency_keys (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  conversation_id TEXT,
  work_intent_key TEXT,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_creation_idempotency_keys_pk
    PRIMARY KEY (organization_id, scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_task_creation_idempotency_task_id
  ON task_creation_idempotency_keys (task_id);

CREATE INDEX IF NOT EXISTS idx_task_creation_idempotency_conversation_intent
  ON task_creation_idempotency_keys (organization_id, conversation_id, work_intent_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON task_creation_idempotency_keys TO needsops_app;

ALTER TABLE task_creation_idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON task_creation_idempotency_keys;
CREATE POLICY "tenant_isolation" ON task_creation_idempotency_keys
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS "needsops_app_access" ON task_creation_idempotency_keys;
CREATE POLICY "needsops_app_access" ON task_creation_idempotency_keys
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', TRUE));

WITH canonical AS (
  SELECT DISTINCT ON (
    organization_id,
    metadata #>> '{taskCreation,idempotencyKey}'
  )
    organization_id,
    'idempotency_key'::TEXT AS scope,
    metadata #>> '{taskCreation,idempotencyKey}' AS idempotency_key,
    id AS task_id,
    metadata #>> '{taskCreation,conversationId}' AS conversation_id,
    metadata #>> '{taskCreation,workIntentKey}' AS work_intent_key,
    title,
    created_at
  FROM tasks
  WHERE metadata #>> '{taskCreation,idempotencyKey}' IS NOT NULL
    AND metadata #>> '{taskCreation,idempotencyKey}' <> ''
  ORDER BY
    organization_id,
    metadata #>> '{taskCreation,idempotencyKey}',
    created_at ASC,
    id ASC
)
INSERT INTO task_creation_idempotency_keys (
  organization_id,
  scope,
  idempotency_key,
  task_id,
  conversation_id,
  work_intent_key,
  title,
  created_at,
  updated_at
)
SELECT
  organization_id,
  scope,
  idempotency_key,
  task_id,
  conversation_id,
  work_intent_key,
  title,
  created_at,
  NOW()
FROM canonical
ON CONFLICT DO NOTHING;
