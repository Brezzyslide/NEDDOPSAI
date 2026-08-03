/**
 * SQS-backed ingestion queue adapter — AWS production stub.
 *
 * AWS target architecture:
 *   API service → SQS queue → ingestion worker (ECS/Fargate) → private S3 → RDS (pgvector)
 *
 * Environment mappings (when KNOWLEDGE_QUEUE_PROVIDER=sqs):
 *   SQS_INGESTION_QUEUE_URL         → queue URL for normal jobs
 *   SQS_INGESTION_DLQ_URL           → dead-letter queue URL (SQS DLQ)
 *   AWS_REGION                      → e.g. ap-southeast-2
 *   AWS_ACCESS_KEY_ID / SECRET      → via Secrets Manager in production
 *
 * Worker process:
 *   Run as an ECS/Fargate task alongside the API service.
 *   Scale on queue depth metric (ApproximateNumberOfMessagesVisible).
 *   Keep local / dev / staging / production queues separate via queue URL env.
 *
 * Storage:
 *   Replace GCS calls in ingestionPipelineService with S3.getObject().
 *
 * Logs:
 *   Replace pino file transport with CloudWatch Logs.
 *
 * This stub is NOT active. It will throw if instantiated without proper AWS config.
 * Implementation is intentionally deferred until AWS infrastructure is provisioned.
 */

import type { IIngestionQueue, QueueHealth } from "./IIngestionQueue.js";
import type { IngestionJob } from "@workspace/db";

export class SqsIngestionQueue implements IIngestionQueue {
  constructor() {
    // Validate that required config is present before accepting traffic
    if (!process.env.SQS_INGESTION_QUEUE_URL) {
      throw new Error(
        "SqsIngestionQueue: SQS_INGESTION_QUEUE_URL is required when KNOWLEDGE_QUEUE_PROVIDER=sqs. " +
          "Set this to your SQS queue URL and ensure AWS credentials are configured.",
      );
    }
  }

  private notImplemented(): never {
    throw new Error(
      "SqsIngestionQueue: AWS SQS provider is not yet implemented. " +
        "Use KNOWLEDGE_QUEUE_PROVIDER=database for local and Replit development.",
    );
  }

  async enqueue(_input: Parameters<IIngestionQueue["enqueue"]>[0]): Promise<IngestionJob> { this.notImplemented(); }
  async claimNext(_workerId: string): Promise<IngestionJob | null>                        { this.notImplemented(); }
  async heartbeat(_jobId: string, _workerId: string): Promise<void>                       { this.notImplemented(); }
  async complete(_input: Parameters<IIngestionQueue["complete"]>[0]): Promise<IngestionJob> { this.notImplemented(); }
  async fail(_j: string, _o: string, _c: string, _m: string, _n?: boolean): Promise<IngestionJob> { this.notImplemented(); }
  async cancel(_j: string, _o: string, _a: string): Promise<IngestionJob>                 { this.notImplemented(); }
  async finaliseCancellation(_j: string, _o: string): Promise<void>                       { this.notImplemented(); }
  async recoverStuck(): Promise<number>                                                    { this.notImplemented(); }
  async health(): Promise<QueueHealth>                                                     { this.notImplemented(); }
}
