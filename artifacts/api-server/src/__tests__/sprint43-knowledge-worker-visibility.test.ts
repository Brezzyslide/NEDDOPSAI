import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessWorkerLiveness } from "../services/workerHealthService.js";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

function readRepo(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("Sprint 43 knowledge worker deployment visibility", () => {
  it("defines a separate worker service but leaves it disabled by default", () => {
    const workerTf = readRepo("infrastructure/terraform/environments/dev/knowledge-worker.tf");
    const varsTf = readRepo("infrastructure/terraform/environments/dev/variables.tf");
    const apiTf = readRepo("infrastructure/terraform/environments/dev/api-runtime.tf");

    expect(workerTf).toContain('resource "aws_ecs_service" "knowledge_ingestion_worker"');
    expect(workerTf).toContain('desired_count   = var.knowledge_worker_desired_count');
    expect(workerTf).toContain('"./dist/workers/knowledgeIngestionWorker.mjs"');
    expect(varsTf).toContain('variable "knowledge_worker_desired_count"');
    expect(varsTf).toContain("default     = 0");
    expect(varsTf).toContain('variable "knowledge_worker_max_jobs"');
    expect(workerTf).toContain('"KNOWLEDGE_WORKER_MAX_JOBS"');
    expect(workerTf).toContain("value = tostring(var.knowledge_worker_max_jobs)");
    expect(apiTf).toContain('name  = "KNOWLEDGE_WORKER_MODE"');
    expect(apiTf).toContain('value = "external"');
  });

  it("can stop a standalone worker after a bounded number of jobs", () => {
    const worker = readRepo("artifacts/api-server/src/workers/knowledgeIngestionWorker.ts");

    expect(worker).toContain('process.env.KNOWLEDGE_WORKER_MAX_JOBS');
    expect(worker).toContain('this._processedJobs += 1');
    expect(worker).toContain('MAX_JOBS > 0 && this._processedJobs >= MAX_JOBS');
    expect(worker).toContain('"[knowledge-worker] Max job count reached; stopping"');
  });

  it("wires the worker to the same runtime secrets required by API ingestion", () => {
    const workerTf = readRepo("infrastructure/terraform/environments/dev/knowledge-worker.tf");

    expect(workerTf).toContain('execution_role_arn       = aws_iam_role.api_execution.arn');
    expect(workerTf).toContain('task_role_arn            = aws_iam_role.api_task.arn');
    expect(workerTf).toContain('"DB_USERNAME"');
    expect(workerTf).toContain('"DB_PASSWORD"');
    expect(workerTf).toContain('"OPENAI_API_KEY"');
    expect(workerTf).toContain('"KNOWLEDGE_STORAGE_PROVIDER"');
    expect(workerTf).toContain('"KNOWLEDGE_QUEUE_PROVIDER"');
  });

  it("emits the worker entrypoint in the API build", () => {
    const build = readRepo("artifacts/api-server/build.mjs");
    expect(build).toContain('src/workers/knowledgeIngestionWorker.ts');
  });

  it("fetches worker input from the configured object storage provider", () => {
    const pipeline = readRepo("artifacts/api-server/src/services/ingestionPipelineService.ts");

    expect(pipeline).toContain('provider === "local"');
    expect(pipeline).toContain("fetchFromLocalObjectStorage");
    expect(pipeline).toContain('provider === "s3"');
    expect(pipeline).toContain("fetchFromS3ObjectStorage");
    expect(pipeline).toContain("@aws-sdk/client-s3");
    expect(pipeline).toContain("fetchFromReplitObjectStorage");
  });

  it("keeps the fetching stage visible without double-transitioning worker-claimed jobs", () => {
    const pipeline = readRepo("artifacts/api-server/src/services/ingestionPipelineService.ts");

    expect(pipeline).toContain('jobStateRows[0]?.status === "queued"');
    expect(pipeline).toContain('_transition(jobId, organizationId, "fetching")');
    expect(pipeline).toContain('_transition(jobId, organizationId, "extracting")');
  });

  it("does not swallow ingestion-job audit failures during enqueue", () => {
    const jobService = readRepo("artifacts/api-server/src/services/ingestionJobService.ts");
    const databaseQueue = readRepo("artifacts/api-server/src/lib/ingestionQueue/DatabaseIngestionQueue.ts");

    expect(jobService).toContain("await logOrgEvent({");
    expect(databaseQueue).toContain("await logOrgEvent({");
    expect(jobService).not.toContain("eventType: \"ingestion_job.queued\",\n    organizationId: input.organizationId,\n    resourceType: \"ingestion_job\",\n    resourceId: id,\n    actorUserId: input.actorUserId,\n  }).catch(() => {});");
    expect(databaseQueue).not.toContain("eventType:      \"ingestion_job.queued\",\n      organizationId: input.organizationId,\n      resourceType:   \"ingestion_job\",\n      resourceId:     id,\n      actorUserId:    input.actorUserId,\n    }).catch(() => {});");
  });

  it("reports stale zero-attempt queued work as stalled", () => {
    const liveness = assessWorkerLiveness({
      running: false,
      jobsQueued: 6,
      oldestQueuedAgeSeconds: 11 * 60,
      lastClaimedAt: null,
      thresholdMinutes: 10,
    });

    expect(liveness.state).toBe("stalled");
    expect(liveness.message).toContain("no worker has claimed work");
  });

  it("surfaces stalled ingestion state in the library UI", () => {
    const library = readRepo("artifacts/needsops-web/src/pages/app/OrgLibraryPage.tsx");
    const detail = readRepo("artifacts/needsops-web/src/pages/app/SourceDetailPage.tsx");

    expect(library).toContain("Processing stalled");
    expect(library).toContain("No worker has claimed this document");
    expect(detail).toContain("Processing is stalled");
    expect(detail).toContain("STALLED_JOB_THRESHOLD_MS = 10 * 60 * 1000");
  });

  it("auto-approves completed ingestion unless substantial same-type overlap needs review", () => {
    const pipeline = readRepo("artifacts/api-server/src/services/ingestionPipelineService.ts");

    expect(pipeline).toContain("Auto-approve completed ingestion by default");
    expect(pipeline).toContain("detectAutoApprovalConflict");
    expect(pipeline).toContain("SUBSTANTIAL_OVERLAP_MIN_RATIO");
    expect(pipeline).toContain("SUBSTANTIAL_OVERLAP_MIN_CHUNKS");
    expect(pipeline).toContain("ks.source_type = ${source.sourceType}");
    expect(pipeline).toContain("COALESCE(ks.document_category, '') = COALESCE(${source.documentCategory}, '')");
    expect(pipeline).toContain("same_checksum");
    expect(pipeline).toContain("same_canonical_title");
    expect(pipeline).toContain("substantial_chunk_overlap");
    expect(pipeline).toContain("DOCUMENT CONFLICT REQUIRES REVIEW.");
    expect(pipeline).toContain("Neither document should be treated as the governing source");
    expect(pipeline).not.toContain("if (!requiresHumanReview) {");
  });

  it("exposes ingestion auto-approval conflicts through the warnings endpoint", () => {
    const route = readRepo("artifacts/api-server/src/routes/v1/ingestion.ts");

    expect(route).toContain("autoApproval: (job?.metadata as any)?.autoApproval ?? null");
    expect(route).toContain("conflictMessage: (job?.metadata as any)?.autoApproval?.message ?? null");
  });
});
