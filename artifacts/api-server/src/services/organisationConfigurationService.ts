/**
 * Organisation Configuration Service — Platform Completion Sprint
 *
 * Manages tenant-scoped configuration for communication style, terminology,
 * branding, approval thresholds, and AI behaviour.
 *
 * Stored in org_configuration table (one row per organisation, upserted).
 *
 * The buildConfigurationContextString() output is injected directly into
 * AI system prompts — format is intentionally human-readable.
 */

import { randomUUID } from "crypto";
import { db, orgConfigurationTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Configuration Data Interface ────────────────────────────────────────────

export interface OrgConfigurationData {
  writingStyle: "professional" | "formal" | "conversational" | "plain";
  tone: "professional" | "friendly" | "formal" | "neutral";
  usePlainEnglish: boolean;
  useAustralianEnglish: boolean;
  communicationFormality: "formal" | "professional" | "semi_formal" | "informal";
  participantTerminology: string;
  workerTerminology: string;
  organisationTypeLabel: string;
  customTerminology: Record<string, string>;
  dateFormat: string;
  documentNamingConvention: string;
  reportHeader?: string;
  reportFooter?: string;
  brandPrimaryColour?: string;
  businessHoursStart: string;
  businessHoursEnd: string;
  notificationPreference: "in_app" | "email" | "both" | "none";
  preferredCommunicationChannel: "in_app" | "email";
  approvalThresholdLow: number;
  approvalThresholdHigh: number;
  escalationContactRole?: string;
  reportSchedule: "daily" | "weekly" | "monthly" | "never";
  isConfigured: boolean;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

/**
 * Returns sensible defaults for an Australian NDIS provider.
 */
export function getDefaultConfiguration(): OrgConfigurationData {
  return {
    writingStyle: "professional",
    tone: "professional",
    usePlainEnglish: true,
    useAustralianEnglish: true,
    communicationFormality: "professional",
    participantTerminology: "Participant",
    workerTerminology: "Support Worker",
    organisationTypeLabel: "NDIS Provider",
    customTerminology: {},
    dateFormat: "DD/MM/YYYY",
    documentNamingConvention: "{type}_{participant}_{date}",
    reportHeader: undefined,
    reportFooter: undefined,
    brandPrimaryColour: undefined,
    businessHoursStart: "09:00",
    businessHoursEnd: "17:00",
    notificationPreference: "both",
    preferredCommunicationChannel: "email",
    approvalThresholdLow: 50000,   // $500 in cents
    approvalThresholdHigh: 500000, // $5,000 in cents
    escalationContactRole: undefined,
    reportSchedule: "weekly",
    isConfigured: false,
  };
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapRow(r: typeof orgConfigurationTable.$inferSelect): OrgConfigurationData {
  return {
    writingStyle: (r.writingStyle as OrgConfigurationData["writingStyle"]) ?? "professional",
    tone: (r.tone as OrgConfigurationData["tone"]) ?? "professional",
    usePlainEnglish: r.usePlainEnglish ?? true,
    useAustralianEnglish: r.useAustralianEnglish ?? true,
    communicationFormality:
      (r.communicationFormality as OrgConfigurationData["communicationFormality"]) ?? "professional",
    participantTerminology: r.participantTerminology ?? "Participant",
    workerTerminology: r.workerTerminology ?? "Support Worker",
    organisationTypeLabel: r.organisationTypeLabel ?? "NDIS Provider",
    customTerminology: (r.customTerminology as Record<string, string>) ?? {},
    dateFormat: r.dateFormat ?? "DD/MM/YYYY",
    documentNamingConvention: r.documentNamingConvention ?? "{type}_{participant}_{date}",
    reportHeader: r.reportHeader ?? undefined,
    reportFooter: r.reportFooter ?? undefined,
    brandPrimaryColour: r.brandPrimaryColour ?? undefined,
    businessHoursStart: r.businessHoursStart ?? "09:00",
    businessHoursEnd: r.businessHoursEnd ?? "17:00",
    notificationPreference:
      (r.notificationPreference as OrgConfigurationData["notificationPreference"]) ?? "both",
    preferredCommunicationChannel:
      (r.preferredCommunicationChannel as OrgConfigurationData["preferredCommunicationChannel"]) ??
      "email",
    approvalThresholdLow: r.approvalThresholdLow ?? 50000,
    approvalThresholdHigh: r.approvalThresholdHigh ?? 500000,
    escalationContactRole: r.escalationContactRole ?? undefined,
    reportSchedule: (r.reportSchedule as OrgConfigurationData["reportSchedule"]) ?? "weekly",
    isConfigured: r.isConfigured ?? false,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve the configuration for an organisation.
 * Returns null if no configuration row exists yet.
 */
export async function getConfiguration(
  organizationId: string,
): Promise<OrgConfigurationData | null> {
  const [row] = await db
    .select()
    .from(orgConfigurationTable)
    .where(eq(orgConfigurationTable.organizationId, organizationId))
    .limit(1);
  return row ? mapRow(row) : null;
}

/**
 * Upsert configuration for an organisation.
 * Merges with existing values — only provided fields are updated.
 * Creates a new row with defaults if none exists.
 */
export async function upsertConfiguration(
  organizationId: string,
  data: Partial<OrgConfigurationData>,
): Promise<OrgConfigurationData> {
  const existing = await getConfiguration(organizationId);
  const base: OrgConfigurationData = existing ?? getDefaultConfiguration();

  const merged: OrgConfigurationData = {
    ...base,
    ...data,
    customTerminology: {
      ...base.customTerminology,
      ...(data.customTerminology ?? {}),
    },
  };

  if (existing) {
    // Update
    const [updated] = await db
      .update(orgConfigurationTable)
      .set({
        writingStyle: merged.writingStyle,
        tone: merged.tone,
        usePlainEnglish: merged.usePlainEnglish,
        useAustralianEnglish: merged.useAustralianEnglish,
        communicationFormality: merged.communicationFormality,
        participantTerminology: merged.participantTerminology,
        workerTerminology: merged.workerTerminology,
        organisationTypeLabel: merged.organisationTypeLabel,
        customTerminology: merged.customTerminology,
        dateFormat: merged.dateFormat,
        documentNamingConvention: merged.documentNamingConvention,
        reportHeader: merged.reportHeader ?? null,
        reportFooter: merged.reportFooter ?? null,
        brandPrimaryColour: merged.brandPrimaryColour ?? null,
        businessHoursStart: merged.businessHoursStart,
        businessHoursEnd: merged.businessHoursEnd,
        notificationPreference: merged.notificationPreference,
        preferredCommunicationChannel: merged.preferredCommunicationChannel,
        approvalThresholdLow: merged.approvalThresholdLow,
        approvalThresholdHigh: merged.approvalThresholdHigh,
        escalationContactRole: merged.escalationContactRole ?? null,
        reportSchedule: merged.reportSchedule,
        isConfigured: merged.isConfigured,
        updatedAt: new Date(),
      })
      .where(eq(orgConfigurationTable.organizationId, organizationId))
      .returning();
    return mapRow(updated!);
  } else {
    // Insert
    const [inserted] = await db
      .insert(orgConfigurationTable)
      .values({
        id: randomUUID(),
        organizationId,
        writingStyle: merged.writingStyle,
        tone: merged.tone,
        usePlainEnglish: merged.usePlainEnglish,
        useAustralianEnglish: merged.useAustralianEnglish,
        communicationFormality: merged.communicationFormality,
        participantTerminology: merged.participantTerminology,
        workerTerminology: merged.workerTerminology,
        organisationTypeLabel: merged.organisationTypeLabel,
        customTerminology: merged.customTerminology,
        dateFormat: merged.dateFormat,
        documentNamingConvention: merged.documentNamingConvention,
        reportHeader: merged.reportHeader ?? null,
        reportFooter: merged.reportFooter ?? null,
        brandPrimaryColour: merged.brandPrimaryColour ?? null,
        businessHoursStart: merged.businessHoursStart,
        businessHoursEnd: merged.businessHoursEnd,
        notificationPreference: merged.notificationPreference,
        preferredCommunicationChannel: merged.preferredCommunicationChannel,
        approvalThresholdLow: merged.approvalThresholdLow,
        approvalThresholdHigh: merged.approvalThresholdHigh,
        escalationContactRole: merged.escalationContactRole ?? null,
        reportSchedule: merged.reportSchedule,
        isConfigured: merged.isConfigured,
      })
      .returning();
    return mapRow(inserted!);
  }
}

/**
 * Build a human-readable configuration context string for injection into AI prompts.
 *
 * This output is injected directly into system prompts for the Chief of Staff
 * and specialist AI Employees. Keep it concise but complete.
 */
export function buildConfigurationContextString(config: OrgConfigurationData): string {
  const lines: string[] = [
    "ORGANISATION CONFIGURATION",
    "──────────────────────────",
  ];

  // Communication style
  lines.push(
    `Communication style: ${capitalise(config.writingStyle)}, ${capitalise(config.tone)} tone`,
  );
  if (config.usePlainEnglish) {
    lines.push("Plain English: Enabled — use clear, accessible language");
  }
  if (config.useAustralianEnglish) {
    lines.push("Language: Australian English (use -ise, -our, AU date formats)");
  }
  lines.push(`Formality level: ${capitalise(config.communicationFormality)}`);

  // Terminology
  lines.push("");
  lines.push("Terminology:");
  lines.push(
    `  Use "${config.participantTerminology}" (not "client" or "customer" or "service user")`,
  );
  lines.push(`  Use "${config.workerTerminology}" (not "care worker" or "carer")`);
  lines.push(`  Organisation type: ${config.organisationTypeLabel}`);

  const customEntries = Object.entries(config.customTerminology);
  if (customEntries.length > 0) {
    lines.push("  Custom terminology:");
    for (const [term, replacement] of customEntries) {
      lines.push(`    Use "${replacement}" instead of "${term}"`);
    }
  }

  // Formatting
  lines.push("");
  lines.push(`Date format: ${config.dateFormat}`);
  lines.push(`Document naming: ${config.documentNamingConvention}`);

  // Business hours
  lines.push("");
  lines.push(
    `Business hours: ${config.businessHoursStart} – ${config.businessHoursEnd} (AEST)`,
  );

  // Approval thresholds
  lines.push("");
  lines.push("Approval thresholds:");
  lines.push(
    `  Tasks under ${centsToDollars(config.approvalThresholdLow)} do not require approval`,
  );
  lines.push(
    `  Tasks between ${centsToDollars(config.approvalThresholdLow)} and ${centsToDollars(config.approvalThresholdHigh)} require manager approval`,
  );
  lines.push(
    `  Tasks over ${centsToDollars(config.approvalThresholdHigh)} require executive approval`,
  );
  if (config.escalationContactRole) {
    lines.push(`  Escalation contact: ${config.escalationContactRole}`);
  }

  // Notifications
  lines.push("");
  lines.push(`Notifications: ${capitalise(config.notificationPreference)}`);
  lines.push(`Preferred channel: ${capitalise(config.preferredCommunicationChannel)}`);
  lines.push(`Report schedule: ${capitalise(config.reportSchedule)}`);

  // Branding hints (non-sensitive)
  if (config.reportHeader) {
    lines.push("");
    lines.push(`Report header: ${config.reportHeader}`);
  }
  if (config.reportFooter) {
    lines.push(`Report footer: ${config.reportFooter}`);
  }

  return lines.join("\n");
}
