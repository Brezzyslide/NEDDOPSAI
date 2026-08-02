-- Sprint Knowledge Bridge (Task #14)
--
-- Phase A: Runtime Context Bridge
--
-- Closes the context gap so every supported specialist receives approved
-- organisation memory, specialist configuration, and language style at
-- execution time — not only the Chief of Staff.
--
-- Changes:
--   1. Add specialist_id column to organisation_memory for specialist-scoped entries
--   2. Create specialist_language_profiles table with RLS
--
-- REQUIRED_RLS_TABLES: 52 → 53

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add specialist_id to organisation_memory
--
-- NULL  = org-wide memory (available to any authorised specialist)
-- value = only available to the named specialist (e.g. "incident_management")
--
-- Existing rows receive NULL (org-wide) — no data loss, no behaviour change
-- for the Chief of Staff which currently reads all approved org memory.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE organisation_memory
  ADD COLUMN IF NOT EXISTS specialist_id text;

COMMENT ON COLUMN organisation_memory.specialist_id IS
  'NULL = org-wide (all authorised specialists). '
  'Set to a workforce role code to restrict to that specialist only.';

CREATE INDEX IF NOT EXISTS organisation_memory_specialist_id_idx
  ON organisation_memory (organization_id, specialist_id)
  WHERE specialist_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. specialist_language_profiles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS specialist_language_profiles (
  id                        text PRIMARY KEY,
  organization_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  specialist_id             text NOT NULL,
  locale                    text NOT NULL DEFAULT 'en',
  spelling_convention       text,
  tone                      text,
  formality                 text,
  preferred_terms           jsonb NOT NULL DEFAULT '[]',
  prohibited_terms          jsonb NOT NULL DEFAULT '[]',
  date_format               text,
  time_format               text,
  heading_preferences       text,
  sentence_length_preference text,
  output_structure          text,
  last_confirmed_at         timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS specialist_language_profiles_org_specialist_idx
  ON specialist_language_profiles (organization_id, specialist_id);

CREATE INDEX IF NOT EXISTS specialist_language_profiles_org_idx
  ON specialist_language_profiles (organization_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE specialist_language_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON specialist_language_profiles;
CREATE POLICY tenant_isolation ON specialist_language_profiles
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- needsops_app role access
DROP POLICY IF EXISTS needsops_app_access ON specialist_language_profiles;
CREATE POLICY needsops_app_access ON specialist_language_profiles
  AS PERMISSIVE FOR ALL
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

COMMIT;
