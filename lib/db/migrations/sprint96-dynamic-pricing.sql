-- Sprint 9.6 — Dynamic Workforce Pack Pricing
-- Creates price versioning, access requests, extends workforce_packs and
-- tenant_workforce_packs with commercial + onboarding config columns.
-- Idempotent: all operations use IF NOT EXISTS / ON CONFLICT guards.

-- ─── New enum: pack_pricing_status ──────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE pack_pricing_status AS ENUM (
    'not_configured', 'free', 'contact_sales', 'coming_soon'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── New enum: price_version_status ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE price_version_status AS ENUM (
    'draft', 'scheduled', 'active', 'superseded', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── New enum: pack_access_request_status ───────────────────────────────────
DO $$ BEGIN
  CREATE TYPE pack_access_request_status AS ENUM (
    'pending', 'approved', 'rejected', 'cancelled', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── New enum: tenant_pack_status ────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE tenant_pack_status AS ENUM (
    'active', 'trial', 'requested', 'pending_payment', 'pending_approval',
    'expired', 'cancelled', 'revoked'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Extend pack_grant_source enum with new access source values ─────────────
DO $$ BEGIN
  ALTER TYPE pack_grant_source ADD VALUE IF NOT EXISTS 'onboarding_trial';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE pack_grant_source ADD VALUE IF NOT EXISTS 'manual_grant';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE pack_grant_source ADD VALUE IF NOT EXISTS 'individual_purchase';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE pack_grant_source ADD VALUE IF NOT EXISTS 'enterprise_contract';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE pack_grant_source ADD VALUE IF NOT EXISTS 'tenant_override';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE pack_grant_source ADD VALUE IF NOT EXISTS 'core_auto';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── workforce_pack_price_versions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workforce_pack_price_versions (
  id                  TEXT PRIMARY KEY,
  workforce_pack_id   TEXT NOT NULL REFERENCES workforce_packs(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL DEFAULT 1,
  monthly_price_cents INTEGER,
  annual_price_cents  INTEGER,
  currency            TEXT NOT NULL DEFAULT 'AUD',
  status              price_version_status NOT NULL DEFAULT 'draft',
  effective_from      TIMESTAMPTZ,
  effective_to        TIMESTAMPTZ,
  is_current          BOOLEAN NOT NULL DEFAULT FALSE,
  notes               TEXT,
  created_by          TEXT NOT NULL,
  approved_by         TEXT,
  published_at        TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wppv_pack_id ON workforce_pack_price_versions(workforce_pack_id);
CREATE INDEX IF NOT EXISTS idx_wppv_current ON workforce_pack_price_versions(workforce_pack_id, is_current) WHERE is_current = TRUE;

-- Platform table: readable by all, writable by platform staff only
ALTER TABLE workforce_pack_price_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workforce_pack_price_versions;
CREATE POLICY tenant_isolation ON workforce_pack_price_versions
  USING (TRUE);

-- ─── workforce_pack_access_requests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workforce_pack_access_requests (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workforce_pack_id         TEXT NOT NULL REFERENCES workforce_packs(id),
  pack_code                 TEXT NOT NULL,
  requested_by              TEXT NOT NULL,
  requested_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                    pack_access_request_status NOT NULL DEFAULT 'pending',
  reviewed_by               TEXT,
  reviewed_at               TIMESTAMPTZ,
  review_notes              TEXT,
  requested_price_version_id TEXT,
  source                    TEXT NOT NULL DEFAULT 'plan_page',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wpar_org_id ON workforce_pack_access_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_wpar_status  ON workforce_pack_access_requests(status);

-- Tenant isolation: orgs only see their own requests
ALTER TABLE workforce_pack_access_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workforce_pack_access_requests;
CREATE POLICY tenant_isolation ON workforce_pack_access_requests
  USING (organization_id = current_setting('app.current_org_id', TRUE));

-- ─── Extend workforce_packs with new columns ─────────────────────────────────
ALTER TABLE workforce_packs
  ADD COLUMN IF NOT EXISTS is_free                 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pricing_status          pack_pricing_status NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS fallback_display_text   TEXT,
  ADD COLUMN IF NOT EXISTS auto_grant_on_signup    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_eligible          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_length_days       INTEGER,
  ADD COLUMN IF NOT EXISTS requires_manual_approval BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requires_payment        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS publicly_selectable     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS selection_mode          TEXT NOT NULL DEFAULT 'trial';

-- ─── Extend tenant_workforce_packs with new columns ──────────────────────────
ALTER TABLE tenant_workforce_packs
  ADD COLUMN IF NOT EXISTS tenant_pack_status  tenant_pack_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS price_version_id    TEXT,
  ADD COLUMN IF NOT EXISTS trial_started_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requested_by        TEXT,
  ADD COLUMN IF NOT EXISTS approved_by         TEXT;

-- ─── Seed updates: remove seeded prices from paid packs (idempotent) ─────────
-- Core pack: mark free, auto-grant on signup
UPDATE workforce_packs SET
  is_free             = TRUE,
  pricing_status      = 'free',
  auto_grant_on_signup = TRUE,
  trial_eligible      = FALSE,
  publicly_selectable = FALSE,   -- not shown in picker (always included)
  selection_mode      = 'included',
  updated_at          = NOW()
WHERE code = 'core';

-- Paid packs: null out seeded prices, configure as trial-eligible
-- Do NOT overwrite if a platform owner has already set a real price version
-- (safe because price versions are in a separate table; these columns are deprecated)
UPDATE workforce_packs SET
  price_monthly_cents  = NULL,
  price_annual_cents   = NULL,
  pricing_status       = 'contact_sales',
  fallback_display_text = 'Contact NeedsOps',
  is_free              = FALSE,
  trial_eligible       = TRUE,
  trial_length_days    = 14,
  requires_payment     = FALSE,
  publicly_selectable  = TRUE,
  selection_mode       = 'trial',
  updated_at           = NOW()
WHERE code != 'core'
  AND status IN ('available', 'coming_soon', 'draft')
  AND pricing_status = 'not_configured';  -- only touch if owner hasn't configured yet

-- ─── Verify ──────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
  SELECT count(*) INTO cnt FROM workforce_pack_price_versions;
  RAISE NOTICE 'Sprint 9.6 dynamic pricing: % price versions exist.', cnt;
  SELECT count(*) INTO cnt FROM workforce_pack_access_requests;
  RAISE NOTICE 'Sprint 9.6 dynamic pricing: % access requests exist.', cnt;
END $$;
