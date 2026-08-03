/**
 * Knowledge Hub — Specialist Training Status Service (internal module name)
 * Customer-facing wording: "Train this specialist", "Add knowledge",
 *   "Choose Organisation Library sources", "Review what this specialist can use"
 *
 * Manages the per-specialist Knowledge Hub integration readiness state machine.
 * Tracks whether a specialist has been configured with the right Organisation
 * Library sources, tested, and approved for live use.
 *
 * Rules:
 *   - One record per (organizationId, specialistId) — upserted on first access
 *   - Only owner/admin may approve a specialist for 'ready' status
 *   - Valid transitions are enforced (see TRAINING_STATUS_TRANSITIONS)
 *   - 'needs_attention' and 'suspended' are reachable from any status
 *   - Default initial status is 'not_started'
 *
 * WEB-FIRST:
 *   All training actions are available via API without desktop connector.
 *   Desktop connector access is an additional optional capability.
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  specialistTrainingStatusTable,
  TRAINING_STATUSES,
  TRAINING_STATUS_TRANSITIONS,
  type SpecialistTrainingStatus,
  type TrainingStatus,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logOrgEvent } from "./auditService.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class TrainingStatusError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "TrainingStatusError";
    this.code = code;
    Object.setPrototypeOf(this, TrainingStatusError.prototype);
  }
}

// ─── Get or create ────────────────────────────────────────────────────────────

export async function getOrCreateTrainingStatus(
  organizationId: string,
  specialistId: string,
): Promise<SpecialistTrainingStatus> {
  const [existing] = await db
    .select()
    .from(specialistTrainingStatusTable)
    .where(
      and(
        eq(specialistTrainingStatusTable.organizationId, organizationId),
        eq(specialistTrainingStatusTable.specialistId, specialistId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  // Create default not_started record
  const [created] = await db
    .insert(specialistTrainingStatusTable)
    .values({
      id: randomUUID(),
      organizationId,
      specialistId,
      status: "not_started",
      configurationComplete: false,
      knowledgeSourcesApproved: false,
      retrievalTestPassed: false,
      sampleTaskPassed: false,
    })
    .returning();

  return created!;
}

export async function getTrainingStatus(
  organizationId: string,
  specialistId: string,
): Promise<SpecialistTrainingStatus | null> {
  const [row] = await db
    .select()
    .from(specialistTrainingStatusTable)
    .where(
      and(
        eq(specialistTrainingStatusTable.organizationId, organizationId),
        eq(specialistTrainingStatusTable.specialistId, specialistId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listAllTrainingStatuses(
  organizationId: string,
): Promise<SpecialistTrainingStatus[]> {
  return db
    .select()
    .from(specialistTrainingStatusTable)
    .where(eq(specialistTrainingStatusTable.organizationId, organizationId));
}

// ─── Transition ───────────────────────────────────────────────────────────────

export interface TransitionStatusInput {
  organizationId: string;
  specialistId: string;
  newStatus: TrainingStatus;
  actorUserId: string;
  actorRole: string;
  notes?: string;
  /** Flags to update atomically with the transition */
  flags?: {
    configurationComplete?: boolean;
    knowledgeSourcesApproved?: boolean;
    retrievalTestPassed?: boolean;
    sampleTaskPassed?: boolean;
  };
}

/**
 * Transition a specialist's training status.
 *
 * Enforces:
 *   - Valid status value
 *   - Valid transition from current status
 *   - 'ready' status requires owner or admin role
 */
