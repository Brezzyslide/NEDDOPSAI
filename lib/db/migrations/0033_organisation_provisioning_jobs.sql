-- Migration: Task #33 — Owner Console Org Provisioning
-- Creates the organisation_provisioning_jobs table used to track
-- platform-initiated org provisioning runs step by step.

CREATE TABLE IF NOT EXISTS organisation_provisioning_jobs (
  id                TEXT        PRIMARY KEY,
  -- Nullable until the create_org step completes successfully.
  organization_id   TEXT        REFERENCES organizations(id),
  initiated_by      TEXT        NOT NULL,
  -- overall status: pending | running | completed | failed
  status            TEXT        NOT NULL DEFAULT 'pending',
  -- per-step status map stored as JSONB
  steps             JSONB       NOT NULL DEFAULT '{}',
  error_message     TEXT,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_provisioning_jobs_org
  ON organisation_provisioning_jobs(organization_id);

CREATE INDEX IF NOT EXISTS idx_org_provisioning_jobs_status
  ON organisation_provisioning_jobs(status);

-- Allow NULLs in organization_id for environments that applied
-- an earlier version of this table with NOT NULL.
DO $$
BEGIN
  ALTER TABLE organisation_provisioning_jobs
    ALTER COLUMN organization_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
