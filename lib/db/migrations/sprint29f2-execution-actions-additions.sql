-- Sprint 29F.2 — Execution Actions table additions
-- Adds three columns required for Part B (lifecycle durability) and Part C (binding verification)

BEGIN;

-- Resolved connector operation type (write/create/move/word_create/etc.)
ALTER TABLE execution_actions ADD COLUMN IF NOT EXISTS operation_type text;

-- Approval plan binding hash — proves the approved target matches what was dispatched
ALTER TABLE execution_actions ADD COLUMN IF NOT EXISTS approval_plan_binding_hash text;

-- Reconciliation flag — set when physical op succeeded but lifecycle persistence failed
ALTER TABLE execution_actions ADD COLUMN IF NOT EXISTS reconciliation_required boolean NOT NULL DEFAULT false;

COMMIT;
