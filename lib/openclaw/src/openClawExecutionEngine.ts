/**
 * @workspace/openclaw — OpenClaw Execution Engine
 *
 * Implements the ExecutionEngine interface using the OpenClaw Runtime Broker.
 *
 * This is the concrete implementation that wires together:
 *   - RuntimeBrokerClient  (HTTP communication with OpenClaw)
 *   - ExecutionPackageTranslator  (NeedsOps → OpenClaw translation)
 *   - RuntimeEventTranslator  (OpenClaw → NeedsOps translation)
 *   - DB persistence of execution sessions and events
 *
 * Architecture rules enforced here:
 *   - NeedsOps always owns tenantId — it is never derived from runtime responses
 *   - All runtime interactions are audited in execution_events
 *   - Tenant boundaries are checked before processing any runtime event
 *   - The engine never exposes broker credentials to callers
 */

import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db, executionSessionsTable, executionEventsTable, tasksTable } from "@workspace/db";
import type {
  ExecutionEngine,
  ExecutionPackage,
  ExecutionSessionInfo,
  RuntimeHealth,
  RuntimeCapabilities,
  RuntimeEvent,
  SubmissionResult,
} from "@workspace/agent-runtime";
import type { ExecutionStatus } from "@workspace/agent-runtime";
import { RuntimeBrokerClient } from "./runtimeBrokerClient.js";
import type { OpenClawConfig } from "./config.js";
import { isOpenClawConfigured } from "./config.js";
import { translateToOpenClawPackage, getStatusMessage } from "./executionPackageTranslator.js";
import {
  translateOpenClawEvent,
  resolveStatusTransition,
  resolveTaskStateUpdate,
  isTerminalStatus,
  validateOpenClawEvent,
} from "./runtimeEventTranslator.js";
import type { OpenClawWebhookEvent } from "./types.js";

// ─── OpenClaw Execution Engine ────────────────────────────────────────────────

export class OpenClawExecutionEngine implements ExecutionEngine {
  readonly runtimeName = "openclaw";

  private readonly config: OpenClawConfig;
  private readonly brokerClient: RuntimeBrokerClient;

  constructor(config: OpenClawConfig) {
    this.config = config;
    this.brokerClient = new RuntimeBrokerClient(config);
  }

  // ─── Health and capabilities ───────────────────────────────────────────────

  async getHealth(): Promise<RuntimeHealth> {
    if (!isOpenClawConfigured(this.config)) {
      return {
        status: "not_connected",
        version: "unknown",
        activeExecutions: 0,
        queuedExecutions: 0,
        failedExecutions: 0,
        lastHeartbeatAt: null,
        connectedAt: null,
        capabilities: null,
        message: "OpenClaw Runtime not connected.",
      };
    }

    const health = await this.brokerClient.getHealth();

    if (!health) {
      return {
        status: "unavailable",
        version: "unknown",
        activeExecutions: 0,
        queuedExecutions: 0,
        failedExecutions: 0,
        lastHeartbeatAt: this.brokerClient.connectionStatus.lastHealthCheckAt,
        connectedAt: null,
        capabilities: null,
        message: "OpenClaw Runtime is unreachable.",
      };
    }

    return {
      status: health.status,
      version: health.version,
      activeExecutions: health.activeExecutions,
      queuedExecutions: health.queuedExecutions,
      failedExecutions: health.failedExecutions,
      lastHeartbeatAt: health.lastHeartbeatAt,
      connectedAt: health.connectedAt,
      capabilities: {
        name: "OpenClaw",
        version: health.version,
        supportedChannels: health.capabilities.supportedChannels as Parameters<typeof this.getCapabilities>[0] extends undefined ? never[] : any[],
        supportedToolCategories: health.capabilities.supportedToolCategories,
        maxConcurrentExecutions: health.capabilities.maxConcurrentExecutions,
      },
    };
  }

  async getCapabilities(): Promise<RuntimeCapabilities | null> {
    const health = await this.getHealth();
    return health.capabilities;
  }

  // ─── Execution submission ──────────────────────────────────────────────────

