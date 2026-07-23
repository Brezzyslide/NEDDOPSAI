/**
 * @workspace/agent-runtime — Runner and router interfaces
 *
 * Sprint 0 shell. Sprint 1+: concrete implementations backed by OpenAI/OpenClaw.
 */

import type {
  AgentIdentity,
  AgentTask,
  AgentResponse,
  RoutingDecision,
  AgentCapability,
} from "./types.js";

// ─── Agent interface ──────────────────────────────────────────────────────────

/**
 * Every specialist agent must implement this interface.
 * The platform invokes agents exclusively through this contract.
 */
export interface Agent {
  /** Returns the agent's identity metadata */
  getIdentity(): AgentIdentity;
  /** Returns the capabilities this agent supports */
  getCapabilities(): AgentCapability[];
  /** Returns true if this agent can handle the given capability */
  canHandle(capability: string): boolean;
  /** Execute a task and return a response */
  execute(task: AgentTask): Promise<AgentResponse>;
}

// ─── Agent registry ───────────────────────────────────────────────────────────

/**
 * The runtime registry of all available agents.
 * Sprint 1+: agents register themselves on startup.
 */
export interface AgentRegistry {
  register(agent: Agent): void;
  get(agentId: string): Agent | undefined;
  list(): Agent[];
  /** Find agents that can handle a given capability */
  findByCapability(capability: string): Agent[];
}

// ─── Chief of Staff router ────────────────────────────────────────────────────

/**
 * The Chief of Staff routes incoming tasks to the correct specialist agent.
 *
 * Sprint 0: shell only.
 * Sprint 1+: implemented using OpenClaw + OpenAI function-calling to determine routing.
 *
 * Flow:
 *   user request → Chief of Staff → RoutingDecision → target Agent(s) → consolidated response
 */
export interface ChiefOfStaffRouter {
  /**
   * Analyse the task and decide which agent(s) should handle it.
   */
  route(task: AgentTask): Promise<RoutingDecision>;

  /**
   * Execute a task end-to-end: route → dispatch → consolidate → return.
   */
  dispatch(task: AgentTask): Promise<AgentResponse>;
}

// ─── Task queue interface (Sprint 2+) ────────────────────────────────────────

/**
 * Interface for background task processing.
 * Sprint 2+: implemented with BullMQ or pg-boss.
 */
export interface TaskQueue {
  enqueue(task: AgentTask): Promise<string>;
  getStatus(taskId: string): Promise<"queued" | "processing" | "completed" | "failed">;
  getResult(taskId: string): Promise<AgentResponse | null>;
}
