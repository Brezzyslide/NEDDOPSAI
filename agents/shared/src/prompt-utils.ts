/**
 * Prompt utilities for agent implementations.
 *
 * Sprint 0: stubs. Sprint 1+: add prompt templates, context injection,
 * NDIS-specific formatting helpers.
 */

import type { AgentTaskContext, AgentMessage } from "@workspace/agent-runtime";

/**
 * Formats the task context into a system prompt string.
 * Sprint 1+: expand with org profile, subscription tier, and relevant integration state.
 */
export function buildSystemPrompt(
  agentName: string,
  taskContext: AgentTaskContext,
): string {
  return [
    `You are ${agentName}, a specialist AI worker on the NeedsOps AI+ platform.`,
    `You are acting on behalf of organisation ID: ${taskContext.organizationId}.`,
    `Your responses must be professional, concise, and actionable.`,
    `You must not perform any action that requires human approval without explicitly flagging it.`,
  ].join("\n");
}

/**
 * Truncates conversation history to fit within a token budget.
 * Sprint 1+: replace with a proper token counter.
 */
export function truncateHistory(
  history: AgentTaskContext["history"],
  maxMessages = 20,
): AgentTaskContext["history"] {
  if (history.length <= maxMessages) return history;
  const system = history.filter((m: AgentMessage) => m.role === "system");
  const rest = history.filter((m: AgentMessage) => m.role !== "system");
  return [...system, ...rest.slice(-maxMessages)];
}
