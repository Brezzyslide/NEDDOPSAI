/**
 * specialist_catalogue — Task #40 (Workforce Catalogue Database Migration)
 *
 * Platform-level table storing commercial and display metadata for every
 * specialist in the workforce catalogue. This table is the source of truth
 * for all customer-facing presentation data (name, description, status,
 * pack membership, coming-soon flag, display order, etc.).
 *
 * Runtime behaviour (DNA, Employee Files, Constitution, prompt logic) remains
 * in source control — this table only controls what owners see and can edit.
 *
 * Seeded idempotently from workforceRegistry.ts on every API server startup.
 * Changes are tracked with a version counter and recorded in the platform
 * audit log.
 *
 * Not tenant-scoped — no RLS required (platform owners only).
 */

import { pgTable, text, boolean, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export interface CatalogueIconMetadata {
  icon: string;
  colour: string;
}

export interface CatalogueVersionMetadata {
  catalogueVersion: "1" | "2";
  dnaStatus: "approved" | "pending_design" | "not_applicable";
  departmentCode: string;
  registryVersion: string;
}

export const specialistCatalogueTable = pgTable("specialist_catalogue", {
  id:                 text("id").primaryKey(),

  /** Immutable code from workforceRegistry.ts — used as the join key */
  specialistCode:     text("specialist_code").notNull().unique(),

  // ── Commercial / display metadata (editable by platform owners) ──────────

  displayName:        text("display_name").notNull(),
  description:        text("description").notNull(),

  /** Mirrors executionStatus from registry; owners can override for catalogue display */
  executionStatus:    text("execution_status").notNull(),

  /** Fine-grained availability status for the catalogue browser */
  availability:       text("availability").notNull().default("available"),

  /** Department code for grouping (executive, compliance_governance, etc.) */
  category:           text("category").notNull(),

  /** JSON: { icon, colour } — from workforceRegistry */
  iconMetadata:       jsonb("icon_metadata").$type<CatalogueIconMetadata>().notNull(),

  /** Pack code this specialist is commercially assigned to */
  packMembership:     text("pack_membership").notNull(),

  /** JSON array of plan codes where this specialist is visible (null = all) */
  planVisibility:     jsonb("plan_visibility").$type<string[] | null>().default(null),

  /** If true, displayed with a "Coming Soon" badge instead of live status */
  comingSoon:         boolean("coming_soon").notNull().default(false),

  /** Display position within catalogue (lower = earlier) */
  displayOrder:       integer("display_order").notNull().default(100),

  /** Non-editable runtime metadata snapshot from registry */
  versionMetadata:    jsonb("version_metadata").$type<CatalogueVersionMetadata>().notNull(),

  // ── Lifecycle flags ──────────────────────────────────────────────────────

  isActive:           boolean("is_active").notNull().default(true),
  isArchived:         boolean("is_archived").notNull().default(false),

  // ── Version control ──────────────────────────────────────────────────────

  /** Incremented on every update for optimistic-concurrency checks */
  versionCounter:     integer("version_counter").notNull().default(1),

  /** Platform user ID (Clerk) who made the last change; null = seeded */
  changedBy:          text("changed_by"),

  createdAt:          timestamp("created_at").notNull().defaultNow(),
  updatedAt:          timestamp("updated_at").notNull().defaultNow(),
});

export type SpecialistCatalogueRow    = typeof specialistCatalogueTable.$inferSelect;
export type InsertSpecialistCatalogue = typeof specialistCatalogueTable.$inferInsert;
