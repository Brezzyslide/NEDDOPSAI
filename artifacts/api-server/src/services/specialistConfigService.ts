/**
 * Knowledge Hub — Specialist Configuration Service (internal module name)
 * Customer-facing: "Responsibilities", "Allowed actions", "Escalation contacts"
 *
 * Manages per-organisation specialist configuration including:
 *   - Responsibilities and prohibited/approval-required actions
 *   - Escalation contacts and conditions
 *   - Goals and first-week priorities
 *   - Allowed systems and operational context
 *
 * PLATFORM CONTROL RULES:
 * Configuration MUST NOT override platform-level prohibited behaviours,
 * compliance rules, approval requirements, or DNA permissions.
 * It MAY customise goals, tone, escalation contacts, and org context.
 *
 * WEB-FIRST: All operations available through the web application.
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { organisationSpecialistConfigTable, type OrganisationSpecialistConfig } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResponsibilitiesConfig {
  responsibilities:      string[];
  prohibitedActions:     string[];
  approvalRequiredActions: string[];
  escalationConditions:  string[];
  escalationContacts:    Array<{ name: string; role: string }>;
  allowedSystems:        string[];
  firstWeekGoals:        string[];
}

export interface UpsertSpecialistConfigInput {
  organizationId:       string;
  specialistId:         string;
  goals?:               string[];
  preferredStyle?:      string | null;
  escalationContacts?:  Array<{ name: string; role: string }>;
  responsibilities?:    Partial<ResponsibilitiesConfig>;
  additionalContext?:   Record<string, unknown>;
  confirmConfiguration?: boolean;
}

// ─── Get or create ────────────────────────────────────────────────────────────

export async function getOrCreateSpecialistConfig(
  organizationId: string,
  specialistId:   string,
): Promise<OrganisationSpecialistConfig & { responsibilities: ResponsibilitiesConfig }> {
  const [existing] = await db
    .select()
    .from(organisationSpecialistConfigTable)
    .where(
      and(
        eq(organisationSpecialistConfigTable.organizationId, organizationId),
        eq(organisationSpecialistConfigTable.specialistId,   specialistId),
      ),
    )
    .limit(1);

  const defaultResponsibilities: ResponsibilitiesConfig = {
    responsibilities:        [],
    prohibitedActions:       [],
    approvalRequiredActions: [],
    escalationConditions:    [],
    escalationContacts:      [],
    allowedSystems:          [],
    firstWeekGoals:          [],
  };

  if (existing) {
    const ctx = (existing.additionalContext as any) ?? {};
    return {
      ...existing,
      responsibilities: {
        ...defaultResponsibilities,
        ...(ctx.responsibilities ?? {}),
        escalationContacts: (existing.escalationContacts as any[]) ?? [],
        firstWeekGoals:     (existing.goals as string[]) ?? [],
      },
    };
  }

  const [created] = await db
    .insert(organisationSpecialistConfigTable)
    .values({
      id: randomUUID(),
      organizationId,
      specialistId,
      goals:              [],
      escalationContacts: [],
      additionalContext:  {},
      source:             "manual",
    })
    .returning();

  return { ...created!, responsibilities: defaultResponsibilities };
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

export async function upsertSpecialistConfig(
  input: UpsertSpecialistConfigInput,
): Promise<OrganisationSpecialistConfig & { responsibilities: ResponsibilitiesConfig }> {
  const { organizationId, specialistId, confirmConfiguration } = input;
  const current = await getOrCreateSpecialistConfig(organizationId, specialistId);

  const updates: Partial<typeof organisationSpecialistConfigTable.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (confirmConfiguration) {
    updates.lastConfirmedAt = new Date();
  }

  if (input.goals !== undefined) {
    updates.goals = input.goals as any;
  }

  if (input.preferredStyle !== undefined) {
    updates.preferredStyle = input.preferredStyle;
  }

  if (input.escalationContacts !== undefined) {
    updates.escalationContacts = input.escalationContacts as any;
  }

  // Responsibilities stored inside additionalContext.responsibilities
  const currentCtx = (current.additionalContext as any) ?? {};
  const currentResps = currentCtx.responsibilities ?? {};

  const newResps = input.responsibilities
    ? { ...currentResps, ...input.responsibilities }
    : currentResps;

  updates.additionalContext = {
    ...currentCtx,
    ...((input.additionalContext as any) ?? {}),
    responsibilities: newResps,
  } as any;

  const [updated] = await db
    .update(organisationSpecialistConfigTable)
    .set(updates)
    .where(eq(organisationSpecialistConfigTable.id, current.id))
    .returning();

  const updatedCtx = (updated!.additionalContext as any) ?? {};
  const resps = updatedCtx.responsibilities ?? {};

  const defaultR: ResponsibilitiesConfig = {
    responsibilities:        [],
    prohibitedActions:       [],
    approvalRequiredActions: [],
    escalationConditions:    [],
    escalationContacts:      [],
    allowedSystems:          [],
    firstWeekGoals:          [],
  };

  return {
    ...updated!,
    responsibilities: {
      ...defaultR,
      ...resps,
      escalationContacts: (updated!.escalationContacts as any[]) ?? [],
      firstWeekGoals:     (updated!.goals as string[]) ?? [],
    },
  };
}
