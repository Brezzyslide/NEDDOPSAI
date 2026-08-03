/**
 * Knowledge Hub — Specialist Language Profile Service (internal module name)
 * Customer-facing: "Language & Style" settings for each specialist.
 *
 * Manages per-organisation, per-specialist language and style preferences.
 * These settings are layered on top of the platform DNA — they can customise
 * tone, terminology, and formatting, but cannot override platform-level
 * compliance rules, prohibited behaviours, or approval requirements.
 *
 * WEB-FIRST: All operations available through the web application.
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { specialistLanguageProfilesTable, type SpecialistLanguageProfile } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UpsertLanguageProfileInput {
  organizationId: string;
  specialistId:   string;
  locale?:                    string;
  spellingConvention?:        string | null;
  tone?:                      string | null;
  formality?:                 string | null;
  preferredTerms?:            Array<{ term: string; preferred: string; notes?: string }>;
  prohibitedTerms?:           Array<{ term: string; reason?: string }>;
  dateFormat?:                string | null;
  timeFormat?:                string | null;
  headingPreferences?:        string | null;
  sentenceLengthPreference?:  string | null;
  outputStructure?:           string | null;
  confirmProfile?:            boolean;
}

// ─── Get or create ────────────────────────────────────────────────────────────

export async function getOrCreateLanguageProfile(
  organizationId: string,
  specialistId:   string,
): Promise<SpecialistLanguageProfile> {
  const [existing] = await db
    .select()
    .from(specialistLanguageProfilesTable)
    .where(
      and(
        eq(specialistLanguageProfilesTable.organizationId, organizationId),
        eq(specialistLanguageProfilesTable.specialistId,   specialistId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(specialistLanguageProfilesTable)
    .values({
      id: randomUUID(),
      organizationId,
      specialistId,
      locale:        "en-AU",
      preferredTerms:  [],
      prohibitedTerms: [],
    })
    .returning();

  return created!;
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

export async function upsertLanguageProfile(
  input: UpsertLanguageProfileInput,
): Promise<SpecialistLanguageProfile> {
  const { organizationId, specialistId, confirmProfile, ...fields } = input;

  const existing = await getOrCreateLanguageProfile(organizationId, specialistId);

  const updates: Partial<typeof specialistLanguageProfilesTable.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (fields.locale                   !== undefined) updates.locale                   = fields.locale;
  if (fields.spellingConvention       !== undefined) updates.spellingConvention       = fields.spellingConvention;
  if (fields.tone                     !== undefined) updates.tone                     = fields.tone;
  if (fields.formality                !== undefined) updates.formality                = fields.formality;
  if (fields.preferredTerms           !== undefined) updates.preferredTerms           = fields.preferredTerms as any;
  if (fields.prohibitedTerms          !== undefined) updates.prohibitedTerms          = fields.prohibitedTerms as any;
  if (fields.dateFormat               !== undefined) updates.dateFormat               = fields.dateFormat;
  if (fields.timeFormat               !== undefined) updates.timeFormat               = fields.timeFormat;
  if (fields.headingPreferences       !== undefined) updates.headingPreferences       = fields.headingPreferences;
  if (fields.sentenceLengthPreference !== undefined) updates.sentenceLengthPreference = fields.sentenceLengthPreference;
  if (fields.outputStructure          !== undefined) updates.outputStructure          = fields.outputStructure;
  if (confirmProfile)                                updates.lastConfirmedAt          = new Date();

  const [updated] = await db
    .update(specialistLanguageProfilesTable)
    .set(updates)
    .where(eq(specialistLanguageProfilesTable.id, existing.id))
    .returning();

  return updated!;
}
