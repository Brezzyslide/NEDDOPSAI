-- 0041_task_evidence_required_state.sql
-- Adds a first-class task lifecycle state for work paused on missing evidence.
-- This keeps EVIDENCE_REQUIRED distinct from APPROVAL_REQUIRED and EXECUTING.

ALTER TYPE task_state ADD VALUE IF NOT EXISTS 'evidence_required' AFTER 'awaiting_approval';
