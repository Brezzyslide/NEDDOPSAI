/**
 * Worker Health Service — Task #19
 *
 * Tracks in-process worker state and provides health metrics.
 * Thread-safe for single-process Node.js; for multi-process, extend with a
 * shared Redis/DB heartbeat table.
 *
 * Never exposes tenant document names or content in any health response.
 */

export interface WorkerHealthState {
  running:           boolean;
  workerId:          string | null;
  startedAt:         Date | null;
  lastHeartbeatAt:   Date | null;
  lastPollAt:        Date | null;
  jobsProcessed:     number;
  jobsSucceeded:     number;
  jobsFailed:        number;
  jobsDeadLettered:  number;
  currentJobId:      string | null;
  currentJobStartedAt: Date | null;
  avgProcessingMs:   number | null;
}

const _state: WorkerHealthState = {
  running:           false,
  workerId:          null,
  startedAt:         null,
  lastHeartbeatAt:   null,
  lastPollAt:        null,
  jobsProcessed:     0,
  jobsSucceeded:     0,
  jobsFailed:        0,
  jobsDeadLettered:  0,
  currentJobId:      null,
  currentJobStartedAt: null,
  avgProcessingMs:   null,
};

let _totalProcessingMs = 0;

export function workerStarted(workerId: string): void {
  _state.running          = true;
  _state.workerId         = workerId;
  _state.startedAt        = new Date();
  _state.lastHeartbeatAt  = new Date();
}

export function workerStopped(): void {
  _state.running          = false;
  _state.currentJobId     = null;
  _state.currentJobStartedAt = null;
}

export function workerHeartbeat(): void {
  _state.lastHeartbeatAt = new Date();
}

export function workerPolled(): void {
  _state.lastPollAt = new Date();
}

export function workerJobStarted(jobId: string): void {
  _state.currentJobId        = jobId;
  _state.currentJobStartedAt = new Date();
  _state.jobsProcessed++;
}

export function workerJobSucceeded(): void {
  const durationMs = _state.currentJobStartedAt
    ? Date.now() - _state.currentJobStartedAt.getTime()
    : 0;
  _totalProcessingMs += durationMs;
  _state.avgProcessingMs = _state.jobsSucceeded > 0
    ? Math.round(_totalProcessingMs / (_state.jobsSucceeded + 1))
    : durationMs;
  _state.jobsSucceeded++;
  _state.currentJobId        = null;
  _state.currentJobStartedAt = null;
}

export function workerJobFailed(deadLettered = false): void {
  _state.jobsFailed++;
  if (deadLettered) _state.jobsDeadLettered++;
  _state.currentJobId        = null;
  _state.currentJobStartedAt = null;
}

export function getWorkerHealth(): WorkerHealthState {
  return { ..._state };
}
