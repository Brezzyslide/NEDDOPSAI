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
  withSystemTenantContext,
  usersTable,
} from "@workspace/db";
import {
  normalizeParticipantName,
  participantNameSimilarity,
  PICKER_FUZZY_THRESHOLD,
} from "./participantMatchingService.js";

export type TaskParticipantRole = "subject" | "related" | "guardian_context";
const SELECTABLE_PARTICIPANT_STATUSES = ["active", "inactive"] as const;
type DbClient = typeof db;

export interface ParticipantResolutionInput {
  organizationId: string;
  title: string;
  description?: string;
  sourceUserRequest?: string;
  explicitSubjectParticipantIds?: string[];
}

export interface ParticipantResolutionCandidate {
  id: string;
  displayName: string;
  preferredName: string | null;
  externalParticipantId: string | null;
  matchType?: string;
  isSuggestion?: boolean;
  similarity?: number;
}

export interface ParticipantResolutionResult {
  status: "not_applicable" | "resolved" | "confirmation_required" | "ambiguous" | "unresolved";
  subjectParticipantIds: string[];
  candidates: ParticipantResolutionCandidate[];
  staffConflicts: string[];
  requestedName?: string;
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

const PERSON_REFERENCE_TERMS = /\b(participant|client|resident|person)\b/i;
const EXPLICIT_TEMPLATE_TERMS = /\b(template|standard|reusable|blank)\b/i;
const NAME_AFTER_FOR_PATTERN = /\bfor[ \t]+(?:participant[ \t]+|client[ \t]+|resident[ \t]+|person[ \t]+)?([a-z][a-z'-]*(?:[ \t]+[a-z][a-z'-]*){0,4})\b/i;
const POSSESSIVE_PLAN_PATTERN = /\b([a-z][a-z'-]*(?:[ \t]+[a-z][a-z'-]*){0,4})['’]s[ \t]+(?:care[ \t]+plan|plan|risk[ \t]+assessment|behaviour[ \t]+support[ \t]+plan|bsp|cbsp)\b/i;
const NAME_STOP_WORDS = new Set([
  "a",
  "about",
  "and",
  "anyone",
  "based",
  "because",
  "but",
  "client",
  "clients",
  "complete",
  "covering",
  "create",
  "develop",
  "draft",
  "everyone",
  "for",
  "from",
  "her",
  "him",
  "including",
  "me",
  "my",
  "myself",
  "our",
  "ours",
  "participant",
  "participants",
  "people",
  "person",
  "prepare",
  "regarding",
  "resident",
  "residents",
  "review",
  "someone",
  "staff",
  "team",
  "the",
  "them",
  "they",
  "to",
  "update",
  "us",
  "using",
  "when",
  "where",
  "while",
  "with",
  "without",
]);
const LEADING_NAME_STOP_WORDS = new Set([
  "complete",
  "create",
  "develop",
  "draft",
  "prepare",
  "review",
  "update",
]);
const STOP_LISTED_AFTER_FOR_PATTERN = /\bfor[ \t]+(?:a[ \t]+|the[ \t]+)?(me|us|myself|my|our|ours|them|they|him|her|someone|anyone|everyone|staff|team|client|clients|participant|participants|resident|residents|person|people)\b/i;

function normalizeIdList(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).map(id => id.trim()).filter(Boolean)));
}

function normalizeName(value: string | null | undefined): string {
  return normalizeParticipantName(value);
}

function containsName(text: string, name: string): boolean {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(text);
}

function getParticipantResolutionText(input: {
  title: string;
  sourceUserRequest?: string;
}): string {
  return input.sourceUserRequest?.trim() || input.title.trim();
}

function shouldRunParticipantResolution(input: {
  title: string;
  sourceUserRequest?: string;
  inferredName: string;
}): boolean {
  const text = getParticipantResolutionText(input);
  if (EXPLICIT_TEMPLATE_TERMS.test(text)) return false;
  if (input.inferredName) return true;
  if (STOP_LISTED_AFTER_FOR_PATTERN.test(text)) return false;
  return PERSON_REFERENCE_TERMS.test(text);
}

function truncateCandidateName(value: string | undefined): string {
  const raw = (value ?? "")
    .split(/[.,;:!?()[\]{}]/)[0]
    ?.trim() ?? "";
  const tokens = raw
    .split(/[ \t]+/)
    .map(token => token.replace(/^['"“”‘’]+|['"“”‘’]+$/g, ""))
    .filter(Boolean);
  while (tokens.length > 0 && LEADING_NAME_STOP_WORDS.has(tokens[0]!.toLowerCase())) {
    tokens.shift();
  }
  const nameTokens: string[] = [];
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (NAME_STOP_WORDS.has(normalized)) break;
    nameTokens.push(token);
    if (nameTokens.length >= 3) break;
  }
  return nameTokens.join(" ");
}

export function extractRequestedParticipantName(input: {
  title: string;
  description?: string;
  sourceUserRequest?: string;
}): string {
  const sourceText = (input.sourceUserRequest?.trim() || input.title.trim())
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of sourceText) {
    const possessive = truncateCandidateName(line.match(POSSESSIVE_PLAN_PATTERN)?.[1]);
    if (possessive) return normalizeName(possessive);
  }

  for (const line of sourceText) {
    const afterFor = truncateCandidateName(line.match(NAME_AFTER_FOR_PATTERN)?.[1]);
    if (afterFor) return normalizeName(afterFor);
  }

  return "";
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

function withTaskParticipantTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "task_participant_service", purpose },
    fn,
  );
}

