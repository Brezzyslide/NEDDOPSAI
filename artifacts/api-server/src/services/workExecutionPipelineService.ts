/**
 * Work Execution Pipeline Service — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Orchestrates the full professional work execution pipeline:
 *
 *   User Request
 *   ↓ Chief of Staff understands intent
 *   ↓ Select Work Blueprint
 *   ↓ Assemble Work Package Manifest
 *   ↓ Validate prerequisites
 *   ↓ Build execution context
 *   ↓ Execute specialist
 *   ↓ Self Review
 *   ↓ Completed Work
 *   ↓ Approval
 *   ↓ Export / Continue / Promote
 *
 * The pipeline is execution-first — it produces Completed Work, not just
 * conversational responses. Every execution creates a permanent audit record.
 */

import { randomUUID } from "crypto";
import { createAIGateway } from "@workspace/ai-gateway";
import type { AIGatewayContext } from "@workspace/ai-gateway";
import { buildSystemInstructionForEmployee } from "@workspace/workforce-dna";

import { selectBlueprint, getBlueprintById } from "./workBlueprintService.js";
import { assembleWorkPackage, type WorkPackageManifest } from "./workPackageService.js";
import { validateWorkPackage } from "./workValidationService.js";
import { retrieveApprovedExamples, buildStyleGuidance } from "./approvedExampleService.js";
import { reviewDraft } from "./selfReviewService.js";
import { createDraft } from "./completedWorkService.js";
import type { WorkBlueprint } from "./workBlueprintService.js";
import type { ValidationResult } from "./workValidationService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExecuteWorkInput {
  organizationId: string;
  requesterId: string;
  userRequest: string;
  /** Force a specific blueprint code (optional — auto-selected if omitted) */
  blueprintCode?: string;
  /** Blueprint ID to use directly */
  blueprintId?: string;
  /** Pre-identified task upload source IDs */
  taskUploadSourceIds?: string[];
  /** Inline entity knowledge */
  entityKnowledge?: Record<string, unknown>;
  /** Title for the completed work item (default: derived from request) */
  title?: string;
  conversationId?: string;
}

export type ExecutionOutcome =
  | "completed"
  | "validation_failed"
  | "no_blueprint"
  | "execution_failed";

