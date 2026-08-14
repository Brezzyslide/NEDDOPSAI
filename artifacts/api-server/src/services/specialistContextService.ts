/**
 * specialistContextService — Sprint Knowledge Bridge (Task #14)
 *
 * Loads per-specialist runtime context from the platform database.
 * Called immediately before instruction assembly in executionService.ts.
 *
 * Returns:
 *   - approved organisation memory scoped to this specialist (or org-wide)
 *   - organisation_specialist_configuration (goals, style, escalation)
 *   - specialist_language_profiles (locale, tone, preferred terms, etc.)
 *   - list of injected memory record IDs for audit
 *
 * TENANT ISOLATION CONTRACT:
 *   - Every query explicitly filters by organizationId
 *   - RLS is enforced at the DB layer independently
 *   - No cross-tenant data can enter the context package
 *
 * APPROVAL CONTRACT:
 *   - Only status = 'approved' memory records are loaded
 *   - Expired (expiresAt < now) records are excluded
 *   - Superseded (supersededBy IS NOT NULL) records are excluded
 *   - Records not yet effective (effectiveFrom > now) are excluded
 *
 * SCOPE CONTRACT:
 *   - Memory with specialist_id = null → org-wide (all specialists see it)
 *   - Memory with specialist_id = X → only specialist X sees it
 *   - Cross-specialist memory is never included
 */

import { db } from "@workspace/db";
import {
  organisationMemoryTable,
  organisationSpecialistConfigTable,
  specialistLanguageProfilesTable,
  tasksTable,
  conversationMessagesTable,
  conversationMemoryTable,
  specialistRunsTable,
} from "@workspace/db";
import { eq, and, or, isNull, desc, asc } from "drizzle-orm";
import { estimateTokens } from "./contextSelectionService.js";
import {
  orchestrateKnowledge,
  formatKnowledgeContextSections,
  type KnowledgeCitation,
} from "./knowledgeOrchestrationEngine.js";
import type { SensitivityLevel } from "../lib/knowledge/IKnowledgeProvider.js";
import { projectKnowledgeCitationsToEvidenceReferences } from "../lib/knowledge/evidenceReferenceProjection.js";
import type { EvidenceReference } from "./specialistIntelligenceService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpecialistMemoryItem {
  id: string;
  memoryType: string;
  title: string;
  content: string;
  importance: number;
  specialistId: string | null;
}

export interface SpecialistConfigSnapshot {
  goals: string[];
  preferredStyle: string | null;
  escalationContacts: Array<{ name: string; role: string }>;
  additionalContext: {
    businessType?: string;
    services?: string[];
    operatingHours?: string;
    timezone?: string;
    systems?: string[];
  };
}

export interface LanguageProfileSnapshot {
  locale: string;
  spellingConvention: string | null;
  tone: string | null;
  formality: string | null;
  preferredTerms: Array<{ term: string; preferred: string; notes?: string }>;
  prohibitedTerms: Array<{ term: string; reason?: string }>;
  dateFormat: string | null;
  timeFormat: string | null;
  headingPreferences: string | null;
  sentenceLengthPreference: string | null;
  outputStructure: string | null;
}

