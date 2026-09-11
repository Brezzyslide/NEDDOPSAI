import { db, knowledgeCurationJobsTable, withSystemTenantContext, pool } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { processCurationJob } from "../services/knowledgeCurationService.js";

const organizationId = process.env.CURATION_ORG_ID?.trim();
const maxJobs = Math.max(1, Number.parseInt(process.env.CURATION_MAX_JOBS ?? "1", 10) || 1);

if (!organizationId) {
  throw new Error("CURATION_ORG_ID is required");
}

const pendingJobs = await withSystemTenantContext(
  { tenantId: organizationId, serviceIdentity: "curation_backlog_runner", purpose: "knowledge_curation.backlog_claim" },
  (client) => client
    .select({
      id: knowledgeCurationJobsTable.id,
      organizationId: knowledgeCurationJobsTable.organizationId,
      knowledgeSourceId: knowledgeCurationJobsTable.knowledgeSourceId,
      sourceVersionId: knowledgeCurationJobsTable.sourceVersionId,
      previousVersionId: knowledgeCurationJobsTable.previousVersionId,
      triggerEvent: knowledgeCurationJobsTable.triggerEvent,
      status: knowledgeCurationJobsTable.status,
    })
    .from(knowledgeCurationJobsTable)
    .where(and(
      eq(knowledgeCurationJobsTable.organizationId, organizationId),
      eq(knowledgeCurationJobsTable.status, "pending"),
    ))
    .orderBy(asc(knowledgeCurationJobsTable.createdAt), asc(knowledgeCurationJobsTable.id))
    .limit(maxJobs),
);

const results: Array<Record<string, unknown>> = [];

try {
  for (const job of pendingJobs) {
    const startedAt = Date.now();
    try {
      const result = await processCurationJob(job.id, {
        organizationId: job.organizationId,
        knowledgeSourceId: job.knowledgeSourceId,
        sourceVersionId: job.sourceVersionId ?? "",
        previousVersionId: job.previousVersionId ?? undefined,
        triggerEvent: job.triggerEvent as any,
        actorUserId: "system",
      });
      results.push({
        jobId: job.id,
        knowledgeSourceId: job.knowledgeSourceId,
        status: "completed",
        durationMs: Date.now() - startedAt,
        proposalsGenerated: result.proposalsGenerated,
        proposalIds: result.proposalIds,
      });
    } catch (error) {
      results.push({
        jobId: job.id,
        knowledgeSourceId: job.knowledgeSourceId,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
      break;
    }
  }

  console.log(JSON.stringify({
    organizationId,
    requestedMaxJobs: maxJobs,
    claimedJobs: pendingJobs.length,
    results,
  }, null, 2));
} finally {
  await pool.end();
}
