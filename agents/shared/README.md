# @workspace/agent-shared

Shared utilities and base classes for NeedsOps AI+ agent implementations.

## Sprint 0 status

Shell. `BaseAgent` abstract class, prompt utilities.

## What lives here

- `BaseAgent` — abstract base class all agents extend
- `buildSystemPrompt` — constructs the system prompt from task context
- `truncateHistory` — manages conversation history within token limits

## What does NOT live here

Business logic, NDIS domain knowledge, and capability implementations belong in each individual agent package (`agents/needsops-compliance-officer`, etc.).
