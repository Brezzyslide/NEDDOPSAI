# Sprint 3 — Usage Tracking & Limits

## Overview

Usage tracking records how much of each resource an organisation consumes, enforces limits, and warns before limits are reached.

---

## Usage Dimensions (13 total)

| Code | Label | Unit |
|---|---|---|
| `ai_tasks_monthly` | AI Tasks / Month | tasks |
| `ai_specialist_calls` | Specialist Calls | calls |
| `seat_count` | Team Seats | seats |
| `workforce_pack_count` | Workforce Packs | packs |
| `specialist_access_count` | Specialist Access | specialists |
| `task_approval_count` | Task Approvals | approvals |
| `browser_sessions_monthly` | Browser Sessions / Month | sessions |
| `api_calls_monthly` | API Calls / Month | calls |
| `connector_count` | Active Connectors | connectors |
| `storage_bytes` | Storage | bytes |
| `audit_log_retention_days` | Audit Log Retention | days |
| `email_sends_monthly` | Email Sends / Month | emails |
| `webhook_calls_monthly` | Webhook Calls / Month | webhooks |

---

## Warning Thresholds

| Level | Trigger |
|---|---|
| `warn` | ≥ 80% of limit |
| `critical` | ≥ 95% of limit or at 100% |

---

## Recording Usage

```typescript
import { recordUsageEvent, recordTaskUsage } from "../services/usageService.js";

// Record a single event (idempotent via idempotencyKey)
await recordUsageEvent({
  organizationId: orgId,
  dimensionCode: "ai_tasks_monthly",
  quantity: 1,
  idempotencyKey: `task-${taskId}`,   // prevents duplicate counting
  metadata: { taskId },
});

// Shorthand for task-triggered usage (records multiple dimensions at once)
await recordTaskUsage(orgId, taskId, { aiCalls: 3, emailsSent: 1 });
```

### Idempotency

The `(org_id, dimension_code, idempotency_key)` tuple is unique-constrained. Duplicate inserts are silently ignored (`ON CONFLICT DO NOTHING`). Always pass a stable, content-derived idempotency key.

---

## Period Summaries

`usage_period_summaries` stores aggregated totals per org + dimension + calendar month. It is maintained automatically by `recordUsageEvent` via an upsert. Use it for fast limit checks instead of aggregating `usage_events` on every request.

```sql
SELECT total_quantity FROM usage_period_summaries
WHERE org_id = $1 AND dimension_code = $2
  AND period_start <= now() AND period_end > now();
```

---

## Checking Usage Before an Action

```typescript
const check = await entitlementService.checkUsage(orgId, "ai_tasks_monthly", 1);
if (!check.granted) {
  throw new Error(check.reason);
}
// proceed
```

---

## Limit Override (Platform Admin)

Platform admins can insert a row into `tenant_usage_allowances` to override a plan's default limit for a specific org and dimension. The override takes precedence over the plan version's `plan_usage_allowances`.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/organisations/:slug/usage` | All dimensions with current usage and limits |
| `POST` | `/v1/organisations/:slug/usage/check` | Check if a quantity is within limits |
| `GET` | `/v1/organisations/:slug/seats` | Seat-specific allowance |
