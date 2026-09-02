import { randomUUID } from "crypto";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  knowledgeSourceScopesTable,
  knowledgeSourcesTable,
  participantsTable,
  taskParticipantsTable,
  type Participant,
} from "@workspace/db";
import { assignScope, getKnowledgeSource, removeScope } from "./knowledgeSourceService.js";
import {
  DUPLICATE_WARNING_THRESHOLD,
  participantNameSimilarity,
  PICKER_FUZZY_THRESHOLD,
  normalizeParticipantName,
} from "./participantMatchingService.js";

export type ParticipantStatus = "active" | "inactive" | "archived";
const PARTICIPANT_STATUSES: ParticipantStatus[] = ["active", "inactive", "archived"];

export interface ParticipantInput {
  displayName: string;
  preferredName?: string | null;
  externalParticipantId?: string | null;
  status?: ParticipantStatus;
}

export interface ParticipantSearchResult {
  participant: Participant;
  matchType: "external_id_exact" | "display_name_exact" | "fuzzy_suggestion";
  isSuggestion: boolean;
  rank: number;
  similarity?: number;
}

export interface ParticipantDuplicateWarning {
  participant: Participant;
  similarity: number;
}

export class ParticipantServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(value: unknown): ParticipantStatus {
  return PARTICIPANT_STATUSES.includes(value as ParticipantStatus)
    ? value as ParticipantStatus
    : "active";
}

function normalizeLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function normalizeOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(Math.trunc(parsed), 0);
}

function assertParticipantInput(input: ParticipantInput): Required<ParticipantInput> {
  const displayName = cleanText(input.displayName);
  if (!displayName || displayName.length < 2) {
    throw new ParticipantServiceError("displayName must be at least 2 characters.", "VALIDATION_ERROR");
  }
  return {
    displayName,
    preferredName: cleanText(input.preferredName),
    externalParticipantId: cleanText(input.externalParticipantId),
    status: normalizeStatus(input.status),
  };
}

export async function createParticipant(
  organizationId: string,
  input: ParticipantInput,
): Promise<Participant> {
  const values = assertParticipantInput(input);
  try {
    const [participant] = await db
      .insert(participantsTable)
      .values({
        id: randomUUID(),
        organizationId,
        displayName: values.displayName,
        preferredName: values.preferredName,
        externalParticipantId: values.externalParticipantId,
        status: values.status,
        updatedAt: new Date(),
      })
      .returning();
    return participant!;
  } catch (err) {
    if ((err as any)?.code === "23505") {
      throw new ParticipantServiceError(
        "A participant with this external participant ID already exists in this organisation.",
        "DUPLICATE_EXTERNAL_PARTICIPANT_ID",
      );
    }
    throw err;
  }
}

export async function listParticipants(input: {
  organizationId: string;
  status?: string;
  query?: string;
  limit?: unknown;
  offset?: unknown;
}): Promise<{ participants: Participant[]; pagination: { limit: number; offset: number } }> {
  const limit = normalizeLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  const filters = [
    eq(participantsTable.organizationId, input.organizationId),
    isNull(participantsTable.deletedAt),
  ];
  if (input.status && PARTICIPANT_STATUSES.includes(input.status as ParticipantStatus)) {
    filters.push(eq(participantsTable.status, input.status));
  }
  const query = cleanText(input.query);
  if (query) {
    const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
    filters.push(or(
      ilike(participantsTable.displayName, like),
      ilike(participantsTable.preferredName, like),
      ilike(participantsTable.externalParticipantId, like),
    )!);
  }

  const participants = await db
    .select()
    .from(participantsTable)
    .where(and(...filters))
    .orderBy(asc(participantsTable.displayName))
    .limit(limit)
    .offset(offset);

  return { participants, pagination: { limit, offset } };
}

