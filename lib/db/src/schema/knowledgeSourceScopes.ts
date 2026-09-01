/**
 * knowledge_source_scopes — Task #15 (Knowledge Schema, Scopes & Secure Upload)
 *
 * Relational scope assignments for Organisation Library sources.
 * A single source can be assigned to multiple scope targets simultaneously,
 * allowing flexible retrieval filtering across specialists, departments,
 * locations, and task types.
 *
 * Scope types:
 *   organisation — available to all specialists in the org (scopeId = "all")
 *   workforce    — available to the entire AI workforce (scopeId = "all")
 *   specialist   — specific workforce role code e.g. "chief_of_staff"
 *   department   — department code e.g. "finance", "operations"
 *   location     — location identifier
 *   task_type    — task category e.g. "incident", "onboarding", "compliance"
 *   entity       — participant/entity identifier. For participant documents,
 *                  scopeId must be the participants.id for the same org.
 *
 * Design notes:
 *   - Duplicate (knowledgeSourceId, scopeType, scopeId) is rejected by unique index.
 *   - Removing a scope does NOT affect the source record or other scopes.
 *   - org-wide sources use scopeType = "organisation", scopeId = "all".
 *   - Task-scoped sources (sourceScope = "task") in knowledge_sources do NOT
 *     use this table — their scope is determined by taskId on the source record.
 *
 * Tenant isolation enforced by RLS on organization_id.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { knowledgeSourcesTable } from "./knowledgeSources.js";

export const knowledgeSourceScopesTable = pgTable("knowledge_source_scopes", {
  id: text("id").primaryKey(),

  knowledgeSourceId: text("knowledge_source_id")
    .notNull()
    .references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /**
   * Type of scope target.
   * organisation | workforce | specialist | department | location | task_type | entity
   */
  scopeType: text("scope_type").notNull(),

  /**
   * Identifier within the scope type.
   * - organisation: always "all"
   * - workforce:    always "all"
   * - specialist:   workforce role code e.g. "chief_of_staff"
   * - department:   department code
   * - location:     location identifier
   * - task_type:    task type code
   * - entity:       participant/entity ID
   */
  scopeId: text("scope_id").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KnowledgeSourceScopeRecord  = typeof knowledgeSourceScopesTable.$inferSelect;
export type InsertKnowledgeSourceScope  = typeof knowledgeSourceScopesTable.$inferInsert;

export const KNOWLEDGE_SCOPE_TYPES = [
  "organisation",
  "workforce",
  "specialist",
  "department",
  "location",
  "task_type",
  "entity",
] as const;
export type KnowledgeScopeType = (typeof KNOWLEDGE_SCOPE_TYPES)[number];
