/**
 * NeedsOps Chief of Staff — Task Router
 *
 * The Chief of Staff receives all incoming customer requests and routes them
 * to the correct specialist agent(s).
 *
 * Sprint 0: shell with intent classification stub.
 * Sprint 1+: implement with OpenAI function-calling + OpenClaw routing.
 *
 * Routing flow:
 *   User request → intent classification → RoutingDecision → dispatch to agent(s)
 */

import type {
  ChiefOfStaffRouter,
  AgentRegistry,
  AgentTask,
  AgentResponse,
  RoutingDecision,
} from "@workspace/agent-runtime";

export class NeedsOpsChiefOfStaff implements ChiefOfStaffRouter {
  constructor(private readonly registry: AgentRegistry) {}

  /**
   * Classify the task and decide which agent should handle it.
   * Sprint 1+: replace with LLM-based intent classification.
   */
  async route(task: AgentTask): Promise<RoutingDecision> {
    const agents = this.registry.findByCapability(task.capability);

    if (agents.length === 0) {
      return {
        targetAgentId: "unresolved",
        confidence: 0,
        reasoning: `No agent found for capability: ${task.capability}`,
        split: false,
      };
    }

    const target = agents[0]!;
    return {
      targetAgentId: target.getIdentity().id,
      confidence: 0.9,
      reasoning: `Direct capability match: ${task.capability}`,
      split: false,
    };
  }

  /**
   * Route the task and execute it end-to-end.
   */
  async dispatch(task: AgentTask): Promise<AgentResponse> {
    const decision = await this.route(task);
    const agent = this.registry.get(decision.targetAgentId);

    if (!agent) {
      return {
        taskId: task.id,
        agentId: "chief-of-staff",
        status: "failed",
        content: `Could not route task: no agent found for '${decision.targetAgentId}'.`,
        messages: [],
        completedAt: new Date().toISOString(),
      };
    }

    return agent.execute(task);
  }
}
