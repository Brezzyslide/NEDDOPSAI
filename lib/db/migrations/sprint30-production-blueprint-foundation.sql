-- Sprint 30 — Production Blueprint Foundation + synthetic Care Plan readiness
-- Generic architecture only. No real professional Care Plan content.

-- Reconciliation guard for the earlier Replit Blueprint schema.
--
-- Replit's first Blueprint Foundation pass created blueprint_sections."order".
-- The reconciled Sprint 30 Drizzle/application schema uses sort_order. Rename
-- the historical column when it is the only ordering column, or backfill the
-- reconciled column from it when both exist. Existing section rows and ordering
-- values must survive this migration.
DO $$
BEGIN
  IF to_regclass('public.blueprint_sections') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'blueprint_sections'
        AND column_name = 'order'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'blueprint_sections'
          AND column_name = 'sort_order'
      ) THEN
        ALTER TABLE blueprint_sections RENAME COLUMN "order" TO sort_order;
      ELSE
        UPDATE blueprint_sections
        SET sort_order = "order"
        WHERE sort_order IS NULL
          AND "order" IS NOT NULL;

        -- If a previous partial migration added sort_order with only default
        -- zeroes while the historical "order" column still carries real
        -- ordering values, recover the historical ordering. If sort_order has
        -- any non-zero values, treat it as already meaningful and leave it.
        IF NOT EXISTS (
          SELECT 1 FROM blueprint_sections WHERE sort_order IS DISTINCT FROM 0
        ) AND EXISTS (
          SELECT 1 FROM blueprint_sections WHERE "order" IS DISTINCT FROM 0
        ) THEN
          UPDATE blueprint_sections
          SET sort_order = "order"
          WHERE "order" IS NOT NULL;
        END IF;
      END IF;
    END IF;
  END IF;
END $$;

ALTER TABLE work_blueprints
  ADD COLUMN IF NOT EXISTS blueprint_family TEXT,
  ADD COLUMN IF NOT EXISTS supported_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS maturity_state TEXT NOT NULL DEFAULT 'placeholder',
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'platform_owned',
  ADD COLUMN IF NOT EXISTS purpose TEXT,
  ADD COLUMN IF NOT EXISTS primary_deliverable TEXT,
  ADD COLUMN IF NOT EXISTS deliverable_contract JSONB,
  ADD COLUMN IF NOT EXISTS evidence_contract JSONB,
  ADD COLUMN IF NOT EXISTS permitted_org_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS default_template_id TEXT,
  ADD COLUMN IF NOT EXISTS template_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS allowed_org_template_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS template_version_policy TEXT NOT NULL DEFAULT 'pin_at_execution';

UPDATE work_blueprints
SET
  maturity_state = COALESCE(NULLIF(maturity_state, ''), 'placeholder'),
  owner_type = CASE WHEN organization_id IS NULL THEN 'platform_owned' ELSE 'organisation_owned' END,
  blueprint_family = COALESCE(blueprint_family, code),
  supported_modes = CASE
    WHEN supported_modes = '[]'::jsonb THEN '["create"]'::jsonb
    ELSE supported_modes
  END,
  purpose = COALESCE(purpose, objective),
  primary_deliverable = COALESCE(primary_deliverable, output_types->>0)
WHERE TRUE;

