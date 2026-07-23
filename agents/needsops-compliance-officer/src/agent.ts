/**
 * NeedsOps Compliance Officer — Agent implementation
 *
 * Sprint 0: shell extending BaseAgent.
 * Sprint 1+: implement execute() with real OpenAI calls and NDIS domain knowledge.
 */

import { BaseAgent } from "@workspace/agent-shared";
import type {
  AgentIdentity,
  AgentCapability,
  AgentTask,
  AgentResponse,
} from "@workspace/agent-runtime";
import { COMPLIANCE_OFFICER_CAPABILITIES } from "./capabilities.js";

export class ComplianceOfficerAgent extends BaseAgent {
  getIdentity(): AgentIdentity {
    return {
      id: "needsops-compliance-officer",
      name: "NeedsOps Compliance Officer",
      role: "compliance_officer",
      description:
        "Specialist AI compliance officer for Australian NDIS providers. " +
        "Monitors NDIS Practice Standards, manages audit readiness, " +
        "classifies reportable incidents, and maintains compliance documentation.",
      version: "0.1.0",
    };
  }

  getCapabilities(): AgentCapability[] {
    return COMPLIANCE_OFFICER_CAPABILITIES;
  }

  /**
   * Sprint 0: stub response.
   * Sprint 1+: implement with OpenAI GPT-4o + NDIS practice standards knowledge base.
   */
  async execute(task: AgentTask): Promise<AgentResponse> {
    // TODO Sprint 1: replace with real OpenAI execution
    return this.buildResponse(
      task,
      `[Sprint 0 stub] ComplianceOfficerAgent received task: "${task.instruction}". ` +
        `Capability: ${task.capability}. ` +
        `Full implementation ships in Sprint 1.`,
    );
  }
}