export async function transitionTrainingStatus(
  input: TransitionStatusInput,
): Promise<SpecialistTrainingStatus> {
  if (!TRAINING_STATUSES.includes(input.newStatus)) {
    throw new TrainingStatusError(
      `Invalid status "${input.newStatus}". Must be one of: ${TRAINING_STATUSES.join(", ")}`,
      "INVALID_STATUS",
    );
  }

  const record = await getOrCreateTrainingStatus(input.organizationId, input.specialistId);
  const currentStatus = record.status as TrainingStatus;

  // Check if transition is valid
  const allowed = TRAINING_STATUS_TRANSITIONS[currentStatus] ?? [];
  const isEmergencyTransition =
    input.newStatus === "needs_attention" || input.newStatus === "suspended";

  if (!isEmergencyTransition && !allowed.includes(input.newStatus)) {
    throw new TrainingStatusError(
      `Cannot transition from "${currentStatus}" to "${input.newStatus}". ` +
        `Allowed from "${currentStatus}": ${allowed.join(", ")}`,
      "INVALID_TRANSITION",
    );
  }

  // Only owner/admin may approve to 'ready'
  if (input.newStatus === "ready") {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new TrainingStatusError(
        "Only an organisation owner or admin may approve a specialist for 'ready' status.",
        "INSUFFICIENT_ROLE",
      );
    }
  }

  // Suspension also restricted to owner/admin
  if (input.newStatus === "suspended") {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new TrainingStatusError(
        "Only an organisation owner or admin may suspend specialist training.",
        "INSUFFICIENT_ROLE",
      );
    }
  }

  const updateFields: Partial<SpecialistTrainingStatus> = {
    status: input.newStatus,
    updatedAt: new Date(),
  };

  if (input.notes !== undefined) updateFields.notes = input.notes;
  if (input.flags?.configurationComplete !== undefined)
    updateFields.configurationComplete = input.flags.configurationComplete;
  if (input.flags?.knowledgeSourcesApproved !== undefined)
    updateFields.knowledgeSourcesApproved = input.flags.knowledgeSourcesApproved;
  if (input.flags?.retrievalTestPassed !== undefined)
    updateFields.retrievalTestPassed = input.flags.retrievalTestPassed;
  if (input.flags?.sampleTaskPassed !== undefined)
    updateFields.sampleTaskPassed = input.flags.sampleTaskPassed;

  // Set approval metadata when transitioning to ready
  if (input.newStatus === "ready") {
    updateFields.approvedByUserId = input.actorUserId;
    updateFields.approvedAt = new Date();
  }

  const [updated] = await db
    .update(specialistTrainingStatusTable)
    .set(updateFields)
    .where(
      and(
        eq(specialistTrainingStatusTable.organizationId, input.organizationId),
        eq(specialistTrainingStatusTable.specialistId, input.specialistId),
      ),
    )
    .returning();

  logOrgEvent({
    eventType: "knowledge.specialist_training.status_changed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceType: "specialist_training_status",
    resourceId: record.id,
    metadata: {
      specialistId: input.specialistId,
      previousStatus: currentStatus,
      newStatus: input.newStatus,
      notes: input.notes?.slice(0, 500),
    },
  }).catch(() => {});

  return updated!;
}

// ─── Update flags only ────────────────────────────────────────────────────────

export interface UpdateTrainingFlagsInput {
  organizationId: string;
  specialistId: string;
  actorUserId: string;
  configurationComplete?: boolean;
  knowledgeSourcesApproved?: boolean;
  retrievalTestPassed?: boolean;
  sampleTaskPassed?: boolean;
  notes?: string;
}

export async function updateTrainingFlags(
  input: UpdateTrainingFlagsInput,
): Promise<SpecialistTrainingStatus> {
  const record = await getOrCreateTrainingStatus(input.organizationId, input.specialistId);

  const updates: Partial<SpecialistTrainingStatus> = { updatedAt: new Date() };
  if (input.configurationComplete !== undefined)
    updates.configurationComplete = input.configurationComplete;
  if (input.knowledgeSourcesApproved !== undefined)
    updates.knowledgeSourcesApproved = input.knowledgeSourcesApproved;
  if (input.retrievalTestPassed !== undefined)
    updates.retrievalTestPassed = input.retrievalTestPassed;
  if (input.sampleTaskPassed !== undefined) updates.sampleTaskPassed = input.sampleTaskPassed;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (input.retrievalTestPassed) updates.lastTestedAt = new Date();

  const [updated] = await db
    .update(specialistTrainingStatusTable)
    .set(updates)
    .where(
      and(
        eq(specialistTrainingStatusTable.organizationId, input.organizationId),
        eq(specialistTrainingStatusTable.specialistId, input.specialistId),
      ),
    )
    .returning();

  return updated ?? record;
}