CREATE TABLE IF NOT EXISTS blueprint_sections (
  id                           TEXT PRIMARY KEY,
  blueprint_id                 TEXT NOT NULL REFERENCES work_blueprints(id) ON DELETE CASCADE,
  section_code                 TEXT NOT NULL,
  title                        TEXT NOT NULL,
  description                  TEXT,
  instructions                 TEXT,
  required                     BOOLEAN NOT NULL DEFAULT FALSE,
  minimum_content_expectation  TEXT,
  evidence_requirements        JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_source_types         JSONB NOT NULL DEFAULT '[]'::jsonb,
  prohibited_assumptions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_rules             JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality_criteria             JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order                   INTEGER NOT NULL DEFAULT 0,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- If blueprint_sections already existed from Replit's historical schema,
-- CREATE TABLE IF NOT EXISTS above is a no-op. Bring that table into the
-- reconciled Sprint 30 shape without recreating or deleting existing rows.
ALTER TABLE blueprint_sections
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS instructions TEXT,
  ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS minimum_content_expectation TEXT,
  ADD COLUMN IF NOT EXISTS evidence_requirements JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS allowed_source_types JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prohibited_assumptions JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_rules JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_criteria JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE blueprint_sections
SET
  evidence_requirements = COALESCE(evidence_requirements, '{}'::jsonb),
  allowed_source_types = COALESCE(allowed_source_types, '[]'::jsonb),
  prohibited_assumptions = COALESCE(prohibited_assumptions, '[]'::jsonb),
  validation_rules = COALESCE(validation_rules, '[]'::jsonb),
  quality_criteria = COALESCE(quality_criteria, '[]'::jsonb);

ALTER TABLE blueprint_sections
  ALTER COLUMN evidence_requirements SET DEFAULT '{}'::jsonb,
  ALTER COLUMN evidence_requirements SET NOT NULL,
  ALTER COLUMN allowed_source_types SET DEFAULT '[]'::jsonb,
  ALTER COLUMN allowed_source_types SET NOT NULL,
  ALTER COLUMN prohibited_assumptions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN prohibited_assumptions SET NOT NULL,
  ALTER COLUMN validation_rules SET DEFAULT '[]'::jsonb,
  ALTER COLUMN validation_rules SET NOT NULL,
  ALTER COLUMN quality_criteria SET DEFAULT '[]'::jsonb,
  ALTER COLUMN quality_criteria SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_blueprint_sections_blueprint_code
  ON blueprint_sections (blueprint_id, section_code);

CREATE INDEX IF NOT EXISTS idx_blueprint_sections_blueprint_order
  ON blueprint_sections (blueprint_id, sort_order);

CREATE TABLE IF NOT EXISTS work_templates (
  id                    TEXT PRIMARY KEY,
  organization_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  owner_type             TEXT NOT NULL DEFAULT 'platform_owned',
  code                   TEXT NOT NULL,
  title                  TEXT NOT NULL,
  version                TEXT NOT NULL DEFAULT '1.0.0',
  status                 TEXT NOT NULL DEFAULT 'draft',
  maturity_state         TEXT NOT NULL DEFAULT 'placeholder',
  template_type          TEXT NOT NULL,
  source_file_reference  TEXT,
  mime_type              TEXT,
  merge_field_schema     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_templates_platform_code_version
  ON work_templates (code, version)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_templates_org_code_version
  ON work_templates (organization_id, code, version)
  WHERE organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS blueprint_intent_mappings (
  id                  TEXT PRIMARY KEY,
  canonical_intent    TEXT NOT NULL,
  blueprint_family    TEXT NOT NULL,
  blueprint_mode      TEXT NOT NULL,
  blueprint_id        TEXT NOT NULL REFERENCES work_blueprints(id) ON DELETE CASCADE,
  organization_id      TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blueprint_intent_mappings_platform
  ON blueprint_intent_mappings (canonical_intent)
  WHERE organization_id IS NULL AND is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_blueprint_intent_mappings_org
  ON blueprint_intent_mappings (organization_id, canonical_intent)
  WHERE organization_id IS NOT NULL AND is_active = TRUE;

CREATE TABLE IF NOT EXISTS work_artifacts (
  id                   TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id               TEXT,
  completed_work_id     TEXT REFERENCES completed_work(id) ON DELETE SET NULL,
  workroom_id           TEXT,
  conversation_id       TEXT,
  artifact_type         TEXT NOT NULL,
  file_format           TEXT NOT NULL,
  storage_reference     TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  generation_status     TEXT NOT NULL DEFAULT 'pending',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE work_package_manifests
  ADD COLUMN IF NOT EXISTS canonical_intent TEXT,
  ADD COLUMN IF NOT EXISTS blueprint_family TEXT,
  ADD COLUMN IF NOT EXISTS blueprint_mode TEXT,
  ADD COLUMN IF NOT EXISTS template_id TEXT,
  ADD COLUMN IF NOT EXISTS template_version TEXT,
  ADD COLUMN IF NOT EXISTS contract_snapshot JSONB;

-- Reconcile Replit's historical canonical_intent_key provenance column into
-- the current canonical_intent column. Preserve any current canonical_intent
-- values and keep the historical column for audit/backward compatibility.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_package_manifests'
      AND column_name = 'canonical_intent_key'
  ) THEN
    UPDATE work_package_manifests
    SET canonical_intent = canonical_intent_key
    WHERE (canonical_intent IS NULL OR canonical_intent = '')
      AND canonical_intent_key IS NOT NULL;
  END IF;
END $$;

ALTER TABLE completed_work
  ADD COLUMN IF NOT EXISTS blueprint_version TEXT,
  ADD COLUMN IF NOT EXISTS blueprint_family TEXT,
  ADD COLUMN IF NOT EXISTS blueprint_mode TEXT,
  ADD COLUMN IF NOT EXISTS canonical_intent TEXT,
  ADD COLUMN IF NOT EXISTS artifact_state TEXT,
  ADD COLUMN IF NOT EXISTS artifact_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS artifact_id TEXT;

CREATE INDEX IF NOT EXISTS idx_work_blueprints_family_mode
  ON work_blueprints (blueprint_family);

CREATE INDEX IF NOT EXISTS idx_work_blueprints_owner_maturity
  ON work_blueprints (owner_type, maturity_state);
