/**
 * Knowledge Health Service — Sprint 21 (Part 7)
 *
 * Computes the Knowledge Health Dashboard metrics for an organisation.
 * Produces an overall Knowledge Health Score (0–100).
 *
 * Metrics:
 *   - Organisation Library coverage (source count, by status)
 *   - Approved memory count
 *   - Pending proposals count
 *   - Conflicting knowledge (proposals vs approved with same type+title)
 *   - Duplicate knowledge (similar titles within same memory type)
 *   - Specialist knowledge coverage (how many have specialist-scoped memory)
 *   - Specialists requiring retraining (based on recent curation job recommendations)
 *   - Recently changed policies (superseded/version_changed in last 30 days)
 *   - Recently approved knowledge (last 30 days)
 *   - Failed curation jobs (last 7 days)
 *   - Overall Knowledge Health Score (0–100)
 */

import { withSystemTenantContext }      from "@workspace/db";
import {
  knowledgeSourcesTable,
  organisationMemoryTable,
  knowledgeCurationJobsTable,
}                                     from "@workspace/db";
import {
  eq, and, gte, desc, sql, not, inArray,
}                                     from "drizzle-orm";
import { SPECIALISTS }                from "../lib/workforceRegistry.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeHealthMetrics {
  /** Total documents in the Organisation Library (all statuses) */
  librarySourceCount:      number;
  /** Documents with status = "approved" */
  approvedSourceCount:     number;
  /** Documents currently being processed */
  processingSourceCount:   number;
  /** Documents needing human review */
  reviewRequiredCount:     number;
  /** Approved memory entries (active in AI context) */
  approvedMemoryCount:     number;
  /** Memory proposals awaiting human review */
  pendingProposals:        number;
  /** Proposal/memory pairs with potential conflict */
  conflictingKnowledge:    number;
  /** Memory entries with very similar titles in the same type */
  duplicateKnowledge:      number;
  /** Memory entries that may be outdated (not updated in 12+ months) */
  obsoleteKnowledge:       number;
  /** Proportion of active specialists that have specialist-scoped memory (0–1) */
  specialistCoverage:      number;
  /** Specialist codes with recommended retraining (from recent curation jobs) */
  specialistsNeedingRetraining: string[];
  /** Documents superseded or version_changed in the last 30 days */
  recentlyChangedPolicies: number;
  /** Memory entries approved in the last 30 days */
  recentlyApprovedKnowledge: number;
  /** Curation jobs that failed in the last 7 days */
  failedCurationJobs:      number;
  /** 0–100 composite score */
  healthScore:             number;
  computedAt:              string;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function getKnowledgeHealthMetrics(
  organizationId: string,
): Promise<KnowledgeHealthMetrics> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "knowledge_health_service", purpose: "knowledge_health.metrics" },
    async (client) => {
  const now        = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);
  const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  // ── Library source metrics ─────────────────────────────────────────────
  const sourceCounts = await client.select({
    status: knowledgeSourcesTable.status,
    count:  sql<number>`count(*)::int`,
  })
    .from(knowledgeSourcesTable)
    .where(and(
      eq(knowledgeSourcesTable.organizationId, organizationId),
      not(eq(knowledgeSourcesTable.status, "revoked")),
      sql`${knowledgeSourcesTable.deletedAt} is null`,
    ))
    .groupBy(knowledgeSourcesTable.status);

  const sourceByStatus = Object.fromEntries(sourceCounts.map(r => [r.status, r.count]));
  const librarySourceCount    = sourceCounts.reduce((s, r) => s + r.count, 0);
  const approvedSourceCount   = sourceByStatus["approved"] ?? 0;
  const processingSourceCount = sourceByStatus["processing"] ?? 0;
  const reviewRequiredCount   = sourceByStatus["review_required"] ?? 0;

  // ── Memory metrics ─────────────────────────────────────────────────────
  const memoryCounts = await client.select({
    status: organisationMemoryTable.status,
    count:  sql<number>`count(*)::int`,
  })
    .from(organisationMemoryTable)
    .where(eq(organisationMemoryTable.organizationId, organizationId))
    .groupBy(organisationMemoryTable.status);

  const memoryByStatus    = Object.fromEntries(memoryCounts.map(r => [r.status, r.count]));
  const approvedMemoryCount = memoryByStatus["approved"] ?? 0;
  const pendingProposals  = memoryByStatus["proposed"]  ?? 0;

  // ── Conflict detection: proposed with same type+similar title as approved ─
  const approvedTitles = await client.select({
    memoryType: organisationMemoryTable.memoryType,
    title:      organisationMemoryTable.title,
  })
    .from(organisationMemoryTable)
    .where(and(
      eq(organisationMemoryTable.organizationId, organizationId),
      eq(organisationMemoryTable.status, "approved"),
    ))
    .limit(200);

  const proposedItems = await client.select({
    memoryType: organisationMemoryTable.memoryType,
    title:      organisationMemoryTable.title,
  })
    .from(organisationMemoryTable)
    .where(and(
      eq(organisationMemoryTable.organizationId, organizationId),
      eq(organisationMemoryTable.status, "proposed"),
    ))
    .limit(200);

  const conflictingKnowledge = countConflicts(approvedTitles, proposedItems);
  const duplicateKnowledge   = countDuplicates(approvedTitles);

  // ── Obsolete knowledge (approved > 12 months ago, never updated) ──────
  const obsoleteRows = await client.select({ count: sql<number>`count(*)::int` })
    .from(organisationMemoryTable)
    .where(and(
      eq(organisationMemoryTable.organizationId, organizationId),
      eq(organisationMemoryTable.status, "approved"),
      sql`${organisationMemoryTable.updatedAt} < ${twelveMonthsAgo.toISOString()}`,
    ))
    .limit(1);
  const obsoleteKnowledge = obsoleteRows[0]?.count ?? 0;

  // ── Specialist coverage ────────────────────────────────────────────────
  const activeSpecialistCodes = SPECIALISTS
    .filter(s => s.dnaStatus !== "archived" && s.dnaStatus !== "dna_pending")
    .map(s => s.code);

  const specialistMemoryRows = await client.select({
    specialistId: organisationMemoryTable.specialistId,
    count:        sql<number>`count(*)::int`,
  })
    .from(organisationMemoryTable)
    .where(and(
      eq(organisationMemoryTable.organizationId, organizationId),
      eq(organisationMemoryTable.status, "approved"),
      not(eq(sql`coalesce(${organisationMemoryTable.specialistId}, '')`, "")),
    ))
    .groupBy(organisationMemoryTable.specialistId);

  const specialistsWithMemory = new Set(
    specialistMemoryRows.map(r => r.specialistId).filter(Boolean),
  );
  const specialistCoverage = activeSpecialistCodes.length > 0
    ? specialistsWithMemory.size / activeSpecialistCodes.length
    : 0;

  // ── Retraining recommendations (from recent curation job versionSummaries) ─
  const recentJobs = await client.select({
    versionSummary: knowledgeCurationJobsTable.versionSummary,
  })
    .from(knowledgeCurationJobsTable)
    .where(and(
      eq(knowledgeCurationJobsTable.organizationId, organizationId),
      eq(knowledgeCurationJobsTable.status, "completed"),
      gte(knowledgeCurationJobsTable.completedAt!, thirtyDaysAgo),
      not(sql`${knowledgeCurationJobsTable.versionSummary} is null`),
    ))
    .orderBy(desc(knowledgeCurationJobsTable.completedAt))
    .limit(20);

  const retrainingSet = new Set<string>();
  for (const job of recentJobs) {
    const vs = job.versionSummary as any;
    if (Array.isArray(vs?.retrainingRecommendations)) {
      vs.retrainingRecommendations.forEach((code: string) => retrainingSet.add(code));
    }
  }

  // ── Recently changed policies ──────────────────────────────────────────
  const recentlyChangedRows = await client.select({ count: sql<number>`count(*)::int` })
    .from(knowledgeCurationJobsTable)
    .where(and(
      eq(knowledgeCurationJobsTable.organizationId, organizationId),
      inArray(knowledgeCurationJobsTable.triggerEvent, ["superseded", "version_changed"]),
      gte(knowledgeCurationJobsTable.createdAt, thirtyDaysAgo),
    ));
  const recentlyChangedPolicies = recentlyChangedRows[0]?.count ?? 0;

  // ── Recently approved knowledge ────────────────────────────────────────
  const recentApprovedRows = await client.select({ count: sql<number>`count(*)::int` })
    .from(organisationMemoryTable)
    .where(and(
      eq(organisationMemoryTable.organizationId, organizationId),
      eq(organisationMemoryTable.status, "approved"),
      gte(organisationMemoryTable.approvedAt!, thirtyDaysAgo),
    ));
  const recentlyApprovedKnowledge = recentApprovedRows[0]?.count ?? 0;

  // ── Failed curation jobs (last 7 days) ────────────────────────────────
  const failedJobRows = await client.select({ count: sql<number>`count(*)::int` })
    .from(knowledgeCurationJobsTable)
    .where(and(
      eq(knowledgeCurationJobsTable.organizationId, organizationId),
      eq(knowledgeCurationJobsTable.status, "failed"),
      gte(knowledgeCurationJobsTable.createdAt, sevenDaysAgo),
    ));
  const failedCurationJobs = failedJobRows[0]?.count ?? 0;

  // ── Health Score ───────────────────────────────────────────────────────
  const healthScore = computeHealthScore({
    librarySourceCount,
    approvedSourceCount,
    approvedMemoryCount,
    pendingProposals,
    conflictingKnowledge,
    duplicateKnowledge,
    obsoleteKnowledge,
    specialistCoverage,
    failedCurationJobs,
  });

  return {
    librarySourceCount,
    approvedSourceCount,
    processingSourceCount,
    reviewRequiredCount,
    approvedMemoryCount,
    pendingProposals,
    conflictingKnowledge,
    duplicateKnowledge,
    obsoleteKnowledge,
    specialistCoverage,
    specialistsNeedingRetraining: Array.from(retrainingSet),
    recentlyChangedPolicies,
    recentlyApprovedKnowledge,
    failedCurationJobs,
    healthScore,
    computedAt: now.toISOString(),
  };
    },
  );
}

