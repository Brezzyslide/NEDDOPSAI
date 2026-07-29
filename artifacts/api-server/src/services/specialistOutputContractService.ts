// ─── Specialist Output Contract ───────────────────────────────────────────────

/**
 * The formal output contract that every AI specialist must return.
 * The Chief of Staff consumes this contract. No specialist returns a custom format.
 *
 * Sprint XX: Establishes the formal inter-employee communication standard.
 */

import { randomUUID } from "crypto";

export interface EvidenceReference {
  resourceId: string;
  resourceName: string;
  excerpt?: string;
  relevance: string;
}

export interface ExecutionIntent {
  intentId: string;
  intentType: string;
  description: string;
  targetSystem?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  requiresApproval: boolean;
  estimatedDuration?: string;
}

export interface ApprovalRequirement {
  approvalType: string;
  reason: string;
  suggestedApprover?: string;
  deadline?: string;
}

export interface OutstandingQuestion {
  questionId: string;
  question: string;
  askedOf: 'user' | 'chief_of_staff' | 'specialist' | 'external';
  urgency: 'low' | 'medium' | 'high';
  blockingExecution: boolean;
}

export interface SpecialistOutputContract {
  // Identity
  contractVersion: '1.0';
  specialistRoleCode: string;
  taskId: string;
  specialistRunId: string;
  organisationId: string;

  // Summary
  summary: string;                           // 1-3 sentence executive summary

  // Findings — what the specialist discovered
  findings: string[];

  // Recommendations — what the specialist recommends
  recommendations: string[];

  // Evidence — what the specialist reviewed
  evidenceReferences: EvidenceReference[];

  // Pending approvals needed before execution can proceed
  approvalsRequired: ApprovalRequirement[];

  // Execution intents — actions the specialist wants to take
  executionIntents: ExecutionIntent[];

  // Outstanding questions blocking or affecting this work
  outstandingQuestions: OutstandingQuestion[];

  // Quality indicators
  confidence: number;                        // 0.0 – 1.0
  completeness: 'complete' | 'partial' | 'incomplete';

  // Problems
  errors: string[];
  warnings: string[];

