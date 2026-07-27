-- Sprint 9.6 — Pack Commerce Migration
-- Adds commerce + display columns to workforce_packs, seeds 6 packs.

-- ─── Extend pack_status enum ─────────────────────────────────────────────────
-- PostgreSQL does not allow removing enum values. We only ADD 'draft' and 'archived'.
DO $$ BEGIN
  ALTER TYPE pack_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'available';
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TYPE pack_status ADD VALUE IF NOT EXISTS 'archived';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Add new columns to workforce_packs ──────────────────────────────────────
ALTER TABLE workforce_packs
  ADD COLUMN IF NOT EXISTS code               TEXT,
  ADD COLUMN IF NOT EXISTS marketing_tagline  TEXT,
  ADD COLUMN IF NOT EXISTS icon_emoji         TEXT,
  ADD COLUMN IF NOT EXISTS color_hex          TEXT,
  ADD COLUMN IF NOT EXISTS price_monthly_cents INTEGER,
  ADD COLUMN IF NOT EXISTS price_annual_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS currency           TEXT NOT NULL DEFAULT 'AUD',
  ADD COLUMN IF NOT EXISTS display_order      SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS featured           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_publicly_visible BOOLEAN NOT NULL DEFAULT FALSE;

-- Make code unique once populated (after seed)
-- We'll add the constraint after seeding.

-- ─── Seed the 6 registry packs ───────────────────────────────────────────────

INSERT INTO workforce_packs (id, code, name, description, marketing_tagline, industry, icon_emoji, color_hex, tier, status, price_monthly_cents, price_annual_cents, currency, display_order, featured, is_publicly_visible, workers, created_at, updated_at)
VALUES
  (
    'pack_core', 'core', 'Core Workforce',
    'The essential AI workforce for every NeedsOps AI+ organisation. Contains the Chief of Staff and core specialist roles.',
    'Your always-on Chief of Staff, included with every plan.',
    'ndis_provider', '⬡', '#00D4FF',
    'starter', 'available',
    0, 0, 'AUD', 0, TRUE, TRUE,
    '[]', NOW(), NOW()
  ),
  (
    'pack_compliance', 'compliance', 'Compliance Workforce',
    'Specialist AI workers focused on NDIS compliance, quality, policy, incidents, and restrictive practices.',
    'Stay audit-ready. Always.',
    'ndis_provider', '✅', '#FF8C00',
    'professional', 'available',
    29900, 287040, 'AUD', 1, TRUE, TRUE,
    '[]', NOW(), NOW()
  ),
  (
    'pack_operations', 'operations', 'Operations Workforce',
    'Specialist AI workers for operational management including rosters, workflows, assets, and service delivery.',
    'Run a tighter operation without the overhead.',
    'ndis_provider', '⚙️', '#1E90FF',
    'professional', 'available',
    29900, 287040, 'AUD', 2, FALSE, TRUE,
    '[]', NOW(), NOW()
  ),
  (
    'pack_finance', 'finance', 'Finance Workforce',
    'Specialist AI workers for financial operations including invoicing, payroll, budgets, and reporting.',
    'Accurate books. Less manual work.',
    'ndis_provider', '💰', '#32CD32',
    'professional', 'available',
    29900, 287040, 'AUD', 3, FALSE, TRUE,
    '[]', NOW(), NOW()
  ),
  (
    'pack_hr', 'hr', 'HR Workforce',
    'Specialist AI workers for human resources including recruitment, performance, learning, and staff compliance.',
    'Your people-first HR partner, powered by AI.',
    'ndis_provider', '👥', '#FF69B4',
    'professional', 'available',
    29900, 287040, 'AUD', 4, FALSE, TRUE,
    '[]', NOW(), NOW()
  ),
  (
    'pack_marketing', 'marketing', 'Marketing Workforce',
    'Specialist AI workers for marketing strategy, content, campaigns, brand, and social media.',
    'Grow your reach without growing your team.',
    'ndis_provider', '📣', '#FF1493',
    'enterprise', 'coming_soon',
    39900, 383040, 'AUD', 5, FALSE, FALSE,
    '[]', NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  code                 = EXCLUDED.code,
  marketing_tagline    = EXCLUDED.marketing_tagline,
  icon_emoji           = EXCLUDED.icon_emoji,
  color_hex            = EXCLUDED.color_hex,
  price_monthly_cents  = EXCLUDED.price_monthly_cents,
  price_annual_cents   = EXCLUDED.price_annual_cents,
  currency             = EXCLUDED.currency,
  display_order        = EXCLUDED.display_order,
  featured             = EXCLUDED.featured,
  is_publicly_visible  = EXCLUDED.is_publicly_visible,
  updated_at           = NOW();

-- Add unique constraint on code (idempotent)
DO $$ BEGIN
  ALTER TABLE workforce_packs ADD CONSTRAINT workforce_packs_code_key UNIQUE (code);
EXCEPTION WHEN duplicate_table THEN null;
         WHEN duplicate_object THEN null; END $$;

-- Make code NOT NULL once populated
ALTER TABLE workforce_packs ALTER COLUMN code SET NOT NULL;

-- ─── Verify ───────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
  SELECT count(*) INTO cnt FROM workforce_packs WHERE code IS NOT NULL;
  IF cnt < 6 THEN
    RAISE EXCEPTION 'Sprint 9.6: expected >= 6 seeded packs, got %', cnt;
  END IF;
  RAISE NOTICE 'Sprint 9.6: % packs seeded OK.', cnt;
END $$;
