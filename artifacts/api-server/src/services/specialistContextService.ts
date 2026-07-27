/**
 * Specialist Context Service — Sprint 9.5
 *
 * Retrieves only relevant and authorised context for a specialist run.
 * Applies role-specific filtering — a Compliance Officer must not receive
 * payroll data; a Document Specialist must not receive incident case notes, etc.
 *
 * Security principles:
 * - Minimum necessary context
 * - Role-specific data boundaries
 * - No cross-task specialist memory
 * - Token budget enforced
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { logOrgEvent } from "./auditService.js";
import type { SpecialistContext } from "./specialistIntelligenceService.js";

// ─── Role-specific allowed memory categories ──────────────────────────────────

const ROLE_ALLOWED_MEMORY_CATEGORIES: Record<string, string[]> = {
  compliance_officer: [
    "compliance", "policy", "incident", "audit", "regulatory",
    "ndis", "quality", "corrective_action", "restrictive_practice",
    "worker_screening", "registration", "standard",
  ],
  document_specialist: [
    "document", "template", "format", "draft", "policy_document",
    "procedure", "register", "record",
  ],
  operations_manager: [
    "operations", "roster", "workflow", "capacity", "service_delivery",
    "asset", "scheduling", "procedure", "resource",
  ],
};

// Categories that should NEVER appear in any specialist's context
const UNIVERSALLY_BLOCKED_CATEGORIES = [
  "banking_credentials", "api_tokens", "passwords", "private_keys",
  "personal_medical_history", "payroll_rates", // payroll rates only go to finance specialists
];

// Categories blocked per role
const ROLE_BLOCKED_CATEGORIES: Record<string, string[]> = {
  compliance_officer: ["payroll", "banking", "financial_transactions"],
  document_specialist: ["financial_transactions", "payroll", "banking", "medical_records"],
  operations_manager: ["payroll_rates", "banking", "financial_transactions"],
};

// Token budget per context type (approximate characters per token = 4)
const MAX_MEMORY_ITEMS = 30;
const MAX_CONVERSATION_MESSAGES = 20;
const MAX_PREVIOUS_OUTPUTS = 5;

// ─── Context builder ──────────────────────────────────────────────────────────

export interface BuildContextInput {
  organizationId: string;
  conversationId?: string;
  taskId: string;
  specialistRunId: string;
  workforceRoleCode: string;
  workerProfileCode: string;
  capabilityCode: string;
}

/**
 * Builds role-filtered context for a specialist run.
 * Only includes authorised data categories. Never includes cross-task memory.
 */
export async function buildSpecialistContext(
  input: BuildContextInput,
): Promise<SpecialistContext> {
  const [taskScope, approvedMemory, messages, previousOutputs] = await Promise.all([
    getTaskScope(input.taskId, input.organizationId),
    getApprovedMemory(input.organizationId, input.workforceRoleCode),
    getRelevantMessages(input.conversationId, input.organizationId, input.workforceRoleCode),
    getPreviousOutputs(input.taskId, input.specialistRunId, input.organizationId),
  ]);

  const context: SpecialistContext = {
    taskScope,
    approvedMemory,
    pinnedDecisions: [], // populated from conversation memory
    unresolvedQuestions: [], // populated from task state
    relevantMessages: messages,
    previousOutputs,
    evidenceReferences: [],
    approvalState: "not_required",
    executionEntitlementState: "not_checked",
  };

  await logOrgEvent({
    eventType: "specialist.context_built",
    organizationId: input.organizationId,
    actorType: "system",
    resourceType: "specialist_run",
    resourceId: input.specialistRunId,
    isSensitive: true, // context building is sensitive
    metadata: {
      workforceRoleCode: input.workforceRoleCode,
      memoryItemCount: approvedMemory.length,
      messageCount: messages.length,
      previousOutputCount: previousOutputs.length,
    },
  });

  return context;
}

