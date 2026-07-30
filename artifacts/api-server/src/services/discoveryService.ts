/**
 * discoveryService — Sprint 14 (Business Discovery)
 *
 * Manages Business Discovery answer storage and Company Profile assembly.
 * Answers are saved per screen; the profile is denormalised for agent consumption.
 */

import { randomUUID } from "crypto";
import {
  db,
  orgDiscoveryAnswersTable,
  orgDiscoveryStatusTable,
  agentConfigurationsTable,
  organizationsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DiscoveryAnswer {
  questionKey: string;
  answerValue: unknown;
  skipped?: boolean;
  skipReason?: string;
}

export interface SaveScreenParams {
  organizationId: string;
  userId: string;
  deviceId?: string;
  screenKey: string;
  answers: DiscoveryAnswer[];
}

// ── Screen definitions ────────────────────────────────────────────────────────

export const DISCOVERY_SCREENS = [
  { key: "company_overview",    title: "Company overview" },
  { key: "work_systems",        title: "Work systems" },
  { key: "company_information", title: "Company information" },
  { key: "approvals",           title: "Approvals" },
  { key: "operations",          title: "Operations" },
  { key: "agent_goals",         title: "Agent goals" },
] as const;

export type DiscoveryScreenKey = typeof DISCOVERY_SCREENS[number]["key"];

/** Returns the completion percentage (0-100) for a given number of answered screens */
export function computeCompletionPercentage(answeredScreenCount: number): number {
  if (DISCOVERY_SCREENS.length === 0) return 100;
  return Math.min(100, Math.round((answeredScreenCount / DISCOVERY_SCREENS.length) * 100));
}

// ── Service ────────────────────────────────────────────────────────────────────

/**
 * Save or update answers for one discovery screen.
 * Upserts based on (organization_id, screen_key, question_key).
 */
export async function saveScreenAnswers(params: SaveScreenParams): Promise<void> {
  const { organizationId, userId, deviceId, screenKey, answers } = params;

  for (const answer of answers) {
    const existingRow = await db
      .select()
      .from(orgDiscoveryAnswersTable)
      .where(
        and(
          eq(orgDiscoveryAnswersTable.organizationId, organizationId),
          eq(orgDiscoveryAnswersTable.screenKey, screenKey),
          eq(orgDiscoveryAnswersTable.questionKey, answer.questionKey),
        ),
      )
      .limit(1);

    const serialised =
      answer.answerValue !== undefined && answer.answerValue !== null
        ? JSON.stringify(answer.answerValue)
        : null;

    if (existingRow.length > 0) {
      const existing = existingRow[0]!;
      await db
        .update(orgDiscoveryAnswersTable)
        .set({
          answerValue: serialised,
          answeredByUserId: userId,
          answeredAt: new Date(),
          skipped: answer.skipped ?? false,
          skipReason: answer.skipReason ?? null,
          version: (existing.version ?? 1) + 1,
          updatedAt: new Date(),
        })
        .where(eq(orgDiscoveryAnswersTable.id, existing.id));
    } else {
      await db.insert(orgDiscoveryAnswersTable).values({
        id: `oda_${randomUUID()}`,
        organizationId,
        screenKey,
        questionKey: answer.questionKey,
        answerValue: serialised,
        answerSource: "user_input",
        answeredByUserId: userId,
        answeredAt: new Date(),
        skipped: answer.skipped ?? false,
        skipReason: answer.skipReason ?? null,
      });
    }
  }

  // Update discovery status
  await updateDiscoveryProgress(organizationId, userId, deviceId, screenKey);
}

/**
 * Update org_discovery_status to reflect the latest completed screen.
 */
async function updateDiscoveryProgress(
  organizationId: string,
  userId: string,
  deviceId?: string,
  completedScreenKey?: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(orgDiscoveryStatusTable)
    .where(eq(orgDiscoveryStatusTable.organizationId, organizationId))
    .limit(1);

  const screenIndex = completedScreenKey
    ? DISCOVERY_SCREENS.findIndex(s => s.key === completedScreenKey)
    : -1;

  if (existing) {
    const completed: number[] = JSON.parse(existing.completedScreens || "[]");
    if (screenIndex >= 0 && !completed.includes(screenIndex)) {
      completed.push(screenIndex);
    }
    await db
      .update(orgDiscoveryStatusTable)
      .set({
        completedScreens: JSON.stringify(completed),
        currentScreen: Math.max(existing.currentScreen, screenIndex + 1),
        lastUpdatedAt: new Date(),
        updatedByUserId: userId,
        updatedByDeviceId: deviceId ?? null,
      })
      .where(eq(orgDiscoveryStatusTable.id, existing.id));
  } else {
    const completed = screenIndex >= 0 ? [screenIndex] : [];
    await db.insert(orgDiscoveryStatusTable).values({
      id: `ods_${randomUUID()}`,
      organizationId,
      currentScreen: Math.max(0, screenIndex + 1),
      completedScreens: JSON.stringify(completed),
      totalScreens: DISCOVERY_SCREENS.length,
      updatedByUserId: userId,
      updatedByDeviceId: deviceId ?? null,
    });
  }
}

/**
 * Get the current discovery status and all answers for an org.
 */
export async function getDiscoveryProgress(organizationId: string): Promise<{
  status: typeof orgDiscoveryStatusTable.$inferSelect | null;
  answers: Record<string, Record<string, unknown>>;
  completionPercentage: number;
}> {
  const [status] = await db
    .select()
    .from(orgDiscoveryStatusTable)
    .where(eq(orgDiscoveryStatusTable.organizationId, organizationId))
    .limit(1);

  const rawAnswers = await db
    .select()
    .from(orgDiscoveryAnswersTable)
    .where(eq(orgDiscoveryAnswersTable.organizationId, organizationId));

  // Group by screen → question
  const answers: Record<string, Record<string, unknown>> = {};
  for (const row of rawAnswers) {
    if (!answers[row.screenKey]) answers[row.screenKey] = {};
    try {
      answers[row.screenKey]![row.questionKey] = row.answerValue
        ? JSON.parse(row.answerValue)
        : null;
    } catch {
      answers[row.screenKey]![row.questionKey] = row.answerValue;
    }
  }

  const completed: number[] = status ? JSON.parse(status.completedScreens || "[]") : [];
  const completionPercentage = computeCompletionPercentage(completed.length);

  return {
    screens: DISCOVERY_SCREENS.map((s, i) => ({ ...s, completed: completed.includes(i) })),
    status: status ?? null,
    answers,
    completionPercentage,
  };
}

/**
 * Mark discovery as complete and seed agent configurations.
 */
export async function completeDiscovery(
  organizationId: string,
  userId: string,
  agentGoals?: Record<string, string>,
): Promise<void> {
  const now = new Date();

  // Update discovery status
  await db
    .update(orgDiscoveryStatusTable)
    .set({ completedAt: now, lastUpdatedAt: now, updatedByUserId: userId })
    .where(eq(orgDiscoveryStatusTable.organizationId, organizationId))
    .catch(async () => {
      // Insert if doesn't exist
      await db.insert(orgDiscoveryStatusTable).values({
        id: `ods_${randomUUID()}`,
        organizationId,
        currentScreen: DISCOVERY_SCREENS.length,
        completedScreens: JSON.stringify(DISCOVERY_SCREENS.map((_s, i) => i)),
        totalScreens: DISCOVERY_SCREENS.length,
        completedAt: now,
        updatedByUserId: userId,
      });
    });

  // Update org discovery_completed_at
  await db
    .update(organizationsTable)
    .set({ discoveryCompletedAt: now, updatedAt: now } as any)
    .where(eq(organizationsTable.id, organizationId))
    .catch(() => {});

  // Seed agent configurations for each agent with goals
  if (agentGoals) {
    for (const [specialistCode, goals] of Object.entries(agentGoals)) {
      const [existing] = await db
        .select()
        .from(agentConfigurationsTable)
        .where(
          and(
            eq(agentConfigurationsTable.organizationId, organizationId),
            eq(agentConfigurationsTable.specialistCode, specialistCode),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(agentConfigurationsTable)
          .set({ firstWeekGoals: goals, seededFromDiscovery: true, updatedAt: now })
          .where(eq(agentConfigurationsTable.id, existing.id));
      } else {
        await db.insert(agentConfigurationsTable).values({
          id: `ac_${randomUUID()}`,
          organizationId,
          specialistCode,
          firstWeekGoals: goals,
          seededFromDiscovery: true,
        });
      }
    }
  }
}
