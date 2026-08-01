-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint SRM Hardening — Centralised DNA Model
--
-- Three tables:
--   1. specialist_dna_profiles      — platform-controlled, NO RLS
--   2. specialist_dna_competencies  — platform-controlled, NO RLS
--   3. organisation_specialist_configuration — per-tenant, RLS required
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. specialist_dna_profiles ───────────────────────────────────────────────
-- Platform-controlled. No RLS — the platform service account manages this.
-- Only one row should have status='published' per specialist_id at a time.

CREATE TABLE IF NOT EXISTS specialist_dna_profiles (
  id                    TEXT        PRIMARY KEY,
  specialist_id         TEXT        NOT NULL,
  version               TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'published', 'retired')),

  -- Core DNA identity fields (compiled from static registry → DB)
  mission               TEXT        NOT NULL,
  objectives            JSONB       NOT NULL DEFAULT '[]',
  responsibilities      JSONB       NOT NULL DEFAULT '[]',
  operating_principles  JSONB       NOT NULL DEFAULT '[]',
  communication_style   JSONB       NOT NULL DEFAULT '{}',
  escalation_rules      JSONB       NOT NULL DEFAULT '[]',
  prohibited_behaviours JSONB       NOT NULL DEFAULT '[]',
  memory_policy         JSONB       NOT NULL DEFAULT '{}',

  published_at          TIMESTAMPTZ,
  retired_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (specialist_id, version)
);

CREATE INDEX IF NOT EXISTS idx_specialist_dna_profiles_specialist_status
  ON specialist_dna_profiles(specialist_id, status);

-- ── 2. specialist_dna_competencies ───────────────────────────────────────────
-- Platform-controlled. No RLS. Child rows of specialist_dna_profiles.

CREATE TABLE IF NOT EXISTS specialist_dna_competencies (
  id              TEXT        PRIMARY KEY,
  dna_profile_id  TEXT        NOT NULL REFERENCES specialist_dna_profiles(id) ON DELETE CASCADE,
  competency_code TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  level           TEXT        NOT NULL,
  description     TEXT        NOT NULL,
  version         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_specialist_dna_competencies_profile
  ON specialist_dna_competencies(dna_profile_id);

-- ── 3. organisation_specialist_configuration ─────────────────────────────────
-- Per-tenant configuration layer. RLS enforced.
-- Adds org-specific goals and context — never overrides platform safety fields.

CREATE TABLE IF NOT EXISTS organisation_specialist_configuration (
  id                  TEXT        PRIMARY KEY,
  organization_id     TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  specialist_id       TEXT        NOT NULL,

  -- Org-level specialist customisation
  first_week_goals    JSONB       NOT NULL DEFAULT '[]',
  preferred_style     TEXT,
  escalation_contacts JSONB       NOT NULL DEFAULT '[]',
  additional_context  JSONB       NOT NULL DEFAULT '{}',

  -- Audit fields
  source              TEXT        NOT NULL DEFAULT 'business_discovery',
  last_confirmed_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, specialist_id)
);

-- RLS: tenants may only read/write their own configuration
ALTER TABLE organisation_specialist_configuration ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON organisation_specialist_configuration;
CREATE POLICY tenant_isolation ON organisation_specialist_configuration
  USING (organization_id = current_setting('app.current_tenant', TRUE));

CREATE INDEX IF NOT EXISTS idx_org_specialist_config_org_specialist
  ON organisation_specialist_configuration(organization_id, specialist_id);

COMMIT;