export async function searchParticipants(
  organizationId: string,
  rawQuery: string,
  limitInput?: unknown,
): Promise<ParticipantSearchResult[]> {
  const query = cleanText(rawQuery);
  if (!query) return [];
  const limit = normalizeLimit(limitInput);
  const rows = await db
    .select()
    .from(participantsTable)
    .where(and(
      eq(participantsTable.organizationId, organizationId),
      eq(participantsTable.status, "active"),
      isNull(participantsTable.deletedAt),
    ))
    .limit(500);

  const normalized = query.toLowerCase();
  return rows
    .map((participant): ParticipantSearchResult | null => {
      const external = participant.externalParticipantId?.toLowerCase() ?? "";
      const display = participant.displayName.toLowerCase();
      const preferred = participant.preferredName?.toLowerCase() ?? "";
      if (external === normalized) {
        return { participant, matchType: "external_id_exact", isSuggestion: false, rank: 0 };
      }
      if (display === normalized) {
        return { participant, matchType: "display_name_exact", isSuggestion: false, rank: 1 };
      }
      if (preferred === normalized) {
        return { participant, matchType: "display_name_exact", isSuggestion: false, rank: 2 };
      }
      const starts = display.startsWith(normalized) || preferred.startsWith(normalized);
      const contains = display.includes(normalized) || preferred.includes(normalized);
      const similarity = participantNameSimilarity(query, participant);
      if (!starts && !contains && similarity < PICKER_FUZZY_THRESHOLD) return null;
      return {
        participant,
        matchType: "fuzzy_suggestion",
        isSuggestion: true,
        rank: starts ? 10 : contains ? 15 : 20,
        similarity: Number(similarity.toFixed(3)),
      };
    })
    .filter((result): result is ParticipantSearchResult => Boolean(result))
    .sort((a, b) => a.rank - b.rank || a.participant.displayName.localeCompare(b.participant.displayName))
    .slice(0, limit);
}

export async function findParticipantDuplicateWarnings(
  organizationId: string,
  rawDisplayName: string,
  limitInput?: unknown,
): Promise<ParticipantDuplicateWarning[]> {
  const query = cleanText(rawDisplayName);
  if (!query) return [];
  const limit = normalizeLimit(limitInput);
  const normalized = normalizeParticipantName(query);
  const rows = await db
    .select()
    .from(participantsTable)
    .where(and(
      eq(participantsTable.organizationId, organizationId),
      eq(participantsTable.status, "active"),
      isNull(participantsTable.deletedAt),
    ))
    .limit(500);

  return rows
    .map((participant): ParticipantDuplicateWarning | null => {
      const candidateNames = [participant.displayName, participant.preferredName].map(normalizeParticipantName).filter(Boolean);
      if (candidateNames.some(name => name === normalized)) {
        return { participant, similarity: 1 };
      }
      const similarity = participantNameSimilarity(query, participant);
      if (similarity < DUPLICATE_WARNING_THRESHOLD) return null;
      return { participant, similarity: Number(similarity.toFixed(3)) };
    })
    .filter((warning): warning is ParticipantDuplicateWarning => Boolean(warning))
    .sort((a, b) => b.similarity - a.similarity || a.participant.displayName.localeCompare(b.participant.displayName))
    .slice(0, limit);
}

export async function updateParticipant(
  organizationId: string,
  participantId: string,
  input: Partial<ParticipantInput>,
): Promise<Participant> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.displayName !== undefined) {
    const displayName = cleanText(input.displayName);
    if (!displayName || displayName.length < 2) {
      throw new ParticipantServiceError("displayName must be at least 2 characters.", "VALIDATION_ERROR");
    }
    patch.displayName = displayName;
  }
  if (input.preferredName !== undefined) patch.preferredName = cleanText(input.preferredName);
  if (input.externalParticipantId !== undefined) patch.externalParticipantId = cleanText(input.externalParticipantId);
  if (input.status !== undefined) patch.status = normalizeStatus(input.status);

  let updated: Participant | undefined;
  try {
    [updated] = await db
      .update(participantsTable)
      .set(patch)
      .where(and(
        eq(participantsTable.id, participantId),
        eq(participantsTable.organizationId, organizationId),
        isNull(participantsTable.deletedAt),
      ))
      .returning();
  } catch (err) {
    if ((err as any)?.code === "23505") {
      throw new ParticipantServiceError(
        "A participant with this external participant ID already exists in this organisation.",
        "DUPLICATE_EXTERNAL_PARTICIPANT_ID",
      );
    }
    throw err;
  }

  if (!updated) throw new ParticipantServiceError("Participant not found.", "NOT_FOUND");
  return updated;
}

export async function softDeleteParticipant(
  organizationId: string,
  participantId: string,
): Promise<{
  participant: Participant;
  boundTasks: Array<{ taskId: string; role: string }>;
  linkedSources: Array<{ sourceId: string; title: string | null; originalFileName: string | null }>;
}> {
  const [participant] = await db
    .update(participantsTable)
    .set({ status: "archived", deletedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(participantsTable.id, participantId),
      eq(participantsTable.organizationId, organizationId),
      isNull(participantsTable.deletedAt),
    ))
    .returning();
  if (!participant) throw new ParticipantServiceError("Participant not found.", "NOT_FOUND");

  const boundTasks = await db
    .select({ taskId: taskParticipantsTable.taskId, role: taskParticipantsTable.role })
    .from(taskParticipantsTable)
    .where(and(
      eq(taskParticipantsTable.organizationId, organizationId),
      eq(taskParticipantsTable.participantId, participantId),
    ));

  const linkedSources = await db
    .select({
      sourceId: knowledgeSourcesTable.id,
      title: knowledgeSourcesTable.title,
      originalFileName: knowledgeSourcesTable.originalFileName,
    })
    .from(knowledgeSourceScopesTable)
    .innerJoin(knowledgeSourcesTable, eq(knowledgeSourcesTable.id, knowledgeSourceScopesTable.knowledgeSourceId))
    .where(and(
      eq(knowledgeSourceScopesTable.organizationId, organizationId),
      eq(knowledgeSourceScopesTable.scopeType, "entity"),
      eq(knowledgeSourceScopesTable.scopeId, participantId),
      isNull(knowledgeSourcesTable.deletedAt),
    ));

  return { participant, boundTasks, linkedSources };
}

