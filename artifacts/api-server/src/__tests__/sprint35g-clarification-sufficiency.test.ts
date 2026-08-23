import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  classifyMessage,
  type MessageContext,
} from "../services/conversationIntelligenceService";

const root = resolve(__dirname, "..");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

const baseCtx: MessageContext = {
  organizationId: "org-test",
  conversationId: "conv-test",
  currentTaskId: undefined,
  currentTaskState: undefined,
  currentTaskTitle: undefined,
  recentMessages: [],
};

describe("Sprint 35G clarification sufficiency", () => {
  it("makes a standard comprehensive NDIS risk assessment template task-ready", () => {
    const result = classifyMessage(
      "Can you design a standard comprehensive NDIS risk assessment template for my NDIS client",
      baseCtx,
    );

    expect(result.conversationMode).toBe("task_intent");
    expect(result.clarificationRequired).toBe(false);
    expect(result.clarificationQuestions).toEqual([]);
    expect(result.proposedTask?.title.toLowerCase()).toContain("risk assessment template");
  });

  it("treats all areas of risk as sufficient professional scope", () => {
    const result = classifyMessage(
      "Develop the NDIS client risk assessment template for all areas of risk",
      baseCtx,
    );

    expect(result.conversationMode).toBe("task_intent");
    expect(result.clarificationRequired).toBe(false);
    expect(result.customerResponse.toLowerCase()).not.toContain("which risk areas");
  });

  it("delegates relevant-domain selection when the user says to come up with it", () => {
    const result = classifyMessage(
      "Create a standard NDIS risk assessment template; you can come up with the relevant domains",
      baseCtx,
    );

    expect(result.conversationMode).toBe("task_intent");
    expect(result.clarificationRequired).toBe(false);
    expect(result.customerResponse.toLowerCase()).not.toContain("which");
  });

  it("treats all relevant NDIS clauses as sufficient service-agreement clause scope", () => {
    const result = classifyMessage(
      "Develop a compliant NDIS service agreement with all relevant NDIS clauses",
      baseCtx,
    );

    expect(result.conversationMode).toBe("task_intent");
    expect(result.clarificationRequired).toBe(false);
    expect(result.clarificationQuestions).toEqual([]);
  });

  it("preserves genuinely mandatory clarification for audit registration groups", () => {
    const result = classifyMessage(
      "Prepare an NDIS audit for us",
      baseCtx,
    );

    expect(result.clarificationRequired).toBe(true);
    expect(result.clarificationQuestions.join(" ")).toContain("registration groups");
  });

  it("prompts the OpenAI CoS path not to repeat professional-methodology clarifications", () => {
    const cosPrompt = source("services/chiefOfStaffLLMService.ts");
    const intelligence = source("services/conversationIntelligenceService.ts");

    expect(cosPrompt).toContain("CLARIFICATION SUFFICIENCY");
    expect(cosPrompt).toContain("Do not ask the user to perform the specialist's professional methodology");
    expect(cosPrompt).toContain("all relevant NDIS clauses");
    expect(cosPrompt).toContain("Do not ask substantially the same clarification twice");
    expect(intelligence).toContain("BROAD_PROFESSIONAL_SCOPE_PATTERNS");
    expect(intelligence).toContain("normalizeClarificationForProfessionalScope");
  });
});