export interface SpecialistContextPackage {
  /** org_specialist_config for this specialist — null if not configured */
  specialistConfig: SpecialistConfigSnapshot | null;
  /** specialist_language_profiles for this specialist — null if not configured */
  languageProfile: LanguageProfileSnapshot | null;
  /** Approved memory scoped to this specialist or org-wide */
  approvedMemory: SpecialistMemoryItem[];
  /** IDs of memory records included — for audit */
  injectedMemoryIds: string[];
  /** Approximate token count consumed by this context package */
  tokenBudgetUsed: number;
  /**
   * Retrieved knowledge context from the Knowledge Orchestration Engine (Task #17).
   * Includes pre-formatted sections for the assembler plus audit metadata.
   * null when knowledge retrieval is disabled or no query is provided.
   */
  retrievedKnowledge?: {
    sections: string[];
    totalChunks: number;
    tokenBudgetUsed: number;
    citationIds: string[];
    citations: KnowledgeCitation[];
    conflictCount: number;
    auditEventId: string | null;
  } | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** Max tokens the specialist context package may consume in the instruction */
const DEFAULT_CONTEXT_TOKEN_BUDGET = parseInt(
  process.env.SPECIALIST_CONTEXT_TOKEN_BUDGET ?? "2000",
  10,
);

/** Max approved memory records to load before budget enforcement */
const MAX_MEMORY_RECORDS = 40;

// ─── Main loader ──────────────────────────────────────────────────────────────

export interface KnowledgeRetrievalOptions {
  /** Natural language query to drive retrieval (typically the task description) */
  query: string;
  /** Pre-computed embedding vector for semantic search. null = lexical-only */
  queryEmbedding?: number[] | null;
  /** Task ID for P1 current-task document retrieval */
  taskId?: string | null;
  /** Entity IDs for P2 entity knowledge retrieval */
  entityIds?: string[];
  /** Execution ID written to the retrieval audit event */
  executionId?: string | null;
  /** Total token budget for knowledge chunks. Default: KNOWLEDGE_TOKEN_BUDGET env */
  knowledgeTokenBudget?: number;
  /** Sensitivity levels this call may access */
  allowedSensitivity?: SensitivityLevel[];
  /**
   * Write a retrieval_audit_events row. Default true.
   * Set false in tests to avoid DB side effects.
   */
  writeAudit?: boolean;
}

/**
 * Load the full runtime context package for a specialist within an organisation.
 *
 * Optionally runs the Knowledge Orchestration Engine (Task #17) when
 * `knowledgeOptions` is provided. Knowledge retrieval is opt-in to preserve
 * backward compatibility — callers without a query receive the original
 * memory-only context package.
 *
 * Safe to call concurrently — reads only (unless writeAudit=true).
 * Degrades gracefully: if any sub-query fails the partial result is returned.
 */
export async function loadSpecialistContext(
  organizationId: string,
  specialistId: string,
  tokenBudget: number = DEFAULT_CONTEXT_TOKEN_BUDGET,
  knowledgeOptions?: KnowledgeRetrievalOptions,
): Promise<SpecialistContextPackage> {
  const [specialistConfig, languageProfile, candidateMemory] = await Promise.all([
    loadSpecialistConfig(organizationId, specialistId),
    loadLanguageProfile(organizationId, specialistId),
    loadApprovedMemory(organizationId, specialistId),
  ]);

  // Apply token budget — mandatory/high-importance memory is retained first
  const { memory: approvedMemory, tokenBudgetUsed } = applyTokenBudget(
    candidateMemory,
    tokenBudget,
  );

  // ── Knowledge Orchestration (Task #17) ─────────────────────────────────────
  let retrievedKnowledge: SpecialistContextPackage["retrievedKnowledge"] = null;

  if (knowledgeOptions?.query) {
    try {
      const kCtx = await orchestrateKnowledge({
        organisationId:      organizationId,
        specialistId,
        query:               knowledgeOptions.query,
        queryEmbedding:      knowledgeOptions.queryEmbedding ?? null,
        taskId:              knowledgeOptions.taskId ?? null,
        entityIds:           knowledgeOptions.entityIds ?? [],
        executionId:         knowledgeOptions.executionId ?? null,
        tokenBudget:         knowledgeOptions.knowledgeTokenBudget,
        allowedSensitivity:  knowledgeOptions.allowedSensitivity,
        writeAudit:          knowledgeOptions.writeAudit ?? true,
      });

      const sections    = formatKnowledgeContextSections(kCtx);
      const allItems    = [
        ...kCtx.taskUploadItems,
        ...kCtx.entityItems,
        ...kCtx.specialistItems,
        ...kCtx.libraryItems,
      ];
      const citationIds = kCtx.citations.map(c => c.citationId);

      retrievedKnowledge = {
        sections,
        totalChunks:      allItems.length,
        tokenBudgetUsed:  kCtx.tokenBudgetUsed,
        citationIds,
        citations:        kCtx.citations,
        conflictCount:    kCtx.conflicts.length,
        auditEventId:     kCtx.auditEventId,
      };
    } catch {
      // Knowledge retrieval failure MUST NOT block execution
      retrievedKnowledge = null;
    }
  }

  return {
    specialistConfig,
    languageProfile,
    approvedMemory,
    injectedMemoryIds: approvedMemory.map(m => m.id),
    tokenBudgetUsed,
    retrievedKnowledge,
  };
}

// ─── DB fetch helpers ─────────────────────────────────────────────────────────

async function loadSpecialistConfig(
  organizationId: string,
  specialistId: string,
): Promise<SpecialistConfigSnapshot | null> {
  try {
    const [row] = await db
      .select()
      .from(organisationSpecialistConfigTable)
      .where(
        and(
          eq(organisationSpecialistConfigTable.organizationId, organizationId),
          eq(organisationSpecialistConfigTable.specialistId, specialistId),
        ),
      )
      .limit(1);

    if (!row) return null;

    return {
      goals: (row.goals as string[]) ?? [],
      preferredStyle: row.preferredStyle ?? null,
      escalationContacts: (row.escalationContacts as Array<{ name: string; role: string }>) ?? [],
      additionalContext: (row.additionalContext as SpecialistConfigSnapshot["additionalContext"]) ?? {},
    };
  } catch {
    return null;
  }
}

async function loadLanguageProfile(
  organizationId: string,
  specialistId: string,
): Promise<LanguageProfileSnapshot | null> {
  try {
    const [row] = await db
      .select()
      .from(specialistLanguageProfilesTable)
      .where(
        and(
          eq(specialistLanguageProfilesTable.organizationId, organizationId),
          eq(specialistLanguageProfilesTable.specialistId, specialistId),
        ),
      )
      .limit(1);

    if (!row) return null;

    return {
      locale: row.locale,
      spellingConvention: row.spellingConvention ?? null,
      tone: row.tone ?? null,
      formality: row.formality ?? null,
      preferredTerms: (row.preferredTerms as Array<{ term: string; preferred: string; notes?: string }>) ?? [],
      prohibitedTerms: (row.prohibitedTerms as Array<{ term: string; reason?: string }>) ?? [],
      dateFormat: row.dateFormat ?? null,
      timeFormat: row.timeFormat ?? null,
      headingPreferences: row.headingPreferences ?? null,
      sentenceLengthPreference: row.sentenceLengthPreference ?? null,
      outputStructure: row.outputStructure ?? null,
    };
  } catch {
    return null;
  }
}

async function loadApprovedMemory(
  organizationId: string,
  specialistId: string,
): Promise<SpecialistMemoryItem[]> {
  try {
    const now = new Date();

    const rows = await db
      .select({
        id:           organisationMemoryTable.id,
        memoryType:   organisationMemoryTable.memoryType,
        title:        organisationMemoryTable.title,
        content:      organisationMemoryTable.content,
        importance:   organisationMemoryTable.importance,
        specialistId: organisationMemoryTable.specialistId,
        expiresAt:    organisationMemoryTable.expiresAt,
        effectiveFrom:organisationMemoryTable.effectiveFrom,
        effectiveTo:  organisationMemoryTable.effectiveTo,
        supersededBy: organisationMemoryTable.supersededBy,
      })
      .from(organisationMemoryTable)
      .where(
        and(
          // Tenant isolation — explicit + RLS
          eq(organisationMemoryTable.organizationId, organizationId),
          // Approval gate — only approved records
          eq(organisationMemoryTable.status, "approved"),
          // Specialist scope: org-wide OR this specialist specifically
          or(
            isNull(organisationMemoryTable.specialistId),
            eq(organisationMemoryTable.specialistId, specialistId),
          ),
        ),
      )
      .orderBy(
        // importance DESC, then most recently updated first
        // Note: Drizzle requires importing desc/asc; use raw sort below
      )
      .limit(MAX_MEMORY_RECORDS);

    // Post-query filters (effectiveFrom/To/expiresAt/supersededBy can't easily
    // use parameterised IS NULL OR < $1 in a single Drizzle where clause
    // without raw SQL — apply in-process after tenant filter is confirmed)
    return rows
      .filter(r => !r.supersededBy)                          // not superseded
      .filter(r => !r.expiresAt || r.expiresAt > now)        // not expired
      .filter(r => !r.effectiveTo || r.effectiveTo > now)    // not past end date
      .filter(r => !r.effectiveFrom || r.effectiveFrom <= now) // already effective
      .sort((a, b) => b.importance - a.importance)           // highest importance first
      .map(r => ({
        id:           r.id,
        memoryType:   r.memoryType,
        title:        r.title,
        content:      r.content,
        importance:   r.importance,
        specialistId: r.specialistId ?? null,
      }));
  } catch {
    return [];
  }
}

// ─── Token budget ─────────────────────────────────────────────────────────────

function applyTokenBudget(
  items: SpecialistMemoryItem[],
  budget: number,
): { memory: SpecialistMemoryItem[]; tokenBudgetUsed: number } {
  const selected: SpecialistMemoryItem[] = [];
  let used = 0;

  for (const item of items) {
    const tokens = estimateTokens(`${item.title}: ${item.content}`);
    if (used + tokens > budget) break;
    used += tokens;
    selected.push(item);
  }

  return { memory: selected, tokenBudgetUsed: used };
}

// ─── Legacy context loader (chiefOfStaffOrchestrator compatibility) ───────────

/**
 * Build the full SpecialistContext used by the intelligence service for
 * conversational specialist runs (distinct from execution package assembly).
 *
 * This loads:
 *   - Task scope and approval state
 *   - Approved org memory in the flat { id, content, category } format
 *   - Conversation message history (when conversationId is provided)
 *   - Pinned decisions from conversation memory
 *   - Previous completed specialist run summaries for this task
 *
 * Compatible with the SpecialistContext interface in specialistIntelligenceService.ts
 */
export async function buildSpecialistContext(params: {
  organizationId:    string;
  conversationId?:   string;
  taskId:            string | null;
  specialistRunId:   string;
  workforceRoleCode: string;
  workerProfileCode: string;
  capabilityCode:    string;
}): Promise<{
  taskScope:                string;
  approvedMemory:           Array<{ id: string; content: string; category: string }>;
  pinnedDecisions:          Array<{ id: string; decision: string }>;
  unresolvedQuestions:      string[];
  relevantMessages:         Array<{ id: string; role: string; content: string }>;
  previousOutputs:          Array<{ specialistRunId: string; role: string; summary: string }>;
  evidenceReferences:       EvidenceReference[];
  approvalState:            string;
  executionEntitlementState: string;
}> {
  const {
    organizationId, conversationId, taskId,
    workforceRoleCode,
  } = params;

  const [task, convMemRow, previousRunRows, conversationMessageRows] =
    await Promise.all([
      // Task row — scope + approval state
      taskId
        ? db.select({ title: tasksTable.title, approvalState: tasksTable.approvalState, currentState: tasksTable.currentState })
            .from(tasksTable)
            .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organizationId)))
            .limit(1)
            .then(r => r[0] ?? null)
        : Promise.resolve(null),

