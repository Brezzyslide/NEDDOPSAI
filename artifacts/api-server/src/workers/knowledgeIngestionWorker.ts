/**
 * Knowledge Hub Ingestion Worker — Task #19
 *
 * Processes queued ingestion jobs from the database queue.
 * Designed to run either:
 *   - In-process (KNOWLEDGE_WORKER_MODE=in-process) — development / Replit
 *   - As a separate process   — production (node dist/workers/knowledgeIngestionWorker.mjs)
 *
 * AWS mapping:
 *   Replace the poll loop with SQS.receiveMessage + ECS/Fargate task.
 *   The pipeline itself (runPipelineForJob) runs unchanged.
 *
 * Behaviour:
 *   1. Register worker identity
 *   2. Poll queue every KNOWLEDGE_WORKER_POLL_MS
 *   3. Claim one job (atomic, FOR UPDATE SKIP LOCKED)
 *   4. Start heartbeat interval (KNOWLEDGE_WORKER_HEARTBEAT_MS)
 *   5. Run ingestion pipeline (cancellable between stages)
 *   6. Complete or fail job (backoff / dead-letter on fail)
 *   7. Continue polling
 *   8. Sweeper runs every KNOWLEDGE_WORKER_SWEEP_MS — recovers expired leases
 *   9. Graceful stop on SIGTERM / SIGINT or explicit stop()
 */

import { randomUUID }       from "crypto";
import { logger }           from "../lib/logger.js";
import { getIngestionQueue } from "../lib/ingestionQueue/index.js";
import { runPipelineForJob } from "../services/ingestionPipelineService.js";
import {
  workerStarted, workerStopped, workerHeartbeat,
  workerPolled, workerJobStarted, workerJobSucceeded, workerJobFailed,
} from "../services/workerHealthService.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const POLL_MS       = parseInt(process.env.KNOWLEDGE_WORKER_POLL_MS       ?? "5000",   10);
const HEARTBEAT_MS  = parseInt(process.env.KNOWLEDGE_WORKER_HEARTBEAT_MS  ?? "15000",  10);
const SWEEP_MS      = parseInt(process.env.KNOWLEDGE_WORKER_SWEEP_MS      ?? "60000",  10);

// ─── Worker class ─────────────────────────────────────────────────────────────

export class KnowledgeIngestionWorker {
  readonly workerId: string;

  private _running         = false;
  private _stopRequested   = false;
  private _pollTimer:    ReturnType<typeof setTimeout>  | null = null;
  private _sweepTimer:   ReturnType<typeof setInterval> | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _currentJobId:  string | null = null;
  private _currentOrgId:  string | null = null;