export async function linkParticipantSource(input: {
  organizationId: string;
  participantId: string;
  sourceId: string;
  actorUserId: string;
}) {
  await assertParticipantActive(input.organizationId, input.participantId);
  const source = await getKnowledgeSource(input.sourceId, input.organizationId);
  if (!source) throw new ParticipantServiceError("Knowledge source not found.", "SOURCE_NOT_FOUND");
  if (source.sourceType !== "participant_document") {
    throw new ParticipantServiceError("Only participant documents can be linked to a participant.", "INVALID_SOURCE_TYPE");
  }
  return assignScope({
    organizationId: input.organizationId,
    knowledgeSourceId: input.sourceId,
    scopeType: "entity",
    scopeId: input.participantId,
    actorUserId: input.actorUserId,
  });
}

export async function unlinkParticipantSource(input: {
  organizationId: string;
  participantId: string;
  sourceId: string;
  actorUserId: string;
}): Promise<void> {
  await removeScope(input.sourceId, input.organizationId, "entity", input.participantId, input.actorUserId);
}

export async function listParticipantSources(organizationId: string, participantId: string) {
  await assertParticipantExists(organizationId, participantId);
  return db
    .select({
      id: knowledgeSourcesTable.id,
      title: knowledgeSourcesTable.title,
      originalFileName: knowledgeSourcesTable.originalFileName,
      sourceType: knowledgeSourcesTable.sourceType,
      status: knowledgeSourcesTable.status,
      createdAt: knowledgeSourcesTable.createdAt,
    })
    .from(knowledgeSourceScopesTable)
    .innerJoin(knowledgeSourcesTable, eq(knowledgeSourcesTable.id, knowledgeSourceScopesTable.knowledgeSourceId))
    .where(and(
      eq(knowledgeSourceScopesTable.organizationId, organizationId),
      eq(knowledgeSourceScopesTable.scopeType, "entity"),
      eq(knowledgeSourceScopesTable.scopeId, participantId),
      isNull(knowledgeSourcesTable.deletedAt),
    ))
    .orderBy(desc(knowledgeSourcesTable.createdAt));
}

export async function listUnlinkedParticipantSources(organizationId: string) {
  return db
    .select({
      id: knowledgeSourcesTable.id,
      title: knowledgeSourcesTable.title,
      originalFileName: knowledgeSourcesTable.originalFileName,
      status: knowledgeSourcesTable.status,
      createdAt: knowledgeSourcesTable.createdAt,
    })
    .from(knowledgeSourcesTable)
    .where(and(
      eq(knowledgeSourcesTable.organizationId, organizationId),
      eq(knowledgeSourcesTable.sourceType, "participant_document"),
      isNull(knowledgeSourcesTable.deletedAt),
      sql`not exists (
        select 1 from knowledge_source_scopes kss
        where kss.knowledge_source_id = ${knowledgeSourcesTable.id}
          and kss.organization_id = ${organizationId}
          and kss.scope_type = 'entity'
      )`,
    ))
    .orderBy(desc(knowledgeSourcesTable.createdAt));
}

async function assertParticipantExists(organizationId: string, participantId: string): Promise<void> {
  const rows = await db
    .select({ id: participantsTable.id })
    .from(participantsTable)
    .where(and(
      eq(participantsTable.id, participantId),
      eq(participantsTable.organizationId, organizationId),
      isNull(participantsTable.deletedAt),
    ))
    .limit(1);
  if (!rows[0]) throw new ParticipantServiceError("Participant not found.", "NOT_FOUND");
}

async function assertParticipantActive(organizationId: string, participantId: string): Promise<void> {
  const rows = await db
    .select({ id: participantsTable.id })
    .from(participantsTable)
    .where(and(
      eq(participantsTable.id, participantId),
      eq(participantsTable.organizationId, organizationId),
      eq(participantsTable.status, "active"),
      isNull(participantsTable.deletedAt),
    ))
    .limit(1);
  if (!rows[0]) throw new ParticipantServiceError("Participant not found or inactive.", "NOT_FOUND");
}
