/**
 * taskParticipantService
 *
 * Binds task execution to explicit participant subjects. Only subject
 * participants drive participant-document retrieval.
 */

import { randomUUID } from "crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  membershipsTable,
  participantsTable,
  taskParticipantsTable,
  usersTable,
} from "@workspace/db";

export type TaskParticipantRole = "subject" | "related" | "guardian_context";

export interface ParticipantResolutionInput {
  organizationId: string;
  title: string;
  description?: string;
  explicitSubjectParticipantIds?: string[];
}

export interface ParticipantResolutionCandidate {
  id: string;
  displayName: string;
  preferredName: string | null;
  externalParticipantId: string | null;
}

export interface ParticipantResolutionResult {
  status: "not_applicable" | "resolved" | "confirmation_required" | "ambiguous" | "unresolved";
  subjectParticipantIds: string[];
  candidates: ParticipantResolutionCandidate[];
  staffConflicts: string[];
  clarifyingQuestion?: string;
}

export interface PersistTaskParticipantsInput {
  organizationId: string;
  taskId: string;
  subjectParticipantIds?: string[];
  relatedParticipantIds?: string[];
  guardianContextParticipantIds?: string[];
}

export interface TaskParticipantBinding {
  role: TaskParticipantRole;
  participantId: string;
}

const PARTICIPANT_SPECIFIC_TERMS = /\b(care plan|risk assessment|behaviour support plan|bsp|cbsp|intake|home safety|participant|client|resident|person)\b/i;
const NAME_AFTER_FOR_PATTERN = /\bfor\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2})\b/i;

function normalizeIdList(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).map(id => id.trim()).filter(Boolean)));
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsName(text: string, name: string): boolean {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(text);
}

function isParticipantSpecificRequest(title: string, description?: string): boolean {
  return PARTICIPANT_SPECIFIC_TERMS.test(`${title}\n${description ?? ""}`);
}

export function deriveRetrievalEntityIdsFromTaskParticipants(
  bindings: TaskParticipantBinding[],
): string[] {
  return Array.from(new Set(
    bindings
      .filter(binding => binding.role === "subject")
      .map(binding => binding.participantId)
      .filter(Boolean),
  ));
}

export async function assertParticipantsBelongToOrganisation(
  organizationId: string,
  participantIds: string[],
  client: typeof db = db,
): Promise<void> {
  const ids = normalizeIdList(participantIds);
  if (ids.length === 0) return;

  const rows = await client
    .select({ id: participantsTable.id })
    .from(participantsTable)
    .where(and(
      eq(participantsTable.organizationId, organizationId),
      isNull(participantsTable.deletedAt),
      inArray(participantsTable.id, ids),
    ));

  const found = new Set(rows.map(row => row.id));
  const missing = ids.filter(id => !found.has(id));
  if (missing.length > 0) {
    throw Object.assign(
      new Error("Participant scope must reference an existing participant in this organisation."),
      { code: "INVALID_PARTICIPANT_SCOPE", status: 400, missingParticipantIds: missing },
    );
  }
}

