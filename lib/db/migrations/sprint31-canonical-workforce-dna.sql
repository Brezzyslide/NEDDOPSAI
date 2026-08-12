-- Sprint 31 — Canonical Workforce DNA Foundation
-- Adds structured canonical DNA storage/provenance fields without removing or
-- rewriting the existing reduced DNA columns.

BEGIN;

ALTER TABLE specialist_dna_profiles
  ADD COLUMN IF NOT EXISTS dna_id TEXT,
  ADD COLUMN IF NOT EXISTS version_hash TEXT,
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS visibility_tier TEXT NOT NULL DEFAULT 'platform_private',
  ADD COLUMN IF NOT EXISTS professional_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS change_reason TEXT,
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_version TEXT,
  ADD COLUMN IF NOT EXISTS supersedes TEXT,
  ADD COLUMN IF NOT EXISTS migration_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS canonical_profile JSONB,
  ADD COLUMN IF NOT EXISTS runtime_projection JSONB,
  ADD COLUMN IF NOT EXISTS immutable_published_snapshot BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE specialist_dna_profiles
SET
  dna_id = COALESCE(dna_id, specialist_id),
  owner_type = COALESCE(NULLIF(owner_type, ''), 'platform'),
  visibility_tier = COALESCE(NULLIF(visibility_tier, ''), 'platform_private'),
  approved_by = COALESCE(approved_by, published_by),
  change_reason = COALESCE(change_reason, change_description),
  effective_from = COALESCE(effective_from, published_at, created_at),
  immutable_published_snapshot = CASE
    WHEN status = 'published' THEN TRUE
    ELSE immutable_published_snapshot
  END
WHERE dna_id IS NULL
   OR owner_type IS NULL OR owner_type = ''
   OR visibility_tier IS NULL OR visibility_tier = ''
   OR approved_by IS NULL
   OR change_reason IS NULL
   OR effective_from IS NULL
   OR (status = 'published' AND immutable_published_snapshot IS NOT TRUE);

CREATE INDEX IF NOT EXISTS specialist_dna_profiles_dna_id_version_idx
  ON specialist_dna_profiles(dna_id, version);

CREATE INDEX IF NOT EXISTS specialist_dna_profiles_specialist_status_idx
  ON specialist_dna_profiles(specialist_id, status);

CREATE INDEX IF NOT EXISTS specialist_dna_profiles_owner_visibility_idx
  ON specialist_dna_profiles(owner_type, visibility_tier);

COMMIT;
