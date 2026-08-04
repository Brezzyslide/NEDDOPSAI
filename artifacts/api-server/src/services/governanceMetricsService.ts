/**
 * Governance Metrics Service — Sprint 29
 *
 * Computes organisation-level governance health metrics derived entirely
 * from existing tables. No new DB tables required.
 */

import { db } from "@workspace/db";
import {
  approvalsTable,
  organisationMemoryTable,
  orgAuditLogTable,
  completedWorkTable,
  workBlueprintsTable,
} from "@workspace/db";
import { eq, and, desc, gte, sql } from "drizzle-orm";

export interface GovernanceMetrics {
  // Approval health
  pendingApprovals:       number;
  approvedLast30Days:     number;
  rejectedLast30Days:     number;
  avgApprovalHours:       number | null;  // null when insufficient data
  approvalsAgedOver48h:   number;         // pending approvals > 48 hours old
  approvalAgingBuckets: {
    under24h:  number;
    h24to48:   number;
    over48h:   number;
  };

  // Memory health
  approvedMemoryCount:    number;
  pendingMemoryCount:     number;
  supersededMemoryCount:  number;
  memoryHealthScore:      number; // 0-100

  // Work & execution
  completedWorkPending:   number;
  completedWorkApproved:  number;
  executionSuccessRate:   number | null; // 0-100, null when no data

  // Blueprint coverage
  publishedBlueprintCount: number;
  draftBlueprintCount:     number;
  blueprintCoverage:       number; // 0-100 (published / (published + draft))

  // Composite governance score (0-100)
  governanceScore:        number;

  // Audit activity (last 30 days)
  governanceEventsLast30Days: number;
  topGovernanceActors: { actorUserId: string | null; count: number }[];
}

// ─── Main compute ─────────────────────────────────────────────────────────────