  constructor(workerId?: string) {
    this.workerId = workerId ?? `worker-${randomUUID()}`;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  start(): void {
    if (this._running) return;
    this._running       = true;
    this._stopRequested = false;

    workerStarted(this.workerId);
    logger.info({ workerId: this.workerId }, "[knowledge-worker] Started");

    // Stuck-job sweeper
    this._sweepTimer = setInterval(() => this._sweep(), SWEEP_MS);

    // Begin polling immediately
    this._schedulePoll(0);
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._stopRequested = true;

    if (this._pollTimer)    { clearTimeout(this._pollTimer);   this._pollTimer    = null; }
    if (this._sweepTimer)   { clearInterval(this._sweepTimer); this._sweepTimer   = null; }
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }

    // Wait briefly for current job to complete
    if (this._currentJobId) {
      logger.info({ workerId: this.workerId, jobId: this._currentJobId }, "[knowledge-worker] Waiting for current job to finish...");
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          if (!this._currentJobId) { clearInterval(check); resolve(); }
        }, 200);
        setTimeout(() => { clearInterval(check); resolve(); }, 10_000); // max 10s wait
      });
    }

    this._running = false;
    workerStopped();
    logger.info({ workerId: this.workerId }, "[knowledge-worker] Stopped");
  }

  isRunning(): boolean { return this._running; }

  // ── Poll loop ──────────────────────────────────────────────────────────────

  private _schedulePoll(delayMs: number): void {
    if (this._stopRequested) return;
    this._pollTimer = setTimeout(() => this._poll(), delayMs);
  }

  private async _poll(): Promise<void> {
    this._pollTimer = null;
    if (this._stopRequested) return;

    workerPolled();

    try {
      const queue = getIngestionQueue();
      const job   = await queue.claimNext(this.workerId);

      if (!job) {
        // Queue empty — poll again after interval
        this._schedulePoll(POLL_MS);
        return;
      }

      // Process the claimed job
      this._currentJobId = job.id;
      this._currentOrgId = job.organizationId;
      workerJobStarted(job.id);

      // Start heartbeat for this job
      this._heartbeatTimer = setInterval(() => this._heartbeat(), HEARTBEAT_MS);

      const start = Date.now();
      logger.info(
        { workerId: this.workerId, jobId: job.id, orgId: job.organizationId, sourceId: job.knowledgeSourceId, attempt: job.attemptCount },
        "[knowledge-worker] Processing job",
      );

      let succeeded = false;
      let deadLettered = false;

      try {
        await runPipelineForJob(
          job.id,
          job.organizationId,
          job.knowledgeSourceId,
          job.sourceVersionId,
          this.workerId,
        );
        succeeded = true;
        workerJobSucceeded();
        logger.info(
          { workerId: this.workerId, jobId: job.id, durationMs: Date.now() - start },
          "[knowledge-worker] Job succeeded",
        );
      } catch (err: any) {
        const isDeadLettered = err?.code === "DEAD_LETTERED" || err?.deadLettered === true;
        deadLettered = isDeadLettered;
        workerJobFailed(isDeadLettered);
        logger.error(
          { workerId: this.workerId, jobId: job.id, orgId: job.organizationId, code: err?.code, durationMs: Date.now() - start },
          "[knowledge-worker] Job failed",
        );
      } finally {
        if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
        this._currentJobId = null;
        this._currentOrgId = null;
      }

    } catch (err) {
      logger.error({ workerId: this.workerId, err }, "[knowledge-worker] Poll error");
    }

    // Immediately poll again — if queue has work, process it without delay
    this._schedulePoll(0);
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  private async _heartbeat(): Promise<void> {
    if (!this._currentJobId || !this._currentOrgId) return;
    try {
      workerHeartbeat();
      const queue = getIngestionQueue();
      await queue.heartbeat(this._currentJobId, this.workerId);
    } catch {
      // Non-fatal — lease expiry will be caught by sweeper
    }
  }

  // ── Sweeper ────────────────────────────────────────────────────────────────

  private async _sweep(): Promise<void> {
    try {
      const queue     = getIngestionQueue();
      const recovered = await queue.recoverStuck();
      if (recovered > 0) {
        logger.info({ workerId: this.workerId, recovered }, "[knowledge-worker] Recovered stuck jobs");
      }
    } catch (err) {
      logger.warn({ err }, "[knowledge-worker] Sweeper error");
    }
  }
}

// ─── Singleton for in-process mode ───────────────────────────────────────────

let _instance: KnowledgeIngestionWorker | null = null;

export function startInProcessWorker(): KnowledgeIngestionWorker {
  if (_instance?.isRunning()) return _instance;
  _instance = new KnowledgeIngestionWorker();
  _instance.start();
  return _instance;
}

export async function stopInProcessWorker(): Promise<void> {
  if (_instance) {
    await _instance.stop();
    _instance = null;
  }
}

export function getInProcessWorker(): KnowledgeIngestionWorker | null {
  return _instance;
}

// ─── Standalone entry point ───────────────────────────────────────────────────
// Run as: node dist/workers/knowledgeIngestionWorker.mjs
// (Production: ECS/Fargate task, one process per container)

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].includes("knowledgeIngestionWorker")
) {
  const worker = new KnowledgeIngestionWorker();
  worker.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "[knowledge-worker] Shutdown signal received");
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}