export async function assertParticipantsBelongToOrganisation(
  organizationId: string,
  participantIds: string[],
  client: DbClient = db,
): Promise<void> {
  const ids = normalizeIdList(participantIds);
  if (ids.length === 0) return;

  const rows = await client
    .select({ id: participantsTable.id })
    .from(participantsTable)
    .where(and(
      eq(participantsTable.organizationId, organizationId),
      isNull(participantsTable.deletedAt),
      inArray(participantsTable.status, SELECTABLE_PARTICIPANT_STATUSES),
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
  return withTaskParticipantTenant(input.organizationId, "task_participant.resolve_subject", async (client) => {
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
    await assertParticipantsBelongToOrganisation(input.organizationId, explicitIds, client);
    return {
      status: "resolved",
      subjectParticipantIds: explicitIds,
      candidates: [],
      staffConflicts: [],
    };
  }

  const inferredName = extractRequestedParticipantName({
    title: input.title,
    description: input.description,
    sourceUserRequest: input.sourceUserRequest,
  });

  if (!shouldRunParticipantResolution({
    title: input.title,
    sourceUserRequest: input.sourceUserRequest,
    inferredName,
  })) {
    return {
      status: "not_applicable",
      subjectParticipantIds: [],
      candidates: [],
      staffConflicts: [],
    };
  }

  const [participants, staffRows] = await Promise.all([
    client
      .select({
        id: participantsTable.id,
        displayName: participantsTable.displayName,
        preferredName: participantsTable.preferredName,
        externalParticipantId: participantsTable.externalParticipantId,
      })
      .from(participantsTable)
      .where(and(
        eq(participantsTable.organizationId, input.organizationId),
        inArray(participantsTable.status, SELECTABLE_PARTICIPANT_STATUSES),
        isNull(participantsTable.deletedAt),
      )),
    client
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

  const candidates = inferredName
    ? participants
        .map(participant => {
          const external = normalizeName(participant.externalParticipantId);
          const display = normalizeName(participant.displayName);
          const preferred = normalizeName(participant.preferredName);
          if (external === inferredName) {
            return { participant, matchType: "external_id_exact", isSuggestion: false, rank: 0, similarity: 1 };
          }
          if (display === inferredName) {
            return { participant, matchType: "display_name_exact", isSuggestion: false, rank: 1, similarity: 1 };
          }
          if (preferred === inferredName) {
            return { participant, matchType: "display_name_exact", isSuggestion: false, rank: 2, similarity: 1 };
          }
          const starts = display.startsWith(inferredName) || preferred.startsWith(inferredName);
          const contains = display.includes(inferredName) || preferred.includes(inferredName);
          const similarity = participantNameSimilarity(inferredName, participant);
          if (!starts && !contains && similarity < PICKER_FUZZY_THRESHOLD) return null;
          return {
            participant,
            matchType: "fuzzy_suggestion",
            isSuggestion: true,
            rank: starts ? 10 : contains ? 15 : 20,
            similarity: Number(similarity.toFixed(3)),
          };
        })
        .filter((match): match is {
          participant: typeof participants[number];
          matchType: string;
          isSuggestion: boolean;
          rank: number;
          similarity: number;
        } => Boolean(match))
        .sort((a, b) => a.rank - b.rank || a.participant.displayName.localeCompare(b.participant.displayName))
        .slice(0, 10)
        .map(match => ({
          id: match.participant.id,
          displayName: match.participant.displayName,
          preferredName: match.participant.preferredName,
          externalParticipantId: match.participant.externalParticipantId,
          matchType: match.matchType,
          isSuggestion: match.isSuggestion,
          similarity: match.similarity,
        }))
    : [];
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
      requestedName: inferredName || undefined,
      clarifyingQuestion: "Please confirm this is the participant for the task before I retrieve participant documents.",
    };
  }

  if (candidates.length > 1 || staffConflicts.length > 0) {
    return {
      status: "ambiguous",
      subjectParticipantIds: [],
      candidates,
      staffConflicts,
      requestedName: inferredName || undefined,
      clarifyingQuestion: "Please confirm which participant this task is for before I retrieve participant documents.",
    };
  }

  if (inferredName) {
    return {
      status: "unresolved",
      subjectParticipantIds: [],
      candidates: [],
      staffConflicts: [],
      requestedName: inferredName,
      clarifyingQuestion: `I could not find a participant matching "${inferredName}". Please select the participant before I retrieve participant documents.`,
    };
  }

  return {
    status: "unresolved",
    subjectParticipantIds: [],
    candidates: participants
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 10)
      .map(participant => ({
        id: participant.id,
        displayName: participant.displayName,
        preferredName: participant.preferredName,
        externalParticipantId: participant.externalParticipantId,
        matchType: "available_participant",
        isSuggestion: true,
      })),
    staffConflicts: [],
    clarifyingQuestion: "Please select or create the participant before I retrieve participant documents.",
  };
  });
}

export async function persistTaskParticipants(
  input: PersistTaskParticipantsInput,
  client: DbClient = db,
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
  return withTaskParticipantTenant(organizationId, "task_participant.bindings.get", async (client) => {
  const rows = await client
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
  });
}

export async function getRetrievalSubjectParticipantIdsForTask(
  organizationId: string,
  taskId: string,
): Promise<string[]> {
  return deriveRetrievalEntityIdsFromTaskParticipants(
    await getTaskParticipantBindings(organizationId, taskId),
  );
}