      // Pinned decisions from conversation memory
      conversationId
        ? db.select({ pinnedDecisions: conversationMemoryTable.pinnedDecisions })
            .from(conversationMemoryTable)
            .where(and(
              eq(conversationMemoryTable.organizationId, organizationId),
              eq(conversationMemoryTable.conversationId, conversationId),
            ))
            .limit(1)
            .then(r => r[0] ?? null)
        : Promise.resolve(null),

      // Previous specialist run summaries for the same task
      taskId
        ? db.select({
            id:               specialistRunsTable.id,
            workforceRoleCode: specialistRunsTable.workforceRoleCode,
            resultSummary:    specialistRunsTable.resultSummary,
            status:           specialistRunsTable.status,
          })
            .from(specialistRunsTable)
            .where(and(
              eq(specialistRunsTable.organizationId, organizationId),
              eq(specialistRunsTable.taskId, taskId),
            ))
            .orderBy(desc(specialistRunsTable.createdAt))
            .limit(10)
        : Promise.resolve([]),

      // Conversation message history
      conversationId
        ? db.select({
            id:         conversationMessagesTable.id,
            senderType: conversationMessagesTable.senderType,
            content:    conversationMessagesTable.content,
          })
            .from(conversationMessagesTable)
            .where(and(
              eq(conversationMessagesTable.organizationId, organizationId),
              eq(conversationMessagesTable.conversationId, conversationId),
            ))
            .orderBy(asc(conversationMessagesTable.createdAt))
            .limit(50)
        : Promise.resolve([]),
    ]);

  // Extract pinned decisions
  interface PinnedDecision { id: string; decision: string; }
  const pinnedDecisions: PinnedDecision[] =
    (convMemRow?.pinnedDecisions as PinnedDecision[] | null) ?? [];

  // Format conversation messages
  const relevantMessages = conversationMessageRows.map(m => ({
    id:      m.id,
    role:    m.senderType === "ai" ? "assistant" : "user",
    content: m.content,
  }));

  // Format previous outputs
  const previousOutputs = previousRunRows
    .filter(r => r.status === "completed" && r.resultSummary)
    .map(r => ({
      specialistRunId: r.id,
      role:            r.workforceRoleCode,
      summary:         r.resultSummary!,
    }));

  const taskScope = task
    ? `${task.title} [${task.currentState}]`
    : "Unknown task";

  const canonicalContext = await loadSpecialistContext(
    organizationId,
    workforceRoleCode,
    DEFAULT_CONTEXT_TOKEN_BUDGET,
    {
      query: [
        taskScope,
        ...relevantMessages.slice(-10).map(message => message.content),
      ].filter(Boolean).join("\n"),
      taskId: taskId ?? undefined,
      executionId: params.specialistRunId,
      writeAudit: true,
    },
  );

  const approvedMemory = canonicalContext.approvedMemory.map(memory => ({
    id:       memory.id,
    content:  memory.content,
    category: memory.memoryType,
  }));

  const evidenceReferences = projectKnowledgeCitationsToEvidenceReferences(
    canonicalContext.retrievedKnowledge?.citations,
  ) as EvidenceReference[];

  return {
    taskScope,
    approvedMemory,
    pinnedDecisions,
    unresolvedQuestions: [],
    relevantMessages,
    previousOutputs,
    evidenceReferences,
    approvalState:             task?.approvalState ?? "not_required",
    executionEntitlementState: "ok",
  };
}
