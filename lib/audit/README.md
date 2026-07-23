# @workspace/audit

Audit log infrastructure for NeedsOps AI+.

## Sprint 0 status

Functional types and schema. `writeAuditEvent` is a console stub — Sprint 1 wires it to the DB.

## Sprint 1 plan

1. Import `auditLogTable` from this package into `lib/db/src/schema/index.ts`
2. Run `pnpm --filter @workspace/db run push` to create the `audit_log` table
3. Replace the `writeAuditEvent` stub with a real DB insert
4. Wrap every mutation in the API routes with `writeAuditEvent`

## Architecture principle

Every tenant-owned action must produce an audit record. The audit log is **append-only** — records are never updated or deleted. Retention policies are enforced by archival, not deletion.