// ─── Health score computation ─────────────────────────────────────────────────

interface ScoreInput {
  librarySourceCount:  number;
  approvedSourceCount: number;
  approvedMemoryCount: number;
  pendingProposals:    number;
  conflictingKnowledge: number;
  duplicateKnowledge:  number;
  obsoleteKnowledge:   number;
  specialistCoverage:  number;
  failedCurationJobs:  number;
}

function computeHealthScore(s: ScoreInput): number {
  let score = 50; // baseline

  // Library coverage — up to +20 for having ≥10 approved sources
  score += Math.min(20, approvedSourceCount(s) * 2);

  // Memory — up to +15 for ≥10 approved memories
  score += Math.min(15, s.approvedMemoryCount * 1.5);

  // Specialist coverage — up to +10
  score += Math.round(s.specialistCoverage * 10);

  // Penalties
  score -= Math.min(15, s.conflictingKnowledge * 3);
  score -= Math.min(10, s.duplicateKnowledge   * 2);
  score -= Math.min(10, s.obsoleteKnowledge    * 1);
  score -= Math.min(10, s.failedCurationJobs   * 2);
  // Pending proposals are a positive signal (work in progress)
  score += Math.min(5, s.pendingProposals > 0 ? 3 : 0);

  return Math.min(100, Math.max(0, Math.round(score)));
}

function approvedSourceCount(s: ScoreInput): number {
  return s.approvedSourceCount;
}

// ─── Conflict & duplicate helpers ─────────────────────────────────────────────

function countConflicts(
  approved: Array<{ memoryType: string; title: string }>,
  proposed: Array<{ memoryType: string; title: string }>,
): number {
  let count = 0;
  for (const p of proposed) {
    for (const a of approved) {
      if (a.memoryType === p.memoryType && titleSimilarity(a.title, p.title) > 0.65) {
        count++;
        break;
      }
    }
  }
  return count;
}

function countDuplicates(
  items: Array<{ memoryType: string; title: string }>,
): number {
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.memoryType === b.memoryType && titleSimilarity(a.title, b.title) > 0.75) {
        count++;
      }
    }
  }
  return count;
}

function titleSimilarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) { if (wb.has(w)) shared++; }
  return shared / Math.max(wa.size, wb.size);
}
