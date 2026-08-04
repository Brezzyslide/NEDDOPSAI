-- Task #36 — Server-side notification state
-- Adds: notification_reads table with RLS

-- notification_reads
CREATE TABLE IF NOT EXISTS notification_reads (
  id                TEXT        PRIMARY KEY,
  organization_id   TEXT        NOT NULL REFERENCES organizations(id),
  user_id           TEXT        NOT NULL REFERENCES users(id),
  notification_id   TEXT        NOT NULL,
  read_at           TIMESTAMPTZ,
  archived_at       TIMESTAMPTZ,
  snoozed_until     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_reads_user_notif_uidx
  ON notification_reads (organization_id, user_id, notification_id);

CREATE INDEX IF NOT EXISTS notification_reads_org_user_idx
  ON notification_reads (organization_id, user_id);

-- RLS
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_reads;
CREATE POLICY tenant_isolation ON notification_reads
  USING (organization_id = current_setting('app.current_tenant_id', TRUE));