export async function resolveSubjectParticipantForTaskRequest(
  input: ParticipantResolutionInput,
): Promise<ParticipantResolutionResult> {
  const explicitIds = normalizeIdList(input.explicitSubjectParticipantIds);
  if (explicitIds.length > 0) {
    if (explicitIds.length > 1) {
      return {
        status: "ambiguous",
        subjectParticipantIds: [],
        candidates: [],
        staffConflicts: [],
        clarifyingQuestion: "Please select exactly one subject participant for this task.",
      };
    }
    await assertParticipantsBelongToOrganisation(input.organizationId, explicitIds);
    return {
      status: "resolved",
      subjectParticipantIds: explicitIds,
      candidates: [],
      staffConflicts: [],
    };
  }

  if (!isParticipantSpecificRequest(input.title, input.description)) {
    return {
      status: "not_applicable",
      subjectParticipantIds: [],
      candidates: [],
      staffConflicts: [],
    };
  }

  const text = `${input.title}\n${input.description ?? ""}`;
  const normalizedText = normalizeName(text);
  const [participants, staffRows] = await Promise.all([
    db
      .select({
        id: participantsTable.id,
        displayName: participantsTable.displayName,
        preferredName: participantsTable.preferredName,
        externalParticipantId: participantsTable.externalParticipantId,
      })
      .from(participantsTable)
      .where(and(
        eq(participantsTable.organizationId, input.organizationId),
        eq(participantsTable.status, "active"),
        isNull(participantsTable.deletedAt),
      )),
    db
      .select({
        displayName: usersTable.displayName,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(membershipsTable)
      .innerJoin(usersTable, eq(usersTable.id, membershipsTable.userId))
      .where(and(
        eq(membershipsTable.organizationId, input.organizationId),
        eq(membershipsTable.status, "active"),
      )),
  ]);

  const candidates = participants.filter(participant => {
    const names = [
      participant.displayName,
      participant.preferredName,
      participant.externalParticipantId,
    ].map(normalizeName).filter(Boolean);
    return names.some(name => containsName(normalizedText, name));
  });

  const inferredName = normalizeName(text.match(NAME_AFTER_FOR_PATTERN)?.[1]);
  const staffConflicts = staffRows
    .map(staff => staff.displayName ?? ([staff.firstName, staff.lastName].filter(Boolean).join(" ") || staff.email))
    .filter((name): name is string => Boolean(name))
    .filter(name => {
      const normalizedStaff = normalizeName(name);
      if (!normalizedStaff) return false;
      if (inferredName && containsName(normalizedStaff, inferredName)) return true;
      return candidates.some(candidate =>
        containsName(normalizedStaff, normalizeName(candidate.displayName)) ||
        containsName(normalizedStaff, normalizeName(candidate.preferredName)),
      );
    });

  if (candidates.length === 1 && staffConflicts.length === 0) {
    return {
      status: "confirmation_required",
      subjectParticipantIds: [],
      candidates,
      staffConflicts,
      clarifyingQuestion: "Please confirm this is the participant for the task before I retrieve participant documents.",
    };
  }

  if (candidates.length > 1 || staffConflicts.length > 0) {
    return {
      status: "ambiguous",
      subjectParticipantIds: [],
      candidates,
      staffConflicts,
      clarifyingQuestion: "Please confirm which participant this task is for before I retrieve participant documents.",
    };
  }

  if (inferredName) {
    return {
      status: "unresolved",
      subjectParticipantIds: [],
      candidates: [],
      staffConflicts: [],
      clarifyingQuestion: `I could not find a participant matching "${inferredName}". Please select the participant before I retrieve participant documents.`,
    };
  }

  return {
    status: "not_applicable",
    subjectParticipantIds: [],
    candidates: [],
    staffConflicts: [],
  };
}

export async function persistTaskParticipants(
  input: PersistTaskParticipantsInput,
  client: typeof db = db,
): Promise<void> {
  const subjectIds = normalizeIdList(input.subjectParticipantIds);
  const relatedIds = normalizeIdList(input.relatedParticipantIds);
  const guardianIds = normalizeIdList(input.guardianContextParticipantIds);

  if (subjectIds.length > 1) {
    throw Object.assign(
      new Error("A single-subject task can only have one subject participant."),
      { code: "AMBIGUOUS_PARTICIPANT_SUBJECT", status: 409 },
    );
  }

  await assertParticipantsBelongToOrganisation(input.organizationId, [
    ...subjectIds,
    ...relatedIds,
    ...guardianIds,
  ], client);

  const rows = [
    ...subjectIds.map(participantId => ({ participantId, role: "subject" as const })),
    ...relatedIds.map(participantId => ({ participantId, role: "related" as const })),
    ...guardianIds.map(participantId => ({ participantId, role: "guardian_context" as const })),
  ].map(binding => ({
    id: randomUUID(),
    taskId: input.taskId,
    organizationId: input.organizationId,
    participantId: binding.participantId,
    role: binding.role,
  }));

  if (rows.length === 0) return;

  await client
    .insert(taskParticipantsTable)
    .values(rows)
    .onConflictDoNothing();
}

export async function getTaskParticipantBindings(
  organizationId: string,
  taskId: string,
): Promise<TaskParticipantBinding[]> {
  const rows = await db
    .select({
      role: taskParticipantsTable.role,
      participantId: taskParticipantsTable.participantId,
    })
    .from(taskParticipantsTable)
    .where(and(
      eq(taskParticipantsTable.organizationId, organizationId),
      eq(taskParticipantsTable.taskId, taskId),
    ));

  return rows.map(row => ({
    role: row.role as TaskParticipantRole,
    participantId: row.participantId,
  }));
}

export async function getRetrievalSubjectParticipantIdsForTask(
  organizationId: string,
  taskId: string,
): Promise<string[]> {
  return deriveRetrievalEntityIdsFromTaskParticipants(
    await getTaskParticipantBindings(organizationId, taskId),
  );
}
