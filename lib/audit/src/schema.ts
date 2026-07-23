/**
 * @workspace/audit — Drizzle ORM table definition (Sprint 1+)
 *
 * Sprint 0: type-only stub. The drizzle table definition is added in Sprint 1
 * when @types/node and drizzle-orm are properly linked for this package.
 *
 * Sprint 1 implementation:
 * ```typescript
 * import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
 *
 * export const auditLogTable = pgTable("audit_log", {
 *   id: text("id").primaryKey(),
 *   organizationId: text("organization_id").notNull(),
 *   actor: jsonb("actor").notNull(),
 *   action: text("action").notNull(),
 *   resourceType: text("resource_type").notNull(),
 *   resourceId: text("resource_id"),
 *   diff: jsonb("diff"),
 *   metadata: jsonb("metadata").notNull().default({}),
 *   occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
 * });
 *
 * export type AuditLogRow = typeof auditLogTable.$inferSelect;
 * export type InsertAuditLog = typeof auditLogTable.$inferInsert;
 * ```
 *
 * Sprint 1 steps:
 * 1. Uncomment the code above
 * 2. Import auditLogTable in lib/db/src/schema/index.ts
 * 3. Run `pnpm --filter @workspace/db run push` to create the table
 */

// Sprint 0 placeholder types — replaced by Drizzle inferreds in Sprint 1
export interface AuditLogRow {
  id: string;
  organizationId: string;
  actor: unknown;
  action: string;
  resourceType: string;
  resourceId: string | null;
  diff: unknown;
  metadata: unknown;
  occurredAt: Date;
}

export type InsertAuditLog = Omit<AuditLogRow, "occurredAt"> & {
  occurredAt?: Date;
};