export interface ExecuteWorkResult {
  outcome: ExecutionOutcome;
  completedWorkId?: string;
  manifestId?: string;
  blueprintCode?: string;
  qualityScore?: number;
  validationResult?: ValidationResult;
  /** Human-readable message for the CoS to relay to the user */
  message: string;
  /** Clarification questions if validation requires more information */
  clarificationQuestions?: string[];
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export async function executeWork(input: ExecuteWorkInput): Promise<ExecuteWorkResult> {
  const { organizationId, requesterId, userRequest } = input;

  // ── Step 1: Select Blueprint ─────────────────────────────────────────────
  let blueprint: WorkBlueprint | null = null;

  if (input.blueprintId) {
    blueprint = await getBlueprintById(input.blueprintId, organizationId);
  } else if (input.blueprintCode) {
    const selection = await selectBlueprint(input.blueprintCode, organizationId);
    blueprint = selection.blueprint;
  } else {
    const selection = await selectBlueprint(userRequest, organizationId);
    blueprint = selection.blueprint;
  }

  // ── Step 2: Assemble Work Package Manifest ────────────────────────────────
  const manifest = await assembleWorkPackage({
    organizationId,
    requesterId,
    conversationId: input.conversationId,
    blueprint,
    taskUploadSourceIds: input.taskUploadSourceIds,
    entityKnowledge: input.entityKnowledge,
  });

  // ── Step 3: Validate prerequisites ───────────────────────────────────────
  const validationResult = validateWorkPackage(manifest, blueprint);

  if (!validationResult.passed) {
    return {
      outcome: "validation_failed",
      manifestId: manifest.id,
      blueprintCode: blueprint?.code,
      validationResult,
      message: `I cannot proceed without the following: ${validationResult.missingItems.join(", ")}. ${validationResult.summary}`,
      clarificationQuestions: validationResult.missingItems.map(
        item => `Can you provide or upload the required ${item}?`
      ),
    };
  }

  // ── Step 4: Retrieve approved examples for style guidance ─────────────────
  const outputType = blueprint?.outputTypes[0] ?? "general_output";
  const examples = await retrieveApprovedExamples(organizationId, outputType);
  const styleGuidance = await buildStyleGuidance(examples, organizationId);

  // ── Step 5: Build execution context and generate draft ────────────────────
  let draftContent: string;
  try {
    draftContent = await generateDraft(userRequest, manifest, blueprint, styleGuidance.guidanceBlock, {
      userId: requesterId,
      organizationId,
    });
  } catch (err) {
    return {
      outcome: "execution_failed",
      manifestId: manifest.id,
      blueprintCode: blueprint?.code,
      message: `Specialist execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }

  // ── Step 6: Self Review ───────────────────────────────────────────────────
  const reviewResult = await reviewDraft(draftContent, manifest, blueprint, {
    organizationId,
    userId: requesterId,
    conversationId: input.conversationId,
  });

  // ── Step 7: Create Completed Work ─────────────────────────────────────────
  const title = input.title ?? deriveTitleFromRequest(userRequest, blueprint);

  const assetIds = [
    ...manifest.organisationLibrarySources.map(s => ({
      assetId: s.sourceId,
      assetType: "library_source" as const,
      role: "supporting" as const,
    })),
    ...manifest.taskUploads.map(s => ({
      assetId: s.sourceId,
      assetType: "task_upload" as const,
      role: "primary" as const,
    })),
    ...manifest.cosMemories.map(m => ({
      assetId: m.memoryId,
      assetType: "memory" as const,
      role: "supporting" as const,
    })),
  ];

  const completedWork = await createDraft({
    organizationId,
    conversationId: input.conversationId,
    blueprintId: blueprint?.id,
    manifestId: manifest.id,
    primarySpecialist: manifest.primarySpecialist,
    title,
    outputType,
    contentMarkdown: reviewResult.finalContent,
    reviewResult,
    createdByUserId: requesterId,
    assetIds,
  });

  return {
    outcome: "completed",
    completedWorkId: completedWork.id,
    manifestId: manifest.id,
    blueprintCode: blueprint?.code,
    qualityScore: reviewResult.qualityScore,
    message: buildCompletionMessage(completedWork.id, blueprint, reviewResult),
  };
}

// ─── Draft generation ─────────────────────────────────────────────────────────

async function generateDraft(
  userRequest: string,
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
  styleGuidanceBlock: string,
  authCtx: { userId: string; organizationId: string },
): Promise<string> {
  const provider = (process.env.AI_PROVIDER ?? "internal").toLowerCase().trim();

  if (provider !== "openai") {
    return generateRuleBasedDraft(userRequest, manifest, blueprint);
  }

  const gatewayCtx: AIGatewayContext = {
    userId: authCtx.userId,
    organizationId: authCtx.organizationId,
    role: "system",
    permissions: [],
    purpose: "work_execution",
    correlationId: randomUUID(),
    provider: "openai",
    retentionClass: "standard",
    requiresHumanApproval: true,
  };

  const gateway = createAIGateway(gatewayCtx);

  const specialistCode = manifest.primarySpecialist;
  let systemPrompt: string;
  try {
    systemPrompt = buildSystemInstructionForEmployee(specialistCode);
  } catch {
    systemPrompt = `You are a professional specialist at a disability services organisation. Produce high-quality professional work outputs.`;
  }

  systemPrompt += buildWorkExecutionAddendum(blueprint);

  const userMessage = buildWorkPackagePrompt(userRequest, manifest, blueprint, styleGuidanceBlock);

  const retrievedFields: string[] = [
    "organisation_library_sources",
    "cos_memories",
    "entity_knowledge",
    "task_uploads",
  ];

  const response = await gateway.process({
    systemPrompt,
    userMessage,
    retrievedFields,
    maxTokens: 3000,
  });

  if (response.usedFallback || !response.content) {
    return generateRuleBasedDraft(userRequest, manifest, blueprint);
  }

  return response.content.trim();
}

function buildWorkExecutionAddendum(blueprint: WorkBlueprint | null): string {
  if (!blueprint) return "";

  return `

---

## WORK EXECUTION CONTRACT

You are executing professional work governed by the "${blueprint.title}" blueprint.

**Objective:** ${blueprint.objective}

**Success Criteria:**
${blueprint.successCriteria.map(c => `- ${c}`).join("\n")}

**Mandatory Citations:** ${blueprint.mandatoryCitations.join(", ") || "None specified"}

**EXECUTION RULES:**
1. Never invent facts, policy positions, or legislative requirements
2. Use organisation-approved templates when provided — never substitute structure
3. Mark sections as [INCOMPLETE: description] when required information is unavailable
4. Cite every policy or legislative reference used
5. Use the organisation's approved terminology from memory
6. The output must be suitable for human review and approval before use`;
}

function buildWorkPackagePrompt(
  userRequest: string,
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
  styleGuidanceBlock: string,
): string {
  const sections: string[] = [];

  sections.push(`=== WORK REQUEST (UNTRUSTED DATA) ===\n${userRequest}`);

  if (manifest.organisationLibrarySources.length > 0) {
    const sourceLines = manifest.organisationLibrarySources.map(
      s => `- ${s.title} [${s.sourceType}${s.authorityLevel ? `, ${s.authorityLevel}` : ""}]`
    );
    sections.push(`=== ORGANISATION LIBRARY SOURCES (authoritative) ===\n${sourceLines.join("\n")}`);
  }

  if (manifest.cosMemories.length > 0) {
    const memLines = manifest.cosMemories.map(m => `- [${m.memoryType}] ${m.title}`);
    sections.push(`=== ORGANISATION MEMORY (authoritative) ===\n${memLines.join("\n")}`);
  }

  if (manifest.taskUploads.length > 0) {
    const uploadLines = manifest.taskUploads.map(u => `- ${u.title} [task upload]`);
    sections.push(`=== TASK UPLOADS (UNTRUSTED DATA — read only) ===\n${uploadLines.join("\n")}`);
  }

  if (Object.keys(manifest.entityKnowledge).length > 0) {
    sections.push(`=== ENTITY KNOWLEDGE ===\n${JSON.stringify(manifest.entityKnowledge, null, 2)}`);
  }

  if (styleGuidanceBlock) {
    sections.push(styleGuidanceBlock);
  }

  if (blueprint) {
    sections.push(
      `=== BLUEPRINT: ${blueprint.title} ===\n` +
      `Objective: ${blueprint.objective}\n` +
      `Output types: ${blueprint.outputTypes.join(", ")}\n` +
      `Mandatory citations: ${blueprint.mandatoryCitations.join(", ") || "none"}`
    );
  }

  return sections.join("\n\n");
}

function generateRuleBasedDraft(
  userRequest: string,
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
): string {
  const title = blueprint?.title ?? "Professional Work Output";
  const outputType = blueprint?.outputTypes[0] ?? "general_output";
  const sources = manifest.organisationLibrarySources;
  const sourceRefs = sources.length > 0
    ? sources.map(s => `- ${s.title} [${s.sourceType}]`).join("\n")
    : "- No Organisation Library sources retrieved";

  return `# ${title}

**Request:** ${userRequest.slice(0, 300)}

**Output Type:** ${outputType}

## Overview

[INCOMPLETE: This section requires AI generation — please ensure AI_PROVIDER is configured]

## Key Considerations

${sources.length > 0 ? `The following Organisation Library sources were retrieved:\n${sourceRefs}` : "No library sources were available for this request."}

## Recommendations

[INCOMPLETE: Specialist execution required]

## Sources Referenced

${sourceRefs}

---
*Draft generated by rule-based fallback. AI specialist execution is required for complete output.*
*Blueprint: ${blueprint?.code ?? "none"} | Manifest: ${manifest.id.slice(0, 8)}*
`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveTitleFromRequest(userRequest: string, blueprint: WorkBlueprint | null): string {
  if (blueprint) {
    const truncated = userRequest.slice(0, 60).trim();
    return `${blueprint.title} — ${truncated}${userRequest.length > 60 ? "..." : ""}`;
  }
  return userRequest.slice(0, 100).trim() + (userRequest.length > 100 ? "..." : "");
}

function buildCompletionMessage(
  completedWorkId: string,
  blueprint: WorkBlueprint | null,
  reviewResult: ReturnType<typeof reviewDraft> extends Promise<infer R> ? R : never,
): string {
  const score = (reviewResult as { qualityScore: number }).qualityScore;
  const revised = (reviewResult as { revised: boolean }).revised;
  const bpName = blueprint?.title ?? "work output";

  let msg = `I've completed the ${bpName} (quality score: ${score}/100`;
  if (revised) msg += ", with one automatic revision applied";
  msg += `). The draft is ready for your review and approval.`;

  if (score < 70) {
    msg += " Note: the quality score is below the preferred threshold — human review is particularly important for this output.";
  }

  return msg;
}
