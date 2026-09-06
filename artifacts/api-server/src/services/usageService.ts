/**
 * Usage Service — Sprint 3
 *
 * Records usage events and maintains period summaries.
 * Provides idempotent event recording — duplicate events with the same
 * (organizationId, dimensionCode, idempotencyKey) are silently ignored.
 *
 * No real AI usage is recorded in Sprint 3. Seed data provides dev fixtures.
 */

import { randomUUID } from "crypto";
import { db, withSystemTenantContext } from "@workspace/db";
import { usageEventsTable, usagePeriodSummariesTable, tenantSubscriptionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import type { UsageDimensionCode } from "@workspace/shared";

type DbClient = typeof db;

function withUsageTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "usage_service", purpose },
    fn,
  );
}

// ─── Period helpers ───────────────────────────────────────────────────────────

async function getActivePeriod(
  client: DbClient,
  organizationId: string,
): Promise<{ start: Date; end: Date } | null> {
  const [sub] = await client
    .select()
    .from(tenantSubscriptionsTable)
    .where(eq(tenantSubscriptionsTable.organizationId, organizationId))
    .limit(1);

  if (!sub?.currentPeriodStart || !sub?.currentPeriodEnd) return null;
  return { start: sub.currentPeriodStart, end: sub.currentPeriodEnd };
}

// ─── recordUsageEvent ─────────────────────────────────────────────────────────

export interface RecordUsageOptions {
  organizationId: string;
  dimensionCode: UsageDimensionCode;
  quantity?: number;
  idempotencyKey: string;
  taskId?: string;
  specialistCode?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordUsageResult {
  recorded: boolean;
  /** true if this was a duplicate (idempotency key already seen) */
  duplicate: boolean;
  eventId: string | null;
}

export async function recordUsageEvent(opts: RecordUsageOptions): Promise<RecordUsageResult> {
  const {
    organizationId,
    dimensionCode,
    quantity = 1,
    idempotencyKey,
    taskId,
    specialistCode,
    metadata = {},
  } = opts;

  try {
    const eventId = randomUUID();
    await withUsageTenant(organizationId, "usage.record_event", async (client) => client.transaction(async (tx) => {
      const period = await getActivePeriod(tx, organizationId);

      await tx.insert(usageEventsTable).values({
        id: eventId,
        organizationId,
        dimensionCode,
        quantity,
        idempotencyKey,
        taskId: taskId ?? null,
        specialistCode: specialistCode ?? null,
        metadata,
        periodStart: period?.start ?? null,
        periodEnd: period?.end ?? null,
      });

      // Update or insert the period summary
      if (period) {
        const summaryId = `${organizationId}_${dimensionCode}_${period.start.toISOString()}`;
        await tx
          .insert(usagePeriodSummariesTable)
          .values({
            id: summaryId,
            organizationId,
            dimensionCode,
            periodStart: period.start,
            periodEnd: period.end,
            totalQuantity: quantity,
            eventCount: 1,
          })
          .onConflictDoUpdate({
            target: [
              usagePeriodSummariesTable.organizationId,
              usagePeriodSummariesTable.dimensionCode,
              usagePeriodSummariesTable.periodStart,
            ],
            set: {
              totalQuantity: sql`${usagePeriodSummariesTable.totalQuantity} + ${quantity}`,
              eventCount: sql`${usagePeriodSummariesTable.eventCount} + 1`,
              lastUpdatedAt: new Date(),
            },
          });
      }
    }));

    return { recorded: true, duplicate: false, eventId };
  } catch (err: unknown) {
    // Drizzle wraps the pg constraint error in err.cause — check both
    const msgChain =
      (err instanceof Error ? err.message : "") +
      " " +
      ((err instanceof Error && (err as any).cause instanceof Error)
        ? (err as any).cause.message
        : "");
    if (msgChain.includes("usage_events_idempotency") || msgChain.includes("23505")) {
      return { recorded: false, duplicate: true, eventId: null };
    }
    throw err;
  }
}

// ─── Bulk usage recording ─────────────────────────────────────────────────────

export async function recordTaskUsage(
  organizationId: string,
  taskId: string,
  specialistCodes: string[],
): Promise<void> {
  const base = `task:${taskId}`;
  await Promise.all([
    recordUsageEvent({
      organizationId,
      dimensionCode: "ai_tasks",
      idempotencyKey: `${base}:ai_tasks`,
      taskId,
      metadata: { taskId },
    }),
    recordUsageEvent({
      organizationId,
      dimensionCode: "task_plans",
      idempotencyKey: `${base}:task_plans`,
      taskId,
      metadata: { taskId },
    }),
    ...specialistCodes.map(code =>
      recordUsageEvent({
        organizationId,
        dimensionCode: "specialist_runs",
        idempotencyKey: `${base}:specialist:${code}`,
        taskId,
        specialistCode: code,
        metadata: { taskId, specialistCode: code },
      })
    ),
  ]);
}
