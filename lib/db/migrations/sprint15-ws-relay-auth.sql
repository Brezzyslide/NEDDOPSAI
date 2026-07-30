-- Sprint 15: Production WebSocket Relay & Short-lived Device Auth
-- Run with: psql $DATABASE_URL -f lib/db/migrations/sprint15-ws-relay-auth.sql

BEGIN;

-- ── 1. device_auth_challenges ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_auth_challenges (
  id                TEXT        PRIMARY KEY,
  device_id         TEXT        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  organization_id   TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nonce             TEXT        NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE device_auth_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON device_auth_challenges;
CREATE POLICY tenant_isolation ON device_auth_challenges
  USING (organization_id = current_setting('app.current_tenant', TRUE));

CREATE INDEX IF NOT EXISTS idx_device_auth_challenges_device
  ON device_auth_challenges(device_id, expires_at)
  WHERE used_at IS NULL;

-- ── 2. device_access_tokens ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_access_tokens (
  id                TEXT        PRIMARY KEY,
  device_id         TEXT        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  organization_id   TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash        TEXT        NOT NULL,
  audience          TEXT        NOT NULL DEFAULT 'device-relay',
  expires_at        TIMESTAMPTZ NOT NULL,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE device_access_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON device_access_tokens;
CREATE POLICY tenant_isolation ON device_access_tokens
  USING (organization_id = current_setting('app.current_tenant', TRUE));

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_access_tokens_hash
  ON device_access_tokens(token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_device_access_tokens_device
  ON device_access_tokens(device_id)
  WHERE revoked_at IS NULL;

-- ── 3. device_refresh_tokens ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_refresh_tokens (
  id                TEXT        PRIMARY KEY,
  device_id         TEXT        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  organization_id   TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash        TEXT        NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ,
  rotated_at        TIMESTAMPTZ,
  superseded_by_id  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE device_refresh_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON device_refresh_tokens;
CREATE POLICY tenant_isolation ON device_refresh_tokens
  USING (organization_id = current_setting('app.current_tenant', TRUE));

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_refresh_tokens_hash
  ON device_refresh_tokens(token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_device_refresh_tokens_device
  ON device_refresh_tokens(device_id)
  WHERE revoked_at IS NULL;

-- ── 4. device_ws_sessions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_ws_sessions (
  id                TEXT        PRIMARY KEY,
  device_id         TEXT        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  organization_id   TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transport_type    TEXT        NOT NULL DEFAULT 'outbound-wss',
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ,
  disconnected_at   TIMESTAMPTZ,
  disconnect_reason TEXT,
  app_version       TEXT,
  os_platform       TEXT,
  arch              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE device_ws_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON device_ws_sessions;
CREATE POLICY tenant_isolation ON device_ws_sessions
  USING (organization_id = current_setting('app.current_tenant', TRUE));

CREATE INDEX IF NOT EXISTS idx_device_ws_sessions_device
  ON device_ws_sessions(device_id, connected_at DESC);

-- ── 5. device_task_dispatch ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_task_dispatch (
  id                      TEXT        PRIMARY KEY,
  device_id               TEXT        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  organization_id         TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id                 TEXT,
  execution_id            TEXT        NOT NULL UNIQUE,
  payload_json            TEXT        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'pending',
  delivery_attempts       INTEGER     NOT NULL DEFAULT 0,
  max_delivery_attempts   INTEGER     NOT NULL DEFAULT 3,
  sent_at                 TIMESTAMPTZ,
  acknowledged_at         TIMESTAMPTZ,
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,
  result_ref              TEXT,
  error_code              TEXT,
  last_error              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE device_task_dispatch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON device_task_dispatch;
CREATE POLICY tenant_isolation ON device_task_dispatch
  USING (organization_id = current_setting('app.current_tenant', TRUE));

CREATE INDEX IF NOT EXISTS idx_device_task_dispatch_device_status
  ON device_task_dispatch(device_id, status)
  WHERE status IN ('pending', 'sent', 'acknowledged', 'running');

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_task_dispatch_execution_id
  ON device_task_dispatch(execution_id);

COMMIT;
