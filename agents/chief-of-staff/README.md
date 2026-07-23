# NeedsOps Chief of Staff

The coordination layer of the NeedsOps AI+ workforce.

## Responsibility

Receives all incoming customer requests and routes them to the correct specialist agent. Consolidates multi-agent responses into a single, coherent reply.

## Sprint 0 status

Shell. `NeedsOpsChiefOfStaff` class with stub routing (direct capability lookup).

## Sprint 1 plan

- Implement LLM-based intent classification using OpenAI function-calling
- Integrate with OpenClaw gateway (behind the API — never exposed publicly)
- Support multi-agent task splitting for complex requests
- Return a consolidated, single response regardless of how many agents were involved

## Routing flow

```
Customer request
    ↓
Chief of Staff receives task
    ↓
Intent classification (LLM)
    ↓
RoutingDecision: targetAgentId + confidence + reasoning
    ↓
Target specialist agent executes task
    ↓
Consolidated response → customer
```