  async submitExecution(pkg: ExecutionPackage): Promise<SubmissionResult> {
    if (!isOpenClawConfigured(this.config)) {
      throw Object.assign(
        new Error("OpenClaw runtime is not configured. Set OPENCLAW_RUNTIME_URL to enable."),
        { code: "RUNTIME_NOT_CONFIGURED" },
      );
    }

    // 1. Create execution session record (status: pending)
    const sessionId = pkg.executionId;
    const now = new Date();

    await db.insert(executionSessionsTable).values({
      id: sessionId,
      taskId: pkg.taskId,
      organizationId: pkg.tenantId,
      runtimeName: this.runtimeName,
      currentStatus: "pending",
      executionPackage: pkg as unknown as Record<string, unknown>,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing(); // idempotent if session already exists

    // 2. Translate to OpenClaw wire format
    const openClawPkg = translateToOpenClawPackage(pkg, this.config);

    // 3. Record submission event
    await this.persistEvent({
      executionSessionId: sessionId,
      organizationId: pkg.tenantId,
      eventType: "execution.submitted",
      eventSource: "platform",
      payload: { submittedAt: now.toISOString() },
    });

    // 4. Submit to broker
    await db
      .update(executionSessionsTable)
      .set({ currentStatus: "submitted", submittedAt: now, updatedAt: now })
      .where(eq(executionSessionsTable.id, sessionId));

    let brokerResponse;
    try {
      brokerResponse = await this.brokerClient.submitExecution(openClawPkg);
    } catch (err) {
      // Mark session as failed and rethrow
      await db
        .update(executionSessionsTable)
        .set({
          currentStatus: "failed",
          errorMessage: (err as Error).message,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(executionSessionsTable.id, sessionId));

      await this.persistEvent({
        executionSessionId: sessionId,
        organizationId: pkg.tenantId,
        eventType: "execution.failed",
        eventSource: "platform",
        payload: { error: (err as Error).message },
      });

      throw err;
    }

    // 5. Handle broker response
    if (brokerResponse.status === "rejected") {
      await db
        .update(executionSessionsTable)
        .set({
          currentStatus: "failed",
          errorMessage: brokerResponse.reason ?? "Runtime rejected the execution package",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(executionSessionsTable.id, sessionId));

      await this.persistEvent({
        executionSessionId: sessionId,
        organizationId: pkg.tenantId,
        eventType: "execution.failed",
        eventSource: "openclaw",
        payload: { reason: brokerResponse.reason, status: "rejected" },
      });

      return {
        outcome: "rejected",
        runtimeExecutionId: null,
        rejectionReason: brokerResponse.reason,
      };
    }

    // accepted or queued
    const newStatus = brokerResponse.status === "accepted" ? "accepted" : "submitted";
    await db
      .update(executionSessionsTable)
      .set({
        runtimeExecutionId: brokerResponse.runtimeExecutionId,
        currentStatus: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(executionSessionsTable.id, sessionId));

    await this.persistEvent({
      executionSessionId: sessionId,
      organizationId: pkg.tenantId,
      eventType: "execution.accepted",
      eventSource: "openclaw",
      payload: {
        runtimeExecutionId: brokerResponse.runtimeExecutionId,
        status: brokerResponse.status,
        estimatedStartAt: brokerResponse.estimatedStartAt,
      },
    });

    return {
      outcome: brokerResponse.status,
      runtimeExecutionId: brokerResponse.runtimeExecutionId,
      estimatedStartAt: brokerResponse.estimatedStartAt,
    };
  }

  // ─── Execution control ─────────────────────────────────────────────────────

  async cancelExecution(executionId: string, tenantId: string): Promise<void> {
    await this.verifySessionBelongsToTenant(executionId, tenantId);
    await this.persistEvent({
      executionSessionId: executionId,
      organizationId: tenantId,
      eventType: "execution.cancel_requested",
      eventSource: "platform",
      payload: { requestedAt: new Date().toISOString() },
    });
    await this.brokerClient.cancelExecution(executionId, tenantId);
  }

  async pauseExecution(executionId: string, tenantId: string): Promise<void> {
    await this.verifySessionBelongsToTenant(executionId, tenantId);
    await this.persistEvent({
      executionSessionId: executionId,
      organizationId: tenantId,
      eventType: "execution.pause_requested",
      eventSource: "platform",
      payload: { requestedAt: new Date().toISOString() },
    });
    await this.brokerClient.pauseExecution(executionId, tenantId);
  }

  async resumeExecution(executionId: string, tenantId: string): Promise<void> {
    await this.verifySessionBelongsToTenant(executionId, tenantId);
    await this.persistEvent({
      executionSessionId: executionId,
      organizationId: tenantId,
      eventType: "execution.resume_requested",
      eventSource: "platform",
      payload: { requestedAt: new Date().toISOString() },
    });
    await this.brokerClient.resumeExecution(executionId, tenantId);
  }

  // ─── Execution status ──────────────────────────────────────────────────────

  async getExecutionStatus(
    executionId: string,
    tenantId: string,
  ): Promise<ExecutionSessionInfo | null> {
    const [session] = await db
      .select()
      .from(executionSessionsTable)
      .where(
        and(
          eq(executionSessionsTable.id, executionId),
          eq(executionSessionsTable.organizationId, tenantId),
        ),
      )
      .limit(1);

    if (!session) return null;

    const status = session.currentStatus as ExecutionStatus;

    // If session is not terminal, optionally poll broker for latest status
    if (!isTerminalStatus(status) && isOpenClawConfigured(this.config)) {
      const brokerStatus = await this.brokerClient.getExecutionStatus(executionId, tenantId);
      if (brokerStatus && brokerStatus.status !== session.currentStatus) {
        // Broker has a newer status — update our record
        await db
          .update(executionSessionsTable)
          .set({
            currentStatus: brokerStatus.status,
            startedAt: brokerStatus.startedAt ? new Date(brokerStatus.startedAt) : undefined,
            completedAt: brokerStatus.completedAt ? new Date(brokerStatus.completedAt) : undefined,
            errorMessage: brokerStatus.errorMessage ?? undefined,
            updatedAt: new Date(),
          })
          .where(eq(executionSessionsTable.id, executionId));

        return {
          executionId,
          runtimeExecutionId: session.runtimeExecutionId,
          status: brokerStatus.status as ExecutionStatus,
          statusMessage: getStatusMessage(brokerStatus.status),
          submittedAt: session.submittedAt?.toISOString() ?? null,
          startedAt: brokerStatus.startedAt,
          completedAt: brokerStatus.completedAt,
          errorMessage: brokerStatus.errorMessage,
        };
      }
    }

    return {
      executionId,
      runtimeExecutionId: session.runtimeExecutionId,
      status,
      statusMessage: getStatusMessage(status),
      submittedAt: session.submittedAt?.toISOString() ?? null,
      startedAt: session.startedAt?.toISOString() ?? null,
      completedAt: session.completedAt?.toISOString() ?? null,
      errorMessage: session.errorMessage,
    };
  }

  // ─── Inbound event processing ──────────────────────────────────────────────

  async processInboundEvent(event: RuntimeEvent): Promise<void> {
    // 1. Verify tenant boundary
    const [session] = await db
      .select()
      .from(executionSessionsTable)
      .where(
        and(
          eq(executionSessionsTable.id, event.executionId),
          eq(executionSessionsTable.organizationId, event.tenantId),
        ),
      )
      .limit(1);

    if (!session) {
      throw Object.assign(
        new Error(
          `Rejected runtime event: execution session ${event.executionId} not found for tenant ${event.tenantId}`,
        ),
        { code: "TENANT_ISOLATION_VIOLATION" },
      );
    }

    // 2. Persist the event
    await this.persistEvent({
      executionSessionId: event.executionId,
      organizationId: event.tenantId,
      eventType: event.eventType,
      eventSource: "openclaw",
      payload: {
        ...event.payload,
        runtimeExecutionId: event.runtimeExecutionId,
        occurredAt: event.occurredAt,
      },
    });

    // 3. Resolve status transition
    const currentStatus = session.currentStatus as ExecutionStatus;
    const newStatus = resolveStatusTransition(event, currentStatus);

    if (newStatus) {
      const isTerminal = isTerminalStatus(newStatus);
      await db
        .update(executionSessionsTable)
        .set({
          currentStatus: newStatus,
          ...(newStatus === "running" && !session.startedAt
            ? { startedAt: new Date(event.occurredAt) }
            : {}),
          ...(isTerminal ? { completedAt: new Date(event.occurredAt) } : {}),
          ...(newStatus === "failed"
            ? { errorMessage: (event.payload.errorMessage as string) ?? "Runtime execution failed" }
            : {}),
          ...(event.runtimeExecutionId && !session.runtimeExecutionId
            ? { runtimeExecutionId: event.runtimeExecutionId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(executionSessionsTable.id, event.executionId));

      // 4. Propagate terminal states to the task
      const taskStateUpdate = resolveTaskStateUpdate(newStatus);
      if (taskStateUpdate && session.taskId) {
        await db
          .update(tasksTable)
          .set({
            currentState: taskStateUpdate as Parameters<typeof tasksTable.currentState.notNull>[0],
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tasksTable.id, session.taskId),
              eq(tasksTable.organizationId, event.tenantId),
            ),
          );
      }
    }

    // 5. Mark event as applied
    await db
      .update(executionEventsTable)
      .set({ isApplied: true })
      .where(
        and(
          eq(executionEventsTable.executionSessionId, event.executionId),
          eq(executionEventsTable.organizationId, event.tenantId),
        ),
      );
  }

  // ─── Webhook event processing (from raw HTTP body) ────────────────────────

  /**
   * Process a raw OpenClaw webhook event from the HTTP request body.
   * Verifies HMAC signature, translates to NeedsOps format, and delegates
   * to processInboundEvent.
   */
  async processWebhookEvent(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    parsedBody: OpenClawWebhookEvent,
  ): Promise<void> {
    // 1. Verify HMAC signature
    const signatureValid = this.brokerClient.verifyWebhookSignature(rawBody, signatureHeader);
    if (!signatureValid) {
      throw Object.assign(
        new Error("OpenClaw webhook signature verification failed"),
        { code: "INVALID_SIGNATURE" },
      );
    }

    // 2. Validate event shape
    validateOpenClawEvent(parsedBody);

    // 3. Translate to NeedsOps format
    const needsOpsEvent = translateOpenClawEvent(parsedBody);

    // 4. Process
    await this.processInboundEvent(needsOpsEvent);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private async verifySessionBelongsToTenant(
    executionId: string,
    tenantId: string,
  ): Promise<void> {
    const [session] = await db
      .select({ id: executionSessionsTable.id })
      .from(executionSessionsTable)
      .where(
        and(
          eq(executionSessionsTable.id, executionId),
          eq(executionSessionsTable.organizationId, tenantId),
        ),
      )
      .limit(1);

    if (!session) {
      throw Object.assign(
        new Error(`Execution session ${executionId} not found for tenant ${tenantId}`),
        { code: "RESOURCE_NOT_FOUND" },
      );
    }
  }

  private async persistEvent(event: {
    executionSessionId: string;
    organizationId: string;
    eventType: string;
    eventSource: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await db.insert(executionEventsTable).values({
      id: randomUUID(),
      executionSessionId: event.executionSessionId,
      organizationId: event.organizationId,
      eventType: event.eventType,
      eventSource: event.eventSource,
      payload: event.payload,
      isApplied: false,
      occurredAt: new Date(),
    });
  }

  // ─── Broker access (for platform monitoring) ───────────────────────────────

  get brokerConnectionStatus() {
    return this.brokerClient.connectionStatus;
  }

  startHeartbeat(): void {
    this.brokerClient.startHeartbeat();
  }

  stopHeartbeat(): void {
    this.brokerClient.stopHeartbeat();
  }
}
