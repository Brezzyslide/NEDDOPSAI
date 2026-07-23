/**
 * orgService — Sprint 1
 *
 * Organisation CRUD + onboarding flow.
 * Creating an org automatically creates:
 *   - tenant_settings row
 *   - owner membership for the creator
 */

import { randomUUID } from "crypto";
import { db, organizationsTable, tenantSettingsTable, membershipsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateUniqueSlug } from "../lib/slugify.js";
import { ConflictError } from "../lib/errors.js";

export interface CreateOrgParams {
  name: string;
  type?: string;
  industry?: string;
  country?: string;
  state?: string;
  timezone?: string;
  abn?: string;
  ndisRegistrationNumber?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
}

export async function createOrg(params: CreateOrgParams, creatorUserId: string) {
  // Generate unique slug
  const slug = await generateUniqueSlug(params.name, async (candidate) => {
    const [existing] = await db
      .select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.slug, candidate))
      .limit(1);
    return !!existing;
  });

  const orgId = randomUUID();
  const settingsId = randomUUID();
  const membershipId = randomUUID();
  const now = new Date();

  // Create org + settings + owner membership in a transaction
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizationsTable)
      .values({
        id: orgId,
        name: params.name,
        slug,
        type: params.type ?? null,
        industry: params.industry ?? null,
        country: params.country ?? "AU",
        state: params.state ?? null,
        timezone: params.timezone ?? "Australia/Sydney",
        abn: params.abn ?? null,
        ndisRegistrationNumber: params.ndisRegistrationNumber ?? null,
        primaryContactName: params.primaryContactName ?? null,
        primaryContactEmail: params.primaryContactEmail ?? null,
        status: "onboarding",
      })
      .returning();

    await tx.insert(tenantSettingsTable).values({
      id: settingsId,
      organizationId: orgId,
      timezone: params.timezone ?? "Australia/Sydney",
      industry: params.industry ?? null,
    });

    const [membership] = await tx
      .insert(membershipsTable)
      .values({
        id: membershipId,
        organizationId: orgId,
        userId: creatorUserId,
        role: "owner",
        status: "active",
        invitedBy: null,
        joinedAt: now,
      })
      .returning();

    return { org: org!, membership: membership! };
  });
}

export async function getOrgBySlug(slug: string) {
  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.slug, slug))
    .limit(1);
  return org ?? null;
}

export async function getOrgById(orgId: string) {
  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId))
    .limit(1);
  return org ?? null;
}

export interface UpdateOrgParams {
  name?: string;
  displayName?: string;
  type?: string;
  industry?: string;
  country?: string;
  state?: string;
  timezone?: string;
  employeeCount?: number;
  participantCount?: number;
  businessPhone?: string;
  website?: string;
  abn?: string;
  ndisRegistrationNumber?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  status?: "onboarding" | "active" | "suspended" | "closed";
}

export async function updateOrg(orgId: string, params: UpdateOrgParams) {
  const [updated] = await db
    .update(organizationsTable)
    .set({ ...params, updatedAt: new Date() })
    .where(eq(organizationsTable.id, orgId))
    .returning();
  return updated ?? null;
}

export async function getTenantSettings(orgId: string) {
  const [settings] = await db
    .select()
    .from(tenantSettingsTable)
    .where(eq(tenantSettingsTable.organizationId, orgId))
    .limit(1);
  return settings ?? null;
}

export async function updateTenantSettings(
  orgId: string,
  params: Partial<{
    timezone: string;
    locale: string;
    dateFormat: string;
    timeFormat: string;
    defaultCurrency: string;
    industry: string;
    dataRegion: string;
    securityNotificationEmail: string;
  }>,
) {
  const [updated] = await db
    .update(tenantSettingsTable)
    .set({ ...params, updatedAt: new Date() })
    .where(eq(tenantSettingsTable.organizationId, orgId))
    .returning();
  return updated ?? null;
}
