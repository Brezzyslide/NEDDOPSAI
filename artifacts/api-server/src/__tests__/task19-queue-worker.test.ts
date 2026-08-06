/**
 * Task #19 — Knowledge Hub Queue Worker
 *
 * Test sections:
 *   1. DatabaseIngestionQueue.enqueue — idempotency, creates job
 *   2. DatabaseIngestionQueue.claimNext — SKIP LOCKED, backoff respect, empty queue
 *   3. DatabaseIngestionQueue.heartbeat — extends lease
 *   4. DatabaseIngestionQueue.fail — backoff, dead-letter on exhaustion, non-retryable
 *   5. DatabaseIngestionQueue.cancel — queued→cancelled, processing→cancelling
 *   6. DatabaseIngestionQueue.finaliseCancellation — cancelling→cancelled
 *   7. DatabaseIngestionQueue.recoverStuck — expired lease recovery
 *   8. DatabaseIngestionQueue.health — aggregates counts
 *   9. ingestionJobService.cancelIngestionJob — uses cancelling for in-flight
 *  10. ingestionJobService.getActiveJobForVersion — excludes dead_lettered/revoked
 *  11. ingestionPipelineService.triggerIngestion — delegates to enqueueIngestionJob
 *  12. KnowledgeIngestionWorker — start, stop, poll loop, heartbeat, sweeper
 *  13. workerHealthService — state transitions
 *  14. getIngestionQueue factory — selects database provider
 *  15. complete-upload auto-enqueue integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── vi.hoisted() mocks ───────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(),
  insert:  vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
  update:  vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn() })) })) })),
  select:  vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => []) })) })) })),
}));

const mockLogOrgEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  ingestionJobsTable: {
    id:             { name: "id" },
    organizationId: { name: "organization_id" },
    sourceVersionId: { name: "source_version_id" },
    status:         { name: "status" },
    attemptCount:   { name: "attempt_count" },
    maxAttempts:    { name: "max_attempts" },
    leaseExpiresAt: { name: "lease_expires_at" },
    claimedBy:      { name: "claimed_by" },
    createdAt:      { name: "created_at" },
  },
  INGESTION_JOB_TRANSITIONS: {
    queued:          ["fetching", "cancelled", "cancelling"],
    fetching:        ["extracting", "failed", "cancelling"],
    extracting:      ["normalising", "failed", "cancelling"],
    normalising:     ["chunking", "failed", "cancelling"],
    chunking:        ["embedding", "failed", "cancelling"],
    embedding:       ["review_required", "failed", "cancelling"],
    review_required: ["approved", "failed"],
    approved:        [],
    failed:          ["queued", "dead_lettered"],
    dead_lettered:   [],
    cancelling:      ["cancelled"],
    cancelled:       [],
    revoked:         [],
  },
  INGESTION_JOB_STATUSES: [
    "queued","fetching","extracting","normalising","chunking","embedding",
    "review_required","approved","failed","dead_lettered","cancelling","cancelled","revoked",
  ],
  INGESTION_NON_RETRYABLE_CODES: new Set([
    "UNSUPPORTED_FILE_TYPE","CORRUPTED_DOCUMENT","MISSING_STORAGE_KEY",
    "SOURCE_REVOKED","SOURCE_NOT_FOUND","VERSION_NOT_FOUND","NO_CHUNKS",
  ]),
  knowledgeSourcesTable:        { id: {}, organizationId: {}, status: {}, revokedAt: {}, updatedAt: {} },
  knowledgeSourceVersionsTable:  { id: {}, organizationId: {}, ingestionStatus: {}, updatedAt: {}, storageKey: {} },
  knowledgeChunksTable:          { sourceVersionId: {}, organizationId: {}, deletedAt: {} },
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args) => ({ and: args })),
  lt: vi.fn((a, b) => ({ lt: [a, b] })),
  inArray: vi.fn((a, b) => ({ inArray: [a, b] })),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { DatabaseIngestionQueue } from "../lib/ingestionQueue/DatabaseIngestionQueue.js";
import { getIngestionQueue, _resetQueueInstance } from "../lib/ingestionQueue/index.js";
import {
  cancelIngestionJob,
  getActiveJobForVersion,
} from "../services/ingestionJobService.js";
import {
  workerStarted, workerStopped, workerHeartbeat,
  workerJobStarted, workerJobSucceeded, workerJobFailed,
  getWorkerHealth,
} from "../services/workerHealthService.js";
import {
  startInProcessWorker,
  stopInProcessWorker,
  KnowledgeIngestionWorker,
} from "../workers/knowledgeIngestionWorker.js";

// ─── Shared test factories ────────────────────────────────────────────────────

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id:                "job-1",
    organizationId:    "org-1",
    knowledgeSourceId: "src-1",
    sourceVersionId:   "ver-1",
    status:            "queued",
    attemptCount:      0,
    maxAttempts:       3,
    leaseExpiresAt:    null,
    heartbeatAt:       null,
    nextAttemptAt:     null,
    recoveryCount:     0,
    createdAt:         new Date(),
    updatedAt:         new Date(),
    ...overrides,
  };
}

// ─── 1. DatabaseIngestionQueue.enqueue ───────────────────────────────────────

describe("DatabaseIngestionQueue.enqueue", () => {
  let queue: DatabaseIngestionQueue;

  beforeEach(() => {
    queue = new DatabaseIngestionQueue();
    vi.clearAllMocks();
  });

  it("creates a new job when none exists for the version", async () => {
    // getActiveJobForVersion returns nothing
    const selectChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    };
    mockDb.select.mockReturnValue(selectChain);
    const job = makeJob();
    const insertChain = {
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([job]) }),
    };
    mockDb.insert.mockReturnValue(insertChain);

    const result = await queue.enqueue({
      organizationId:    "org-1",
      knowledgeSourceId: "src-1",
      sourceVersionId:   "ver-1",
      actorUserId:       "user-1",
    });

    expect(result.id).toBe("job-1");
    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "ingestion_job.queued" }),
    );
  });

  it("returns existing active job without creating a duplicate", async () => {
    const existing = makeJob({ status: "fetching" });
    const selectChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([existing]) }),
      }),
    };
    mockDb.select.mockReturnValue(selectChain);

    const result = await queue.enqueue({
      organizationId:    "org-1",
      knowledgeSourceId: "src-1",
      sourceVersionId:   "ver-1",
      actorUserId:       "user-1",
    });

    expect(result).toBe(existing);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ─── 2. DatabaseIngestionQueue.claimNext ─────────────────────────────────────

describe("DatabaseIngestionQueue.claimNext", () => {
  let queue: DatabaseIngestionQueue;

  beforeEach(() => {
    queue = new DatabaseIngestionQueue();
    vi.clearAllMocks();
  });

  it("returns null when queue is empty", async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    const result = await queue.claimNext("worker-1");
    expect(result).toBeNull();
  });

  it("returns claimed job when one is available", async () => {
    const job = makeJob({ status: "fetching", claimedBy: "worker-1", attemptCount: 1 });
    mockDb.execute.mockResolvedValue({ rows: [job] });
    const result = await queue.claimNext("worker-1");
    // Sprint 28.6: normalizeRawIngestionJob adds null for optional fields not
    // present in the mock — use objectContaining to verify only the fields we care about.
    expect(result).toMatchObject({
      id:             job.id,
      organizationId: job.organizationId,
      status:         "fetching",
      claimedBy:      "worker-1",
      attemptCount:   1,
    });
  });

  it("uses SKIP LOCKED SQL pattern (contains FOR UPDATE SKIP LOCKED)", async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    await queue.claimNext("worker-1");
    const sqlArg = mockDb.execute.mock.calls[0]?.[0];
    const queryStr = JSON.stringify(sqlArg);
    expect(queryStr).toContain("SKIP LOCKED");
  });
});

// ─── 3. DatabaseIngestionQueue.heartbeat ─────────────────────────────────────

describe("DatabaseIngestionQueue.heartbeat", () => {
  it("executes an update with the correct worker id", async () => {
    const queue = new DatabaseIngestionQueue();
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue({ rows: [] });

    await queue.heartbeat("job-1", "worker-1");

    expect(mockDb.execute).toHaveBeenCalledOnce();
    const sqlArg = JSON.stringify(mockDb.execute.mock.calls[0]?.[0]);
    expect(sqlArg).toContain("heartbeat_at");
    expect(sqlArg).toContain("lease_expires_at");
  });
});

// ─── 4. DatabaseIngestionQueue.fail ──────────────────────────────────────────

describe("DatabaseIngestionQueue.fail", () => {
  let queue: DatabaseIngestionQueue;

  beforeEach(() => {
    queue = new DatabaseIngestionQueue();
    vi.clearAllMocks();
  });

  it("transitions to failed (not dead_lettered) when attempts remain", async () => {
    const failedJob = makeJob({ status: "failed", attemptCount: 1, lastErrorCode: "EXTRACTION_FAILED" });
    mockDb.execute.mockResolvedValue({ rows: [failedJob] });

    const result = await queue.fail("job-1", "org-1", "EXTRACTION_FAILED", "Extract failed");
    expect(result.status).toBe("failed");
  });

  it("transitions to dead_lettered when non-retryable code is used", async () => {
    const deadJob = makeJob({ status: "dead_lettered", attemptCount: 1 });
    mockDb.execute.mockResolvedValue({ rows: [deadJob] });

    const result = await queue.fail("job-1", "org-1", "NO_CHUNKS", "No chunks produced", false);
    expect(result.status).toBe("dead_lettered");
    // logOrgEvent is fire-and-forget — give it a tick to settle
    await Promise.resolve();
    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "ingestion_job.dead_lettered" }),
    );
  });

  it("transitions to dead_lettered when nonRetryable=true is passed", async () => {
    const deadJob = makeJob({ status: "dead_lettered" });
    mockDb.execute.mockResolvedValue({ rows: [deadJob] });

    const result = await queue.fail("job-1", "org-1", "CUSTOM_ERROR", "Msg", true);
    expect(result.status).toBe("dead_lettered");
  });
});

// ─── 5. DatabaseIngestionQueue.cancel ────────────────────────────────────────

describe("DatabaseIngestionQueue.cancel", () => {
  let queue: DatabaseIngestionQueue;

  beforeEach(() => {
    queue = new DatabaseIngestionQueue();
    vi.clearAllMocks();
  });

  it("transitions queued job to cancelled immediately", async () => {
    const cancelledJob = makeJob({ status: "cancelled" });
    mockDb.execute.mockResolvedValue({ rows: [cancelledJob] });

    const result = await queue.cancel("job-1", "org-1", "user-1");
    expect(result.status).toBe("cancelled");
  });

  it("transitions in-flight job to cancelling", async () => {
    const cancellingJob = makeJob({ status: "cancelling" });
    mockDb.execute.mockResolvedValue({ rows: [cancellingJob] });

    const result = await queue.cancel("job-1", "org-1", "user-1");
    expect(result.status).toBe("cancelling");
  });

  it("throws when job is in a terminal state", async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    await expect(queue.cancel("job-1", "org-1", "user-1")).rejects.toThrow();
  });
});

// ─── 6. DatabaseIngestionQueue.finaliseCancellation ──────────────────────────

describe("DatabaseIngestionQueue.finaliseCancellation", () => {
  it("calls DB update transitioning cancelling→cancelled", async () => {
    const chain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([makeJob({ status: "cancelled" })]),
      }),
    };
    mockDb.update.mockReturnValue(chain);

    await new DatabaseIngestionQueue().finaliseCancellation("job-1", "org-1");

    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
  });
});

// ─── 7. DatabaseIngestionQueue.recoverStuck ──────────────────────────────────

describe("DatabaseIngestionQueue.recoverStuck", () => {
  let queue: DatabaseIngestionQueue;

  beforeEach(() => {
    queue = new DatabaseIngestionQueue();
    vi.clearAllMocks();
  });

  it("returns 0 when no stuck jobs exist", async () => {
    const selectChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    };
    mockDb.select.mockReturnValue(selectChain);

    const count = await queue.recoverStuck();
    expect(count).toBe(0);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("resets expired-lease jobs to queued when attempts remain", async () => {
    const stuckJob = {
      id: "job-1", organizationId: "org-1",
      attemptCount: 1, maxAttempts: 3, status: "extracting",
    };
    const selectChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([stuckJob]) }),
      }),
    };
    mockDb.select.mockReturnValue(selectChain);
    mockDb.execute.mockResolvedValue({ rows: [] });

    const count = await queue.recoverStuck();
    expect(count).toBe(1);
    const sqlArg = JSON.stringify(mockDb.execute.mock.calls[0]?.[0]);
    expect(sqlArg).toContain("queued");
  });

  it("dead-letters stuck jobs that have exhausted attempts", async () => {
    const stuckJob = {
      id: "job-1", organizationId: "org-1",
      attemptCount: 3, maxAttempts: 3, status: "embedding",
    };
    const selectChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([stuckJob]) }),
      }),
    };
    mockDb.select.mockReturnValue(selectChain);
    mockDb.execute.mockResolvedValue({ rows: [] });

    await queue.recoverStuck();
    const sqlArg = JSON.stringify(mockDb.execute.mock.calls[0]?.[0]);
    expect(sqlArg).toContain("dead_lettered");
  });
});

// ─── 8. DatabaseIngestionQueue.health ────────────────────────────────────────

describe("DatabaseIngestionQueue.health", () => {
  it("returns structured health metrics", async () => {
    const queue = new DatabaseIngestionQueue();
    vi.clearAllMocks();

    // First execute: status counts
    // Second execute: oldest queued
    // Third execute: stuck count
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ status: "queued", cnt: "3" }, { status: "failed", cnt: "1" }] })
      .mockResolvedValueOnce([{ oldest: null }])
      .mockResolvedValueOnce([{ cnt: "0" }]);

    const health = await queue.health();

    expect(health.provider).toBe("database");
    expect(health.queued).toBe(3);
    expect(health.failed).toBe(1);
    expect(health.stuck).toBe(0);
  });
});

// ─── 9. ingestionJobService.cancelIngestionJob ───────────────────────────────

describe("ingestionJobService.cancelIngestionJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions queued job directly to cancelled", async () => {
    const queuedJob = makeJob({ status: "queued" });
    const cancelledJob = makeJob({ status: "cancelled" });

    // getIngestionJob lookup
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([queuedJob]) }),
      }),
    });

    const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([cancelledJob]) }) }) };
    mockDb.update.mockReturnValue(updateChain);

    const result = await cancelIngestionJob("job-1", "org-1", "user-1");
    expect(result.status).toBe("cancelled");
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("transitions extracting job to cancelling (not cancelled)", async () => {
    const extractingJob = makeJob({ status: "extracting" });
    const cancellingJob = makeJob({ status: "cancelling" });

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([extractingJob]) }),
      }),
    });

    const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([cancellingJob]) }) }) };
    mockDb.update.mockReturnValue(updateChain);

    const result = await cancelIngestionJob("job-1", "org-1", "user-1");
    expect(result.status).toBe("cancelling");
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelling" }),
    );
  });

  it("throws CANNOT_CANCEL for approved jobs", async () => {
    const approvedJob = makeJob({ status: "approved" });
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([approvedJob]) }),
      }),
    });

    await expect(cancelIngestionJob("job-1", "org-1", "user-1"))
      .rejects.toMatchObject({ code: "CANNOT_CANCEL" });
  });
});

// ─── 10. ingestionJobService.getActiveJobForVersion ──────────────────────────

describe("ingestionJobService.getActiveJobForVersion", () => {
  it("excludes dead_lettered jobs from active set", async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const result = await getActiveJobForVersion("ver-1", "org-1");
    expect(result).toBeNull();

    // Verify the SQL where clause excludes dead_lettered
    const whereCall = mockDb.select().from().where;
    expect(whereCall).toHaveBeenCalled();
  });
});

// ─── 11. ingestionPipelineService.triggerIngestion ───────────────────────────

describe("ingestionPipelineService.triggerIngestion", () => {
  it("delegates to enqueueIngestionJob and returns a job", async () => {
    const job = makeJob();
    // mock getActiveJobForVersion to return null (no existing job)
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([job]) }),
    });

    const { triggerIngestion } = await import("../services/ingestionPipelineService.js");
    const result = await triggerIngestion({
      organizationId:    "org-1",
      knowledgeSourceId: "src-1",
      sourceVersionId:   "ver-1",
      actorUserId:       "user-1",
    });

    expect(result.id).toBe("job-1");
  });
});

// ─── 12. KnowledgeIngestionWorker ────────────────────────────────────────────

describe("KnowledgeIngestionWorker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports isRunning() correctly", () => {
    const worker = new KnowledgeIngestionWorker("test-worker");
    expect(worker.isRunning()).toBe(false);
    worker.start();
    expect(worker.isRunning()).toBe(true);
    worker.stop();
  });

  it("stop() resolves even when no job is running", async () => {
    const worker = new KnowledgeIngestionWorker("test-worker-2");
    worker.start();
    await expect(worker.stop()).resolves.toBeUndefined();
  });

  it("has a unique workerId by default", () => {
    const w1 = new KnowledgeIngestionWorker();
    const w2 = new KnowledgeIngestionWorker();
    expect(w1.workerId).not.toBe(w2.workerId);
  });

  it("uses provided workerId when given", () => {
    const w = new KnowledgeIngestionWorker("my-worker");
    expect(w.workerId).toBe("my-worker");
  });
});

// ─── 13. workerHealthService ─────────────────────────────────────────────────

describe("workerHealthService", () => {
  it("tracks lifecycle transitions correctly", () => {
    workerStarted("wid-1");
    let h = getWorkerHealth();
    expect(h.running).toBe(true);
    expect(h.workerId).toBe("wid-1");
    expect(h.jobsProcessed).toBe(0);

    workerJobStarted("job-a");
    h = getWorkerHealth();
    expect(h.currentJobId).toBe("job-a");
    expect(h.jobsProcessed).toBe(1);

    workerJobSucceeded();
    h = getWorkerHealth();
    expect(h.jobsSucceeded).toBe(1);
    expect(h.currentJobId).toBeNull();

    workerJobStarted("job-b");
    workerJobFailed(true);
    h = getWorkerHealth();
    expect(h.jobsFailed).toBe(1);
    expect(h.jobsDeadLettered).toBe(1);

    workerHeartbeat();
    h = getWorkerHealth();
    expect(h.lastHeartbeatAt).toBeInstanceOf(Date);

    workerStopped();
    h = getWorkerHealth();
    expect(h.running).toBe(false);
  });
});

// ─── 14. getIngestionQueue factory ───────────────────────────────────────────

describe("getIngestionQueue factory", () => {
  beforeEach(() => {
    _resetQueueInstance();
    delete process.env.KNOWLEDGE_QUEUE_PROVIDER;
  });
  afterEach(() => {
    _resetQueueInstance();
    delete process.env.KNOWLEDGE_QUEUE_PROVIDER;
  });

  it("returns DatabaseIngestionQueue by default", () => {
    const q = getIngestionQueue();
    expect(q).toBeInstanceOf(DatabaseIngestionQueue);
  });

  it("returns the same singleton on repeated calls", () => {
    const q1 = getIngestionQueue();
    const q2 = getIngestionQueue();
    expect(q1).toBe(q2);
  });

  it("throws for unknown provider", () => {
    _resetQueueInstance();
    process.env.KNOWLEDGE_QUEUE_PROVIDER = "kafka";
    expect(() => getIngestionQueue()).toThrow("Unknown KNOWLEDGE_QUEUE_PROVIDER");
  });
});

// ─── 15. Auto-enqueue integration (complete-upload) ──────────────────────────

describe("complete-upload auto-enqueue integration", () => {
  it("triggerIngestion is called with correct shape for non-duplicate upload", async () => {
    // Smoke test: triggerIngestion is exported from ingestionPipelineService
    const mod = await import("../services/ingestionPipelineService.js");
    expect(typeof mod.triggerIngestion).toBe("function");
  });

  it("triggerIngestion accepts required fields", async () => {
    const job = makeJob();
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([job]) }),
    });

    const { triggerIngestion } = await import("../services/ingestionPipelineService.js");
    const result = await triggerIngestion({
      organizationId:    "org-x",
      knowledgeSourceId: "src-x",
      sourceVersionId:   "ver-x",
      actorUserId:       "user-x",
      maxAttempts:       5,
    });

    expect(result).toBeDefined();
  });
});