  // Metadata
  executedAt: string;                        // ISO timestamp
  durationMs?: number;
  modelProvider?: string;
  modelName?: string;
  capabilityCode?: string;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates an empty (default) SpecialistOutputContract.
 * Callers should populate findings, recommendations, etc. before returning.
 */
export function createEmptyContract(
  specialistRoleCode: string,
  taskId: string,
  specialistRunId: string,
  organisationId: string,
): SpecialistOutputContract {
  return {
    contractVersion: '1.0',
    specialistRoleCode,
    taskId,
    specialistRunId,
    organisationId,
    summary: '',
    findings: [],
    recommendations: [],
    evidenceReferences: [],
    approvalsRequired: [],
    executionIntents: [],
    outstandingQuestions: [],
    confidence: 0,
    completeness: 'incomplete',
    errors: [],
    warnings: [],
    executedAt: new Date().toISOString(),
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates a SpecialistOutputContract for completeness and correctness.
 * Returns { valid, errors } — callers should check valid before proceeding.
 */
export function validateContract(contract: SpecialistOutputContract): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!contract.contractVersion || contract.contractVersion !== '1.0') {
    errors.push('contractVersion must be "1.0"');
  }
  if (!contract.specialistRoleCode || contract.specialistRoleCode.trim() === '') {
    errors.push('specialistRoleCode is required');
  }
  if (!contract.taskId || contract.taskId.trim() === '') {
    errors.push('taskId is required');
  }
  if (!contract.specialistRunId || contract.specialistRunId.trim() === '') {
    errors.push('specialistRunId is required');
  }
  if (!contract.organisationId || contract.organisationId.trim() === '') {
    errors.push('organisationId is required');
  }
  if (!contract.summary || contract.summary.trim() === '') {
    errors.push('summary is required');
  }
  if (typeof contract.confidence !== 'number' || contract.confidence < 0 || contract.confidence > 1) {
    errors.push('confidence must be a number between 0.0 and 1.0');
  }
  if (!['complete', 'partial', 'incomplete'].includes(contract.completeness)) {
    errors.push('completeness must be one of: complete, partial, incomplete');
  }
  if (!contract.executedAt || isNaN(Date.parse(contract.executedAt))) {
    errors.push('executedAt must be a valid ISO timestamp');
  }
  if (!Array.isArray(contract.findings)) {
    errors.push('findings must be an array');
  }
  if (!Array.isArray(contract.recommendations)) {
    errors.push('recommendations must be an array');
  }
  if (!Array.isArray(contract.evidenceReferences)) {
    errors.push('evidenceReferences must be an array');
  }
  if (!Array.isArray(contract.executionIntents)) {
    errors.push('executionIntents must be an array');
  }
  if (!Array.isArray(contract.outstandingQuestions)) {
    errors.push('outstandingQuestions must be an array');
  }
  if (!Array.isArray(contract.approvalsRequired)) {
    errors.push('approvalsRequired must be an array');
  }
  if (!Array.isArray(contract.errors)) {
    errors.push('errors must be an array');
  }
  if (!Array.isArray(contract.warnings)) {
    errors.push('warnings must be an array');
  }

  // Validate execution intents
  for (const intent of (contract.executionIntents ?? [])) {
    if (!intent.intentId) errors.push(`executionIntent missing intentId`);
    if (!intent.intentType) errors.push(`executionIntent missing intentType`);
    if (!['low', 'normal', 'high', 'urgent'].includes(intent.priority)) {
      errors.push(`executionIntent ${intent.intentId ?? '?'} has invalid priority`);
    }
  }

  // Validate outstanding questions
  for (const q of (contract.outstandingQuestions ?? [])) {
    if (!q.questionId) errors.push(`outstandingQuestion missing questionId`);
    if (!['user', 'chief_of_staff', 'specialist', 'external'].includes(q.askedOf)) {
      errors.push(`outstandingQuestion ${q.questionId ?? '?'} has invalid askedOf`);
    }
    if (!['low', 'medium', 'high'].includes(q.urgency)) {
      errors.push(`outstandingQuestion ${q.questionId ?? '?'} has invalid urgency`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── Prompt Block ─────────────────────────────────────────────────────────────

/**
 * Formats a SpecialistOutputContract into a structured text block for injection
 * into the Chief of Staff consolidation prompt.
 */
export function contractToCoSPromptBlock(contract: SpecialistOutputContract): string {
  const lines: string[] = [];

  lines.push(`SPECIALIST OUTPUT — ${contract.specialistRoleCode.toUpperCase()}`);
  lines.push(`Run ID: ${contract.specialistRunId}`);
  lines.push(`Executed At: ${contract.executedAt}`);
  lines.push('');

  lines.push(`Summary: ${contract.summary}`);
  lines.push('');

  lines.push('Findings:');
  if (contract.findings.length === 0) {
    lines.push('  (none)');
  } else {
    for (const finding of contract.findings) {
      lines.push(`  - ${finding}`);
    }
  }
  lines.push('');

  lines.push('Recommendations:');
  if (contract.recommendations.length === 0) {
    lines.push('  (none)');
  } else {
    for (const rec of contract.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }
  lines.push('');

  if (contract.approvalsRequired.length > 0) {
    lines.push('Approvals Required:');
    for (const approval of contract.approvalsRequired) {
      lines.push(`  - [${approval.approvalType}] ${approval.reason}`);
      if (approval.suggestedApprover) {
        lines.push(`    Suggested Approver: ${approval.suggestedApprover}`);
      }
      if (approval.deadline) {
        lines.push(`    Deadline: ${approval.deadline}`);
      }
    }
    lines.push('');
  }

  if (contract.executionIntents.length > 0) {
    lines.push('Execution Intents:');
    for (const intent of contract.executionIntents) {
      lines.push(`  - [${intent.priority.toUpperCase()}] ${intent.intentType}: ${intent.description}`);
      if (intent.targetSystem) lines.push(`    Target: ${intent.targetSystem}`);
      if (intent.requiresApproval) lines.push(`    Requires Approval: yes`);
    }
    lines.push('');
  }

  if (contract.outstandingQuestions.length > 0) {
    lines.push('Outstanding Questions:');
    for (const q of contract.outstandingQuestions) {
      const blocking = q.blockingExecution ? ' [BLOCKING]' : '';
      lines.push(`  - [${q.urgency.toUpperCase()}${blocking}] ${q.question} (asked of: ${q.askedOf})`);
    }
    lines.push('');
  }

  if (contract.evidenceReferences.length > 0) {
    lines.push('Evidence References:');
    for (const ev of contract.evidenceReferences) {
      lines.push(`  - ${ev.resourceName} (${ev.resourceId}): ${ev.relevance}`);
      if (ev.excerpt) lines.push(`    Excerpt: "${ev.excerpt}"`);
    }
    lines.push('');
  }

  lines.push(`Confidence: ${Math.round(contract.confidence * 100)}%`);
  lines.push(`Completeness: ${contract.completeness}`);

  if (contract.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const err of contract.errors) {
      lines.push(`  - ${err}`);
    }
  }

  if (contract.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of contract.warnings) {
      lines.push(`  - ${w}`);
    }
  }

  lines.push('─────────────────────────────────────────────────────────────────────');

  return lines.join('\n');
}
