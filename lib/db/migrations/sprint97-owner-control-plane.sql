-- Sprint 9.7 — Owner Portal Control Plane
-- Adds org operational columns, expands enums, creates seat_overrides table.
-- Idempotent: uses IF NOT EXISTS / DO $$ blocks throughout.

BEGIN;

-- ── 1. Expand org_status enum ─────────────────────────────────────────────────
-- Add 'trial', 'past_due', 'restricted' if they don't already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'org_status'::regtype AND enumlabel = 'trial'
  ) THEN
    ALTER TYPE org_status ADD VALUE 'trial';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'org_status'::regtype AND enumlabel = 'past_due'
  ) THEN
    ALTER TYPE org_status ADD VALUE 'past_due';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'org_status'::regtype AND enumlabel = 'restricted'
  ) THEN
    ALTER TYPE org_status ADD VALUE 'restricted';
  END IF;
END$$;

-- ── 2. Expand platform_role enum ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'platform_role'::regtype AND enumlabel = 'platform_admin'
  ) THEN
    ALTER TYPE platform_role ADD VALUE 'platform_admin';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'platform_role'::regtype AND enumlabel = 'platform_commercial'
  ) THEN
    ALTER TYPE platform_role ADD VALUE 'platform_commercial';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'platform_role'::regtype AND enumlabel = 'platform_operations'
  ) THEN
    ALTER TYPE platform_role ADD VALUE 'platform_operations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'platform_role'::regtype AND enumlabel = 'platform_support'
  ) THEN
    ALTER TYPE platform_role ADD VALUE 'platform_support';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'platform_role'::regtype AND enumlabel = 'platform_security'
  ) THEN
    ALTER TYPE platform_role ADD VALUE 'platform_security';
  END IF;
END$$;

-- ── 3. Add new columns to organizations ──────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS execution_frozen       BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS login_disabled         BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspension_reason      TEXT,
  ADD COLUMN IF NOT EXISTS closure_reason         TEXT,
  ADD COLUMN IF NOT EXISTS closed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by              TEXT,
  ADD COLUMN IF NOT EXISTS status_changed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_changed_by      TEXT,
  ADD COLUMN IF NOT EXISTS legal_name             TEXT,
  ADD COLUMN IF NOT EXISTS trading_name           TEXT,
  ADD COLUMN IF NOT EXISTS support_status         TEXT          NOT NULL DEFAULT 'normal';

-- ── 4. Create seat_overrides table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seat_overrides (
  id                TEXT          PRIMARY KEY,
  organization_id   TEXT          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seat_allowance    INTEGER,
  override_reason   TEXT          NOT NULL,
  set_by            TEXT          NOT NULL,
  effective_from    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  effective_to      TIMESTAMPTZ,
  revoked           BOOLEAN       NOT NULL DEFAULT FALSE,
  revoked_at        TIMESTAMPTZ,
  revoked_by        TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seat_overrides_org_active
  ON seat_overrides(organization_id, effective_from, effective_to)
  WHERE revoked = FALSE;

-- ── 5. RLS on seat_overrides (platform-admin scoped — no tenant isolation) ──
-- seat_overrides is a platform table; no org-level RLS needed.
-- Add a permissive policy so the platform role can read/write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'seat_overrides' AND policyname = 'platform_access'
  ) THEN
    ALTER TABLE seat_overrides ENABLE ROW LEVEL SECURITY;
    CREATE POLICY platform_access ON seat_overrides USING (TRUE);
  END IF;
END$$;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE 'Sprint 9.7 migration complete. org_status now has % values.',
    (SELECT count(*) FROM pg_enum WHERE enumtypid = 'org_status'::regtype);
END$$;
