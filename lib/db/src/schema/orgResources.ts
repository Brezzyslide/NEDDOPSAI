/**
 * org_resources — Platform Completion Sprint
 *
 * Persistent storage for the Organisation Resource Registry.
 * Replaces the in-memory Map used in Sprint XX.
 *
 * Physical locations and credentials are stored here but NEVER
 * returned to AI Employees — only ResourceDescriptors are exposed.
 */

import { pgTable, text, boolean, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgResourcesTable = pgTable("org_resources", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull(),

  /** Logical resource identifier e.g. "policies", "timesheet_system" */
  resourceId: text("resource_id").notNull(),

  /** Human-readable display name */
  displayName: text("display_name").notNull(),

  /**
   * ResourceType from @workspace/organisation-resource:
   * 'document_library' | 'document_file' | 'calendar' | 'email' | etc.
   */
  resourceType: text("resource_type").notNull(),

  /**
   * ConnectorType from @workspace/organisation-resource:
   * 'file_connector' | 'browser_connector' | 'sharepoint_file_connector' | etc.
   */
  connectorType: text("connector_type").notNull(),

  /** Human-readable source of truth label e.g. "SharePoint Online" */
  sourceOfTruth: text("source_of_truth").notNull(),

  /**
   * Internal only — NEVER sent to AI Employees.
   * URL, file path, or system reference.
   */
  physicalLocation: text("physical_location").notNull(),

  /** Role or person responsible for this resource */
  owner: text("owner").notNull(),

  /** Role codes with general access — JSONB string array */
  permittedEmployees: jsonb("permitted_employees").notNull().default(sql`'[]'::jsonb`),

  /** Role codes with read permission — JSONB string array */
  readPermissions: jsonb("read_permissions").notNull().default(sql`'[]'::jsonb`),

  /** Role codes with write permission — JSONB string array */
  writePermissions: jsonb("write_permissions").notNull().default(sql`'[]'::jsonb`),

  /**
   * SensitivityClassification:
   * 'public' | 'organisational' | 'restricted' | 'confidential' | 'highly_confidential'
   */
  sensitivityClassification: text("sensitivity_classification").notNull().default("organisational"),

  /**
   * IndexingStatus:
   * 'not_indexed' | 'pending' | 'indexed' | 'failed' | 'excluded'
   */
  indexingStatus: text("indexing_status").notNull().default("not_indexed"),

  /** ISO timestamp of last manual verification */
  lastVerified: text("last_verified").notNull().default(""),

  auditEnabled: boolean("audit_enabled").notNull().default(true),

  /** Soft delete — false = removed from registry */
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type OrgResource = typeof orgResourcesTable.$inferSelect;
export type InsertOrgResource = typeof orgResourcesTable.$inferInsert;
