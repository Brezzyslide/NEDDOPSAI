/**
 * BaseAgent — abstract base class for all NeedsOps AI+ specialist agents.
 *
 * Sprint 0 shell. Sprint 1+: add OpenAI/OpenClaw integration.
 */

import type {
  Agent,
  AgentIdentity,
  AgentCapability,
  AgentTask,
  AgentResponse,
} from "@workspace/agent-runtime";

export abstract class BaseAgent implements Agent {
  abstract getIdentity(): AgentIdentity;
  abstract getCapabilities(): AgentCapability[];

  canHandle(capability: string): boolean {
    return this.getCapabilities().some((c) => c.id === capability);
  }

  abstract execute(task: AgentTask): Promise<AgentResponse>;

  /** Helper: build a minimal completed response */
  protected buildResponse(
    task: AgentTask,
    content: string,
  ): AgentResponse {
    return {
      taskId: task.id,
      agentId: this.getIdentity().id,
      status: "completed",
      content,
      messages: [
        {
          role: "agent",
          content,
          timestamp: new Date().toISOString(),
        },
      ],
      completedAt: new Date().toISOString(),
    };
  }
}
