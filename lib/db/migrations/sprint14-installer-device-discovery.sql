-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 14 — NeedsOps AI+ Installer, Device Management, Business Discovery
-- ─────────────────────────────────────────────────────────────────────────────
-- Run as: psql $DATABASE_URL -f lib/db/migrations/sprint14-installer-device-discovery.sql
--
-- Tables created (with RLS):
--   devices, device_credentials, device_activation_tokens, device_runtime_status
--   onboarding_sessions
--   org_company_profile, org_connected_systems
--   device_approved_resources, org_approval_rules_discovery
--   org_discovery_answers, org_discovery_status
--   agent_configurations
--
-- Tables created (platform-wide, NO RLS):
--   installer_releases, installer_download_events
--
-- Columns added to existing tables:
--   organizations: onboarding_step, installer_connected_at, discovery_completed_at
--   plans: feature_bullets, monthly_price_cents, annual_price_cents
--   tenant_subscriptions: stripe_customer_id, stripe_subscription_id, billing_cycle
--
-- IMPORTANT: run sprint5-rls.sql first if not already applied.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE device_status AS ENUM ('pending','connected','disconnected','revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Extend organizations ──────────────────────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS onboarding_step         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS installer_connected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discovery_completed_at  TIMESTAMPTZ;

-- Mark all existing orgs as having completed onboarding so they skip the new wizard
UPDATE organizations SET onboarding_step = 6 WHERE onboarding_step = 0;

-- ── Extend plans ──────────────────────────────────────────────────────────────

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS feature_bullets      TEXT,
  ADD COLUMN IF NOT EXISTS monthly_price_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS annual_price_cents   INTEGER;

-- ── Extend tenant_subscriptions ───────────────────────────────────────────────

ALTER TABLE tenant_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id      TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle           TEXT DEFAULT 'monthly';

-- ── devices ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS devices (
  id                       TEXT PRIMARY KEY,
  organization_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name             TEXT NOT NULL,
  platform                 TEXT NOT NULL,
  arch                     TEXT,
  hostname                 TEXT,
  os_version               TEXT,
  app_version              TEXT,
  broker_version           TEXT,
  public_key               TEXT,
  status                   device_status NOT NULL DEFAULT 'pending',
  tunnel_url               TEXT,
  first_run_completed_at   TIMESTAMPTZ,
  last_heartbeat_at        TIMESTAMPTZ,
  registered_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at               TIMESTAMPTZ,
  revoked_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_org_status ON devices(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_user_status ON devices(user_id, status);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON devices;
CREATE POLICY tenant_isolation ON devices
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON devices TO needsops_app;

-- ── device_credentials ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_credentials (
  id                    TEXT PRIMARY KEY,
  device_id             TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash            TEXT NOT NULL,
  webhook_secret_hash   TEXT NOT NULL,
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ,
  rotation_due_at       TIMESTAMPTZ,
  last_used_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_creds_device ON device_credentials(device_id);
CREATE INDEX IF NOT EXISTS idx_device_creds_token_hash ON device_credentials(token_hash);

ALTER TABLE device_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_credentials;
CREATE POLICY tenant_isolation ON device_credentials
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON device_credentials TO needsops_app;

-- ── device_activation_tokens ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_activation_tokens (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash             TEXT NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ,
  used_by_device_id     TEXT REFERENCES devices(id) ON DELETE SET NULL,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  revoked_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dat_org ON device_activation_tokens(organization_id);
CREATE INDEX IF NOT EXISTS idx_dat_code_hash ON device_activation_tokens(code_hash);
CREATE INDEX IF NOT EXISTS idx_dat_expires ON device_activation_tokens(expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE device_activation_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_activation_tokens;
CREATE POLICY tenant_isolation ON device_activation_tokens
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON device_activation_tokens TO needsops_app;

-- ── device_runtime_status ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_runtime_status (
  id                           TEXT PRIMARY KEY,
  device_id                    TEXT NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
  organization_id              TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  broker_version               TEXT,
  openclaw_version             TEXT,
  app_version                  TEXT,
  broker_status                TEXT,
  openclaw_status              TEXT,
  tunnel_status                TEXT,
  browser_extension_installed  BOOLEAN,
  browser_name                 TEXT,
  last_execution_id            TEXT,
  error_message                TEXT,
  reported_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE device_runtime_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_runtime_status;
CREATE POLICY tenant_isolation ON device_runtime_status
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON device_runtime_status TO needsops_app;

-- ── installer_releases (platform-wide, NO RLS) ────────────────────────────────

CREATE TABLE IF NOT EXISTS installer_releases (
  id               TEXT PRIMARY KEY,
  version          TEXT NOT NULL,
  channel          TEXT NOT NULL DEFAULT 'stable',
  platform         TEXT NOT NULL,
  arch             TEXT NOT NULL,
  download_url     TEXT NOT NULL,
  sha256           TEXT,
  file_size_bytes  INTEGER,
  min_os_version   TEXT,
  release_notes    TEXT,
  is_current       BOOLEAN NOT NULL DEFAULT FALSE,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_installer_current ON installer_releases(platform, arch, channel) WHERE is_current = TRUE;

GRANT SELECT ON installer_releases TO needsops_app;
GRANT INSERT, UPDATE ON installer_releases TO needsops_app;

-- ── installer_download_events (platform-wide, NO RLS) ────────────────────────

CREATE TABLE IF NOT EXISTS installer_download_events (
  id               TEXT PRIMARY KEY,
  release_id       TEXT REFERENCES installer_releases(id) ON DELETE SET NULL,
  organization_id  TEXT,
  user_id          TEXT,
  platform         TEXT,
  arch             TEXT,
  ip_hash          TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT ON installer_download_events TO needsops_app;

-- ── onboarding_sessions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  user_id              TEXT REFERENCES users(id) ON DELETE SET NULL,
  current_step         INTEGER NOT NULL DEFAULT 1,
  completed_steps      TEXT NOT NULL DEFAULT '[]',
  selected_pack_codes  TEXT NOT NULL DEFAULT '[]',
  selected_plan_code   TEXT,
  billing_cycle        TEXT DEFAULT 'monthly',
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON onboarding_sessions;
CREATE POLICY tenant_isolation ON onboarding_sessions
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_sessions TO needsops_app;

-- ── org_company_profile ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_company_profile (
  id                     TEXT PRIMARY KEY,
  organization_id        TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  description            TEXT,
  primary_services       TEXT NOT NULL DEFAULT '[]',
  staff_count            INTEGER,
  client_count           INTEGER,
  crm_name               TEXT,
  crm_url                TEXT,
  email_platform         TEXT,
  accounting_system      TEXT,
  hr_system              TEXT,
  project_management_system TEXT,
  knowledge_source       TEXT,
  knowledge_url          TEXT,
  business_hours         TEXT,
  locations              TEXT NOT NULL DEFAULT '[]',
  version                INTEGER NOT NULL DEFAULT 1,
  last_confirmed_at      TIMESTAMPTZ,
  confirmed_by_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE org_company_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org_company_profile;
CREATE POLICY tenant_isolation ON org_company_profile
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_company_profile TO needsops_app;

-- ── org_connected_systems ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_connected_systems (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  system_type           TEXT NOT NULL,
  system_name           TEXT NOT NULL,
  system_url            TEXT,
  access_method         TEXT,
  auto_detected         BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connected_systems_org ON org_connected_systems(organization_id);

ALTER TABLE org_connected_systems ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org_connected_systems;
CREATE POLICY tenant_isolation ON org_connected_systems
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_connected_systems TO needsops_app;

-- ── device_approved_resources ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_approved_resources (
  id                  TEXT PRIMARY KEY,
  device_id           TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  organization_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type       TEXT NOT NULL,
  encrypted_path      TEXT,
  display_name        TEXT NOT NULL,
  access_scope        TEXT NOT NULL DEFAULT 'read',
  granted_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approved_resources_device ON device_approved_resources(device_id);

ALTER TABLE device_approved_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON device_approved_resources;
CREATE POLICY tenant_isolation ON device_approved_resources
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON device_approved_resources TO needsops_app;

-- ── org_approval_rules_discovery ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_approval_rules_discovery (
  id                       TEXT PRIMARY KEY,
  organization_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_type              TEXT NOT NULL,
  approver_name            TEXT,
  approver_email           TEXT,
  approver_role            TEXT,
  threshold_amount_cents   INTEGER,
  requires_reason          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE org_approval_rules_discovery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org_approval_rules_discovery;
CREATE POLICY tenant_isolation ON org_approval_rules_discovery
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_approval_rules_discovery TO needsops_app;

-- ── org_discovery_answers ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_discovery_answers (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  screen_key            TEXT NOT NULL,
  question_key          TEXT NOT NULL,
  answer_value          TEXT,
  answer_source         TEXT NOT NULL DEFAULT 'user_input',
  answered_by_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  answered_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  skipped               BOOLEAN NOT NULL DEFAULT FALSE,
  skip_reason           TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_answers_unique ON org_discovery_answers(organization_id, screen_key, question_key);
CREATE INDEX IF NOT EXISTS idx_discovery_answers_org ON org_discovery_answers(organization_id);

ALTER TABLE org_discovery_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org_discovery_answers;
CREATE POLICY tenant_isolation ON org_discovery_answers
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_discovery_answers TO needsops_app;

-- ── org_discovery_status ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_discovery_status (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  current_screen        INTEGER NOT NULL DEFAULT 0,
  completed_screens     TEXT NOT NULL DEFAULT '[]',
  total_screens         INTEGER NOT NULL DEFAULT 6,
  completed_at          TIMESTAMPTZ,
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_device_id  TEXT REFERENCES devices(id) ON DELETE SET NULL,
  updated_by_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE org_discovery_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org_discovery_status;
CREATE POLICY tenant_isolation ON org_discovery_status
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_discovery_status TO needsops_app;

-- ── agent_configurations ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_configurations (
  id                      TEXT PRIMARY KEY,
  organization_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  specialist_code         TEXT NOT NULL,
  first_week_goals        TEXT,
  configuration_json      TEXT NOT NULL DEFAULT '{}',
  seeded_from_discovery   BOOLEAN NOT NULL DEFAULT FALSE,
  version                 INTEGER NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_config_unique ON agent_configurations(organization_id, specialist_code);

ALTER TABLE agent_configurations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_configurations;
CREATE POLICY tenant_isolation ON agent_configurations
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_configurations TO needsops_app;

-- ── Seed development installer_releases ──────────────────────────────────────
-- Development placeholder entries (download_url to be replaced with real URLs
-- after binaries are built via CI). Replace version with your actual build.

INSERT INTO installer_releases (id, version, channel, platform, arch, download_url, is_current, release_notes, published_at)
VALUES
  ('ir_dev_win_x64',   '1.0.0-dev', 'stable', 'windows', 'x64',       'https://github.com/yourorgrepo/needsops-desktop/releases/download/v1.0.0-dev/NeedsOps-AI-Plus-Setup-1.0.0-dev.exe', TRUE,  'Development build — unsigned. SmartScreen warning expected.', NOW()),
  ('ir_dev_mac_arm64', '1.0.0-dev', 'stable', 'macos',   'arm64',     'https://github.com/yourorgrepo/needsops-desktop/releases/download/v1.0.0-dev/NeedsOps-AI-Plus-1.0.0-dev-arm64.dmg', TRUE,  'Development build — not notarised. Gatekeeper step required.', NOW()),
  ('ir_dev_mac_x64',   '1.0.0-dev', 'stable', 'macos',   'x64',       'https://github.com/yourorgrepo/needsops-desktop/releases/download/v1.0.0-dev/NeedsOps-AI-Plus-1.0.0-dev-x64.dmg',   TRUE,  'Development build — Intel macOS. Not notarised.', NOW())
ON CONFLICT (id) DO NOTHING;

COMMIT;
