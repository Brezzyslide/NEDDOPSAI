-- Task #40 — Workforce Catalogue Database Migration
--
-- Creates the platform-level specialist_catalogue table.
-- Not tenant-scoped — no RLS required.
-- Seeded idempotently by the API server on startup.

CREATE TABLE IF NOT EXISTS specialist_catalogue (
  id                TEXT PRIMARY KEY,
  specialist_code   TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  description       TEXT NOT NULL,
  execution_status  TEXT NOT NULL,
  availability      TEXT NOT NULL DEFAULT 'available',
  category          TEXT NOT NULL,
  icon_metadata     JSONB NOT NULL DEFAULT '{}',
  pack_membership   TEXT NOT NULL,
  plan_visibility   JSONB,
  coming_soon       BOOLEAN NOT NULL DEFAULT FALSE,
  display_order     INTEGER NOT NULL DEFAULT 100,
  version_metadata  JSONB NOT NULL DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  is_archived       BOOLEAN NOT NULL DEFAULT FALSE,
  version_counter   INTEGER NOT NULL DEFAULT 1,
  changed_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for catalogue browser queries
CREATE INDEX IF NOT EXISTS idx_specialist_catalogue_status
  ON specialist_catalogue (execution_status, is_archived);

CREATE INDEX IF NOT EXISTS idx_specialist_catalogue_pack
  ON specialist_catalogue (pack_membership);

CREATE INDEX IF NOT EXISTS idx_specialist_catalogue_order
  ON specialist_catalogue (display_order, is_archived);
