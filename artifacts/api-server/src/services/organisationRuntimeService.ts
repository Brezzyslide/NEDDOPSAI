/**
 * Organisation Runtime Coordinator — Sprint XX
 *
 * Coordinates the execution lifecycle across:
 * - specialistQueueService (queue management)
 * - specialistRunService (run lifecycle)
 * - executionIntentService (intent buffer)
 * - approvalService (approval workflow)
 * - auditService (audit trail)
 *
 * The Runtime Coordinator owns:
 * - Execution graph tracking (via execution_graph_nodes table)
 * - Runtime state visibility
 * - Work package routing
 * - Intent dispatcher interface (OpenClaw wiring deferred to next sprint)
 * - Execution event publishing
 * - Execution history
 * - Retry metadata preparation
 * - Recovery metadata preparation
 */

import { randomUUID } from "crypto";
import type { ExecutionIntent } from "./specialistOutputContractService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphStatus =
  | 'initialising'
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_connector'
  | 'consolidating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExecutionGraph {
  graphId: string;             // = taskId
  organisationId: string;
  taskId: string;
  status: GraphStatus;
  nodes: ExecutionGraphNode[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ExecutionGraphNode {
  nodeId: string;
  nodeType: 'intent' | 'specialist_run' | 'connector_call' | 'approval_gate' | 'consolidation';
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped' | 'waiting';
  dependsOnNodeIds: string[];
  startedAt?: string;
  completedAt?: string;
  resultSummary?: string;
  errorMessage?: string;
}

export interface IntentDispatchResult {
  dispatched: boolean;
  method: 'openclaw' | 'mock' | 'queued' | 'pending_connector';
  message: string;
  estimatedCompletionMs?: number;
}

// ─── Intent Dispatcher Interface ─────────────────────────────────────────────

/**
 * Intent dispatcher interface — OpenClaw implementation deferred to next sprint.
 */
export interface IIntentDispatcher {
  dispatch(intent: ExecutionIntent, graph: ExecutionGraph): Promise<IntentDispatchResult>;
  canDispatch(intentType: string): boolean;
  getAvailableMethods(): string[];
}

// ─── Mock Dispatcher ─────────────────────────────────────────────────────────

/**
 * Mock dispatcher — used until OpenClaw is wired.
 */
export class MockIntentDispatcher implements IIntentDispatcher {
  async dispatch(intent: ExecutionIntent, _graph: ExecutionGraph): Promise<IntentDispatchResult> {
    return {
      dispatched: true,
      method: 'mock',
      message: `Mock dispatch: intent ${intent.intentId} (${intent.intentType}) queued for execution`,
      estimatedCompletionMs: 500,
    };
  }

  canDispatch(_intentType: string): boolean {
    return true;
  }

  getAvailableMethods(): string[] {
    return ['mock'];
  }
}

// ─── In-memory Graph Cache ────────────────────────────────────────────────────

/**
 * In-memory graph state cache.
 * Graph state is also persisted to DB via executionGraphNodesTable (when available).
 * The cache is the authoritative read path during execution; DB is the durable store.
 */
const graphCache = new Map<string, ExecutionGraph>();

// ─── Execution History Store (in-memory fallback) ─────────────────────────────

interface ExecutionHistoryEntry {
  graphId: string;
  eventType: string;
  actorType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const historyStore: ExecutionHistoryEntry[] = [];

// ─── Runtime Functions ────────────────────────────────────────────────────────

/**
 * Creates a new execution graph for a task.
 * Persists to DB if executionGraphNodesTable is available; always updates in-memory cache.
 */
export async function createExecutionGraph(
  organisationId: string,
  taskId: string,
): Promise<ExecutionGraph> {
  const graph: ExecutionGraph = {
    graphId: taskId,
    organisationId,
    taskId,
    status: 'initialising',
    nodes: [],
    createdAt: new Date().toISOString(),
  };

  graphCache.set(taskId, graph);

  // Persist to DB — gracefully skip if table not yet available
  try {
    const { db, executionGraphNodesTable } = await import('@workspace/db' as string) as any;
    if (db && executionGraphNodesTable) {
      // Graph metadata stored as a synthetic root node
      await db.insert(executionGraphNodesTable).values({
        id: randomUUID(),
        graphId: graph.graphId,
        organisationId,
        taskId,
        nodeId: `root-${taskId}`,
        nodeType: 'intent',
        status: 'pending',
        dependsOnNodeIds: [],
        createdAt: new Date(),
      }).onConflictDoNothing();
    }
  } catch {
    // DB table not yet available — in-memory only
  }

  return graph;
}

/**
 * Adds a node to an execution graph.
 */
export async function addGraphNode(
  graphId: string,
  node: Omit<ExecutionGraphNode, 'nodeId'>,
): Promise<ExecutionGraphNode> {
  const graph = graphCache.get(graphId);
  if (!graph) {
    throw new Error(`Execution graph not found: ${graphId}`);
  }

  const newNode: ExecutionGraphNode = {
    ...node,
    nodeId: randomUUID(),
  };

  graph.nodes.push(newNode);

  // Update graph status to running if it was initialising
  if (graph.status === 'initialising') {
    graph.status = 'running';
    graph.startedAt = graph.startedAt ?? new Date().toISOString();
  }

  // Persist to DB — gracefully skip if table not yet available
  try {
    const { db, executionGraphNodesTable } = await import('@workspace/db' as string) as any;
    if (db && executionGraphNodesTable) {
      await db.insert(executionGraphNodesTable).values({
        id: randomUUID(),
        graphId,
        organisationId: graph.organisationId,
        taskId: graph.taskId,
        nodeId: newNode.nodeId,
        nodeType: newNode.nodeType,
        status: newNode.status,
        dependsOnNodeIds: newNode.dependsOnNodeIds,
        startedAt: newNode.startedAt ? new Date(newNode.startedAt) : null,
        completedAt: newNode.completedAt ? new Date(newNode.completedAt) : null,
        resultSummary: newNode.resultSummary ?? null,
        errorMessage: newNode.errorMessage ?? null,
        createdAt: new Date(),
      }).onConflictDoNothing();
    }
  } catch {
    // DB table not yet available — in-memory only
  }

  return newNode;
}

/**
 * Updates the status of a graph node.
 */
export async function updateNodeStatus(
  graphId: string,
  nodeId: string,
  status: ExecutionGraphNode['status'],
  result?: string,
): Promise<void> {
  const graph = graphCache.get(graphId);
  if (!graph) return;

  const node = graph.nodes.find((n) => n.nodeId === nodeId);
  if (!node) return;

  node.status = status;
  if (result) node.resultSummary = result;

  if (status === 'active' && !node.startedAt) {
    node.startedAt = new Date().toISOString();
  }
  if ((status === 'completed' || status === 'failed' || status === 'skipped') && !node.completedAt) {
    node.completedAt = new Date().toISOString();
  }

  // Update graph-level status based on node states
  const allNodes = graph.nodes;
  const anyFailed = allNodes.some((n) => n.status === 'failed');
  const allDone = allNodes.every((n) => ['completed', 'failed', 'skipped'].includes(n.status));

  if (anyFailed) {
    graph.status = 'failed';
  } else if (allDone) {
    graph.status = 'completed';
    graph.completedAt = new Date().toISOString();
  } else if (allNodes.some((n) => n.status === 'waiting')) {
    graph.status = 'waiting_for_approval';
  } else if (allNodes.some((n) => n.nodeType === 'consolidation' && n.status === 'active')) {
    graph.status = 'consolidating';
  } else {
    graph.status = 'running';
  }

  // Persist to DB — gracefully skip if table not yet available
  try {
    const { db, executionGraphNodesTable } = await import('@workspace/db' as string) as any;
    if (db && executionGraphNodesTable) {
      const { eq, and } = await import('drizzle-orm');
      await db.update(executionGraphNodesTable)
        .set({
          status: node.status,
          resultSummary: node.resultSummary ?? null,
          startedAt: node.startedAt ? new Date(node.startedAt) : null,
          completedAt: node.completedAt ? new Date(node.completedAt) : null,
        })
        .where(
          and(
            eq(executionGraphNodesTable.graphId, graphId),
            eq(executionGraphNodesTable.nodeId, nodeId),
          ),
        );
    }
  } catch {
    // DB table not yet available — in-memory only
  }
}

/**
 * Retrieves an execution graph by graph ID.
 * Checks in-memory cache first, then DB.
 */
export async function getExecutionGraph(graphId: string): Promise<ExecutionGraph | null> {
  const cached = graphCache.get(graphId);
  if (cached) return cached;

  // Try DB fallback
  try {
    const { db, executionGraphNodesTable } = await import('@workspace/db' as string) as any;
    if (!db || !executionGraphNodesTable) return null;

    const { eq } = await import('drizzle-orm');
    const rows = await db
      .select()
      .from(executionGraphNodesTable)
      .where(eq(executionGraphNodesTable.graphId, graphId));

    if (rows.length === 0) return null;

    // Reconstruct graph from node rows (excluding the synthetic root node)
    const firstRow = rows[0];
    const graph: ExecutionGraph = {
      graphId,
      organisationId: firstRow.organisationId,
      taskId: firstRow.taskId,
      status: 'running',
      nodes: rows
        .filter((r: any) => !r.nodeId.startsWith('root-'))
        .map((r: any): ExecutionGraphNode => ({
          nodeId: r.nodeId,
          nodeType: r.nodeType,
          status: r.status,
          dependsOnNodeIds: r.dependsOnNodeIds ?? [],
          startedAt: r.startedAt?.toISOString(),
          completedAt: r.completedAt?.toISOString(),
          resultSummary: r.resultSummary ?? undefined,
          errorMessage: r.errorMessage ?? undefined,
        })),
      createdAt: firstRow.createdAt?.toISOString() ?? new Date().toISOString(),
    };

    graphCache.set(graphId, graph);
    return graph;
  } catch {
    return null;
  }
}

/**
 * Publishes an execution event. Events are appended to the history store
 * and persisted to DB when executionHistoryTable is available.
 */
export async function publishExecutionEvent(event: {
  graphId: string;
  taskId?: string;
  specialistRunId?: string;
  eventType: string;
  actorType: string;
  actorId?: string;
  payload?: Record<string, unknown>;
  organisationId: string;
}): Promise<void> {
  const entry: ExecutionHistoryEntry = {
    graphId: event.graphId,
    eventType: event.eventType,
    actorType: event.actorType,
    payload: {
      ...event.payload,
      taskId: event.taskId,
      specialistRunId: event.specialistRunId,
      actorId: event.actorId,
      organisationId: event.organisationId,
    },
    createdAt: new Date().toISOString(),
  };

  historyStore.push(entry);

  // Persist to DB — gracefully skip if table not yet available
  try {
    const { db, executionHistoryTable } = await import('@workspace/db' as string) as any;
    if (db && executionHistoryTable) {
      await db.insert(executionHistoryTable).values({
        id: randomUUID(),
        graphId: event.graphId,
        organisationId: event.organisationId,
        taskId: event.taskId ?? null,
        specialistRunId: event.specialistRunId ?? null,
        eventType: event.eventType,
        actorType: event.actorType,
        actorId: event.actorId ?? null,
        payload: event.payload ?? {},
        createdAt: new Date(),
      });
    }
  } catch {
    // DB table not yet available — in-memory only
  }
}

/**
 * Retrieves execution history for a graph.
 */
export async function getExecutionHistory(
  graphId: string,
): Promise<Array<{ eventType: string; actorType: string; payload: Record<string, unknown>; createdAt: string }>> {
  // Try DB first
  try {
    const { db, executionHistoryTable } = await import('@workspace/db' as string) as any;
    if (db && executionHistoryTable) {
      const { eq } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(executionHistoryTable)
        .where(eq(executionHistoryTable.graphId, graphId))
        .orderBy(executionHistoryTable.createdAt);

      if (rows.length > 0) {
        return rows.map((r: any) => ({
          eventType: r.eventType,
          actorType: r.actorType,
          payload: r.payload ?? {},
          createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
        }));
      }
    }
  } catch {
    // Fall through to in-memory
  }

  // Fall back to in-memory store
  return historyStore
    .filter((e) => e.graphId === graphId)
    .map((e) => ({
      eventType: e.eventType,
      actorType: e.actorType,
      payload: e.payload,
      createdAt: e.createdAt,
    }));
}

// ─── Retry Metadata ───────────────────────────────────────────────────────────

/**
 * Prepares retry metadata for a failed graph node.
 * Uses exponential backoff capped at 5 minutes.
 */
export function prepareRetryMetadata(
  node: ExecutionGraphNode,
  attemptNumber: number,
): { shouldRetry: boolean; delayMs: number; reason: string } {
  const MAX_ATTEMPTS = 3;

  if (node.status !== 'failed') {
    return { shouldRetry: false, delayMs: 0, reason: 'Node has not failed' };
  }

  if (attemptNumber >= MAX_ATTEMPTS) {
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: `Maximum retry attempts (${MAX_ATTEMPTS}) reached for node ${node.nodeId}`,
    };
  }

  // Non-retriable node types
  if (node.nodeType === 'approval_gate') {
    return { shouldRetry: false, delayMs: 0, reason: 'Approval gate nodes are not retriable' };
  }

  // Exponential backoff: 2^attemptNumber * 1000ms, max 5 minutes
  const delayMs = Math.min(Math.pow(2, attemptNumber) * 1000, 300_000);

  return {
    shouldRetry: true,
    delayMs,
    reason: `Retry attempt ${attemptNumber + 1}/${MAX_ATTEMPTS} for node ${node.nodeId} (${node.nodeType})`,
  };
}

// ─── Recovery Metadata ────────────────────────────────────────────────────────

/**
 * Prepares recovery metadata for a failed execution graph.
 */
export function prepareRecoveryMetadata(
  graph: ExecutionGraph,
): { recoverable: boolean; recoveryStrategy: string; affectedNodes: string[] } {
  const failedNodes = graph.nodes.filter((n) => n.status === 'failed');
  const affectedNodes = failedNodes.map((n) => n.nodeId);

  if (graph.status === 'completed') {
    return {
      recoverable: false,
      recoveryStrategy: 'none',
      affectedNodes: [],
    };
  }

  if (graph.status === 'cancelled') {
    return {
      recoverable: false,
      recoveryStrategy: 'none',
      affectedNodes: [],
    };
  }

  if (failedNodes.length === 0) {
    return {
      recoverable: true,
      recoveryStrategy: 'resume',
      affectedNodes: [],
    };
  }

  // Check if any failed nodes are specialist_run or connector_call (retriable)
  const retriableFailures = failedNodes.filter(
    (n) => n.nodeType === 'specialist_run' || n.nodeType === 'connector_call',
  );

  if (retriableFailures.length > 0 && retriableFailures.length === failedNodes.length) {
    return {
      recoverable: true,
      recoveryStrategy: 'retry_failed_nodes',
      affectedNodes,
    };
  }

  // Consolidation failures may be recoverable with partial data
  const consolidationFailures = failedNodes.filter((n) => n.nodeType === 'consolidation');
  if (consolidationFailures.length > 0) {
    return {
      recoverable: true,
      recoveryStrategy: 'retry_consolidation_with_partial_data',
      affectedNodes,
    };
  }

  // Approval gate failures require human intervention
  const approvalFailures = failedNodes.filter((n) => n.nodeType === 'approval_gate');
  if (approvalFailures.length > 0) {
    return {
      recoverable: false,
      recoveryStrategy: 'manual_approval_required',
      affectedNodes,
    };
  }

  return {
    recoverable: false,
    recoveryStrategy: 'manual_intervention_required',
    affectedNodes,
  };
}
