/**
 * Ingestion queue factory.
 *
 * Reads KNOWLEDGE_QUEUE_PROVIDER to select the active backend:
 *   database  — PostgreSQL-backed queue (default; Replit + local dev)
 *   sqs       — AWS SQS (future production; throws if SQS_INGESTION_QUEUE_URL unset)
 */

import type { IIngestionQueue } from "./IIngestionQueue.js";
import { DatabaseIngestionQueue } from "./DatabaseIngestionQueue.js";
import { SqsIngestionQueue }      from "./SqsIngestionQueue.js";

let _queue: IIngestionQueue | null = null;

export function getIngestionQueue(): IIngestionQueue {
  if (_queue) return _queue;

  const provider = (process.env.KNOWLEDGE_QUEUE_PROVIDER ?? "database").toLowerCase();

  switch (provider) {
    case "database":
      _queue = new DatabaseIngestionQueue();
      break;
    case "sqs":
      _queue = new SqsIngestionQueue();
      break;
    default:
      throw new Error(
        `Unknown KNOWLEDGE_QUEUE_PROVIDER="${provider}". ` +
          `Supported values: "database" (default), "sqs".`,
      );
  }

  return _queue;
}

// Reset for testing
export function _resetQueueInstance(): void {
  _queue = null;
}

export type { IIngestionQueue } from "./IIngestionQueue.js";
export { DatabaseIngestionQueue } from "./DatabaseIngestionQueue.js";
export { SqsIngestionQueue }      from "./SqsIngestionQueue.js";
