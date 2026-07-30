/**
 * NeedsOps Runtime Broker — SQLite Execution Store
 *
 * All execution state is persisted in a local SQLite database so the broker
 * survives restarts without losing in-flight job records.
 *
 * Uses better-sqlite3 (synchronous API) — appropriate for a local desktop
 * process managing a modest number of concurrent executions.
 *
 * Schema:
 *   executions        — one row per execution session
 *   execution_events  — immutable event log + webhook delivery tracking
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { StoredExecution, StoredEvent, BrokerExecutionStatus } from "./types.js";

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS executions (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  runtime_execution_id TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'queued',
  package_json         TEXT NOT NULL,
  gateway_session_id   TEXT,
  error_message        TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  started_at           TEXT,
  completed_at         TEXT,
  expires_at           TEXT NOT NULL,
  callback_url         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executions_tenant  ON executions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_executions_status  ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_expires ON executions(expires_at);

CREATE TABLE IF NOT EXISTS execution_events (
  id                       TEXT PRIMARY KEY,
  execution_id             TEXT NOT NULL,
  event_type               TEXT NOT NULL,
  payload_json             TEXT NOT NULL,
  webhook_delivered        INTEGER NOT NULL DEFAULT 0,
  webhook_attempt_count    INTEGER NOT NULL DEFAULT 0,
  webhook_last_attempt_at  TEXT,
  webhook_next_attempt_at  TEXT,
  created_at               TEXT NOT NULL,
  FOREIGN KEY(execution_id) REFERENCES executions(id)
);

CREATE INDEX IF NOT EXISTS idx_events_execution ON execution_events(execution_id);
CREATE INDEX IF NOT EXISTS idx_events_webhook   ON execution_events(webhook_delivered, webhook_next_attempt_at);
`;

// ─── Store class ──────────────────────────────────────────────────────────────

export class ExecutionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(DDL);
  }

  // ─── Execution CRUD ─────────────────────────────────────────────────────────

  insertExecution(exec: StoredExecution): void {
    this.db
      .prepare(
        `INSERT INTO executions
         (id, tenant_id, runtime_execution_id, status, package_json,
          gateway_session_id, error_message, created_at, updated_at,
          started_at, completed_at, expires_at, callback_url)
         VALUES
         (@id, @tenantId, @runtimeExecutionId, @status, @packageJson,
          @gatewaySessionId, @errorMessage, @createdAt, @updatedAt,
          @startedAt, @completedAt, @expiresAt, @callbackUrl)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run({
        id: exec.id,
        tenantId: exec.tenantId,
        runtimeExecutionId: exec.runtimeExecutionId,
        status: exec.status,
        packageJson: exec.packageJson,
        gatewaySessionId: exec.gatewaySessionId ?? null,
        errorMessage: exec.errorMessage ?? null,
        createdAt: exec.createdAt,
        updatedAt: exec.updatedAt,
        startedAt: exec.startedAt ?? null,
        completedAt: exec.completedAt ?? null,
        expiresAt: exec.expiresAt,
        callbackUrl: exec.callbackUrl,
      });
  }

  getExecution(id: string): StoredExecution | null {
    const row = this.db
      .prepare(`SELECT * FROM executions WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToExecution(row) : null;
  }

  getExecutionForTenant(id: string, tenantId: string): StoredExecution | null {
    const row = this.db
      .prepare(`SELECT * FROM executions WHERE id = ? AND tenant_id = ?`)
      .get(id, tenantId) as Record<string, unknown> | undefined;
    return row ? rowToExecution(row) : null;
  }

  updateStatus(
    id: string,
    status: BrokerExecutionStatus,
    extra?: {
      gatewaySessionId?: string;
      errorMessage?: string;
      startedAt?: string;
      completedAt?: string;
    },
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE executions SET
           status             = @status,
           updated_at         = @now,
           gateway_session_id = COALESCE(@gatewaySessionId, gateway_session_id),
           error_message      = COALESCE(@errorMessage,     error_message),
           started_at         = COALESCE(@startedAt,        started_at),
           completed_at       = COALESCE(@completedAt,      completed_at)
         WHERE id = @id`,
      )
      .run({
        id,
        status,
        now,
        gatewaySessionId: extra?.gatewaySessionId ?? null,
        errorMessage: extra?.errorMessage ?? null,
        startedAt: extra?.startedAt ?? null,
        completedAt: extra?.completedAt ?? null,
      });
  }

  /** Expire any queued/running executions whose expiresAt has passed */
  expireStaleExecutions(): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE executions SET status = 'timed_out', updated_at = ?, completed_at = ?
         WHERE status NOT IN ('completed','failed','cancelled','timed_out')
           AND expires_at <= ?`,
      )
      .run(now, now, now);
    return result.changes;
  }

  /** Return IDs of executions that were just marked timed_out (for webhook delivery) */
  getRecentlyTimedOut(since: string): StoredExecution[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM executions
         WHERE status = 'timed_out' AND updated_at >= ?
         ORDER BY updated_at DESC LIMIT 50`,
      )
      .all(since) as Record<string, unknown>[];
    return rows.map(rowToExecution);
  }

  // ─── Event log ──────────────────────────────────────────────────────────────

  insertEvent(event: {
    executionId: string;
    eventType: string;
    payloadJson: string;
    webhookNextAttemptAt: string;
  }): StoredEvent {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO execution_events
         (id, execution_id, event_type, payload_json,
          webhook_delivered, webhook_attempt_count,
          webhook_last_attempt_at, webhook_next_attempt_at, created_at)
         VALUES
         (@id, @executionId, @eventType, @payloadJson,
          0, 0, NULL, @webhookNextAttemptAt, @createdAt)`,
      )
      .run({
        id,
        executionId: event.executionId,
        eventType: event.eventType,
        payloadJson: event.payloadJson,
        webhookNextAttemptAt: event.webhookNextAttemptAt,
        createdAt: now,
      });

    return {
      id,
      executionId: event.executionId,
      eventType: event.eventType,
      payloadJson: event.payloadJson,
      webhookDelivered: 0,
      webhookAttemptCount: 0,
      webhookLastAttemptAt: null,
      webhookNextAttemptAt: event.webhookNextAttemptAt,
      createdAt: now,
    };
  }

  getEventsForExecution(executionId: string): StoredEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM execution_events WHERE execution_id = ? ORDER BY created_at ASC`,
      )
      .all(executionId) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  /** Return events pending webhook delivery whose next-attempt time has passed */
  getPendingWebhookEvents(limit = 50): StoredEvent[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM execution_events
         WHERE webhook_delivered = 0
           AND (webhook_next_attempt_at IS NULL OR webhook_next_attempt_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(now, limit) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  markEventDelivered(id: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE execution_events
         SET webhook_delivered = 1,
             webhook_last_attempt_at = ?,
             webhook_attempt_count = webhook_attempt_count + 1
         WHERE id = ?`,
      )
      .run(now, id);
  }

  markEventDeliveryAttempted(id: string, nextAttemptAt: string | null): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE execution_events
         SET webhook_last_attempt_at = ?,
             webhook_attempt_count    = webhook_attempt_count + 1,
             webhook_next_attempt_at  = ?
         WHERE id = ?`,
      )
      .run(now, nextAttemptAt, id);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToExecution(row: Record<string, unknown>): StoredExecution {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    runtimeExecutionId: row.runtime_execution_id as string,
    status: row.status as BrokerExecutionStatus,
    packageJson: row.package_json as string,
    gatewaySessionId: (row.gateway_session_id as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    expiresAt: row.expires_at as string,
    callbackUrl: row.callback_url as string,
  };
}

function rowToEvent(row: Record<string, unknown>): StoredEvent {
  return {
    id: row.id as string,
    executionId: row.execution_id as string,
    eventType: row.event_type as string,
    payloadJson: row.payload_json as string,
    webhookDelivered: row.webhook_delivered as number,
    webhookAttemptCount: row.webhook_attempt_count as number,
    webhookLastAttemptAt: (row.webhook_last_attempt_at as string | null) ?? null,
    webhookNextAttemptAt: (row.webhook_next_attempt_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}
