# @workspace/agent-runtime

The public interface between the NeedsOps AI+ platform and its AI agent workforce.

## Sprint 0 status

Functional types and interfaces. No concrete implementations yet.

## Architecture

```
User request
    ↓
API server receives task
    ↓
ChiefOfStaffRouter.dispatch(task)
    ↓
RoutingDecision → target Agent(s)
    ↓
Agent.execute(task) → AgentResponse
    ↓
Consolidated response returned to user
```

## Key interfaces

- `Agent` — every specialist agent implements this
- `AgentRegistry` — runtime registry of all agents
- `ChiefOfStaffRouter` — routes tasks to the correct agent(s)
- `TaskQueue` — background task processing (Sprint 2+)

## Sprint 1 plan

- Implement `AgentRegistry` with in-memory store
- Implement `ChiefOfStaffRouter` using OpenAI function-calling for intent classification
- Wire to `agents/chief-of-staff` package
- Connect OpenClaw gateway behind the API (never exposed directly)