// ─── Data retrieval with filtering ────────────────────────────────────────────

async function getTaskScope(taskId: string, organizationId: string): Promise<string> {
  try {
    const { tasksTable } = await import("@workspace/db");
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organizationId)))
      .limit(1);
    if (!task) return "";
    return `Task: ${task.title}${task.description ? `\n${task.description}` : ""}`;
  } catch {
    return "";
  }
}

async function getApprovedMemory(
  organizationId: string,
  workforceRoleCode: string,
): Promise<Array<{ id: string; content: string; category: string }>> {
  try {
    const { organisationMemoryTable } = await import("@workspace/db");
    const allowedCategories = ROLE_ALLOWED_MEMORY_CATEGORIES[workforceRoleCode] ?? [];
    const blockedCategories = [
      ...UNIVERSALLY_BLOCKED_CATEGORIES,
      ...(ROLE_BLOCKED_CATEGORIES[workforceRoleCode] ?? []),
    ];

    const rows = await db
      .select()
      .from(organisationMemoryTable)
      .where(and(
        eq(organisationMemoryTable.organizationId, organizationId),
        eq(organisationMemoryTable.status, "approved"),
      ))
      .orderBy(desc(organisationMemoryTable.createdAt))
      .limit(100);

    return rows
      .filter(r => {
        const cat = (r.category ?? "general").toLowerCase();
        if (blockedCategories.some(b => cat.includes(b))) return false;
        if (allowedCategories.length > 0) {
          return allowedCategories.some(a => cat.includes(a));
        }
        return true;
      })
      .slice(0, MAX_MEMORY_ITEMS)
      .map(r => ({
        id: r.id,
        content: r.content,
        category: r.category ?? "general",
      }));
  } catch {
    return [];
  }
}

async function getRelevantMessages(
  conversationId: string | undefined,
  organizationId: string,
  workforceRoleCode: string,
): Promise<Array<{ id: string; role: string; content: string }>> {
  if (!conversationId) return [];

  try {
    const { conversationMessagesTable } = await import("@workspace/db");
    const blockedCategories = ROLE_BLOCKED_CATEGORIES[workforceRoleCode] ?? [];

    const rows = await db
      .select()
      .from(conversationMessagesTable)
      .where(and(
        eq(conversationMessagesTable.conversationId, conversationId),
        eq(conversationMessagesTable.organizationId, organizationId),
      ))
      .orderBy(desc(conversationMessagesTable.createdAt))
      .limit(MAX_CONVERSATION_MESSAGES * 2);

    return rows
      .filter(r => {
        // Filter out messages that contain blocked data categories
        const content = (r.content ?? "").toLowerCase();
        return !blockedCategories.some(cat => content.includes(cat));
      })
      .slice(0, MAX_CONVERSATION_MESSAGES)
      .reverse() // chronological order
      .map(r => ({
        id: r.id,
        role: r.role,
        content: r.content ?? "",
      }));
  } catch {
    return [];
  }
}

async function getPreviousOutputs(
  taskId: string,
  currentRunId: string,
  organizationId: string,
): Promise<Array<{ specialistRunId: string; role: string; summary: string }>> {
  try {
    const { specialistRunsTable } = await import("@workspace/db");
    const rows = await db
      .select()
      .from(specialistRunsTable)
      .where(and(
        eq(specialistRunsTable.taskId, taskId),
        eq(specialistRunsTable.organizationId, organizationId),
        eq(specialistRunsTable.status, "completed"),
      ))
      .orderBy(desc(specialistRunsTable.completedAt))
      .limit(MAX_PREVIOUS_OUTPUTS);

    return rows
      .filter(r => r.id !== currentRunId && r.resultSummary)
      .map(r => ({
        specialistRunId: r.id,
        role: r.workforceRoleCode,
        summary: r.resultSummary ?? "",
      }));
  } catch {
    return [];
  }
}
