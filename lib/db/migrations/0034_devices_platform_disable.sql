-- Migration: Task #34 — Connector & Device Fleet Management
-- Adds platform-managed temporary-disable columns to the devices table.
-- Revoke is permanent; disable/enable is reversible by platform owners.

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS is_platform_disabled     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_disabled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_disabled_by     TEXT,
  ADD COLUMN IF NOT EXISTS platform_disabled_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_org_status
  ON devices(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_devices_heartbeat
  ON devices(last_heartbeat_at);