export async function computeGovernanceMetrics(
  organizationId: string,
): Promise<GovernanceMetrics> {
  const now     = new Date();
  const ago30d  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ago48h  = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const ago24h  = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // ── Approvals ───────────────────────────────────────────────────────────────
  const allApprovals = await db
    .select()
    .from(approvalsTable)
    .where(eq(approvalsTable.organizationId, organizationId))
    .orderBy(desc(approvalsTable.requestedAt))
    .limit(500);

  const pendingApprovals = allApprovals.filter(a => a.state === "pending");
  const recent = allApprovals.filter(a => a.requestedAt && a.requestedAt >= ago30d);
  const approvedLast30Days  = recent.filter(a => a.state === "approved").length;
  const rejectedLast30Days  = recent.filter(a => a.state === "rejected").length;

  // Average approval time (hours) for resolved approvals in last 30 days
  const resolved = recent.filter(a => a.state !== "pending" && a.resolvedAt && a.requestedAt);
  const avgApprovalHours = resolved.length > 0
    ? Math.round(resolved.reduce((sum, a) => {
        const ms = (a.resolvedAt!.getTime() - a.requestedAt!.getTime());
        return sum + ms / (1000 * 60 * 60);
      }, 0) / resolved.length * 10) / 10
    : null;

  const approvalsAgedOver48h = pendingApprovals.filter(a =>
    a.requestedAt && a.requestedAt < ago48h,
  ).length;

  const approvalAgingBuckets = {
    under24h: pendingApprovals.filter(a => a.requestedAt && a.requestedAt >= ago24h).length,
    h24to48:  pendingApprovals.filter(a => a.requestedAt && a.requestedAt < ago24h && a.requestedAt >= ago48h).length,
    over48h:  approvalsAgedOver48h,
  };

  // ── Memory ──────────────────────────────────────────────────────────────────
  const memoryRows = await db
    .select({ status: organisationMemoryTable.status })
    .from(organisationMemoryTable)
    .where(eq(organisationMemoryTable.organizationId, organizationId));

  const approvedMemoryCount   = memoryRows.filter(m => m.status === "approved").length;
  const pendingMemoryCount    = memoryRows.filter(m => m.status === "proposed").length;
  const supersededMemoryCount = memoryRows.filter(m => m.status === "superseded").length;
  const totalMemory           = memoryRows.length;

  // Memory health: high approved ratio = good; many pending = bad
  const memoryHealthScore = totalMemory === 0 ? 100
    : Math.round(
        (approvedMemoryCount / totalMemory) * 70 +
        (pendingMemoryCount === 0 ? 30 : Math.max(0, 30 - pendingMemoryCount * 3)),
      );

  // ── Completed work ──────────────────────────────────────────────────────────
  let completedWorkPending  = 0;
  let completedWorkApproved = 0;
  let executionSuccessRate: number | null = null;

  try {
    const cwRows = await db
      .select({ status: completedWorkTable.status })
      .from(completedWorkTable)
      .where(eq(completedWorkTable.organizationId, organizationId))
      .limit(200);

    completedWorkPending  = cwRows.filter(w => w.status === "awaiting_approval").length;
    completedWorkApproved = cwRows.filter(w => w.status === "approved").length;
    const totalTerminal   = completedWorkApproved + cwRows.filter(w => w.status === "rejected").length;
    executionSuccessRate  = totalTerminal > 0
      ? Math.round((completedWorkApproved / totalTerminal) * 100)
      : null;
  } catch { /* table may not be accessible */ }

  // ── Blueprints ───────────────────────────────────────────────────────────────
  let publishedBlueprintCount = 0;
  let draftBlueprintCount = 0;
  let blueprintCoverage = 100;

  try {
    const bpRows = await db
      .select({ status: workBlueprintsTable.status, isBuiltIn: workBlueprintsTable.isBuiltIn })
      .from(workBlueprintsTable)
      .where(
        and(
          eq(workBlueprintsTable.organizationId, organizationId),
          eq(workBlueprintsTable.isActive, true),
        ),
      );

    publishedBlueprintCount = bpRows.filter(b => b.status === "published").length;
    draftBlueprintCount     = bpRows.filter(b => b.status === "draft" || b.status === "review").length;
    const total = publishedBlueprintCount + draftBlueprintCount;
    blueprintCoverage       = total === 0 ? 100 : Math.round((publishedBlueprintCount / total) * 100);
  } catch { /* non-critical */ }

  // ── Audit activity ───────────────────────────────────────────────────────────
  let governanceEventsLast30Days = 0;
  let topGovernanceActors: { actorUserId: string | null; count: number }[] = [];

  try {
    const auditRows = await db
      .select({ actorUserId: orgAuditLogTable.actorUserId })
      .from(orgAuditLogTable)
      .where(
        and(
          eq(orgAuditLogTable.organizationId, organizationId),
          gte(orgAuditLogTable.occurredAt, ago30d),
        ),
      )
      .limit(500);

    governanceEventsLast30Days = auditRows.length;

    // Top actors
    const actorCounts: Record<string, number> = {};
    for (const row of auditRows) {
      const key = row.actorUserId ?? "__system__";
      actorCounts[key] = (actorCounts[key] ?? 0) + 1;
    }
    topGovernanceActors = Object.entries(actorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([actorUserId, count]) => ({
        actorUserId: actorUserId === "__system__" ? null : actorUserId,
        count,
      }));
  } catch { /* non-critical */ }

  // ── Composite governance score (0-100) ───────────────────────────────────────
  // Weighted: approval freshness (25%) + memory health (20%) + work approval (20%)
  //           + blueprint coverage (15%) + no aged approvals (20%)
  const approvalFreshness    = approvedLast30Days > 0 || pendingApprovals.length === 0 ? 100
    : Math.max(0, 100 - pendingApprovals.length * 5);
  const agedApprovalPenalty  = Math.max(0, 100 - approvalsAgedOver48h * 20);
  const workApprovalScore    = executionSuccessRate ?? 80;

  const governanceScore = Math.min(100, Math.round(
    approvalFreshness   * 0.25 +
    memoryHealthScore   * 0.20 +
    workApprovalScore   * 0.20 +
    blueprintCoverage   * 0.15 +
    agedApprovalPenalty * 0.20,
  ));

  return {
    pendingApprovals:       pendingApprovals.length,
    approvedLast30Days,
    rejectedLast30Days,
    avgApprovalHours,
    approvalsAgedOver48h,
    approvalAgingBuckets,
    approvedMemoryCount,
    pendingMemoryCount,
    supersededMemoryCount,
    memoryHealthScore,
    completedWorkPending,
    completedWorkApproved,
    executionSuccessRate,
    publishedBlueprintCount,
    draftBlueprintCount,
    blueprintCoverage,
    governanceScore,
    governanceEventsLast30Days,
    topGovernanceActors,
  };
}
