# NeedsOps AI+ — Sprint 2 Architecture

## AI Workforce Foundation

---

## Overview

Sprint 2 establishes the AI Workforce architecture — the core model that all future AI capabilities will be built on. No AI execution occurs in this sprint. Everything is metadata, models, and deterministic orchestration.

---

## Architectural Principle

```
Customer Request
       ↓
 Chief of Staff        ← single entry point for all tasks
       ↓
 Intent Classification (deterministic keyword routing)
       ↓
 Specialist Selection
       ↓
 Execution Plan
       ↓
 Approval Gate (if required)
       ↓
 Simulated Execution   ← real execution added in future sprints
```

**Specialists never communicate directly with the customer** unless explicitly configured. The Chief of Staff owns all task routing decisions.

---

## Workforce Packs

Six packs are registered in this sprint:

| Pack | Tier | Status | Specialists |
|------|------|--------|-------------|
| Core Workforce | Starter | Available | 6 |
| Compliance Workforce | Professional | Available | 6 |
| Operations Workforce | Professional | Available | 5 |
| Finance Workforce | Professional | Available | 5 |
| HR Workforce | Professional | Available | 5 |
| Marketing Workforce | Enterprise | Coming Soon | 5 |

**Total specialists: 32**

---

## Specialist Model

Each specialist is described by pure metadata — no executable code:

```typescript
interface RegistrySpecialist {
  id: string;                        // e.g. "spec_compliance_officer"
  code: string;                      // e.g. "compliance_officer"
  displayName: string;               // e.g. "Compliance Officer"
  packCode: string;                  // which pack it belongs to
  description: string;               // human-readable purpose
  icon: string;                      // emoji icon
  colour: string;                    // hex brand colour
  capabilities: string[];            // capability codes this specialist can perform
  requiredPermissions: string[];     // RBAC permissions needed to invoke
  requiredEntitlements: string[];    // subscription entitlements needed
  approvalRequirements: ApprovalType; // what approval is needed for tasks
  executionStatus: "available" | "beta" | "coming_soon" | "deprecated";
  version: string;                   // semver
}
```

---

## Capability Registry

Capabilities are named, reusable actions. A specialist advertises which capabilities it can perform. The Chief of Staff uses these to route tasks.

**35 capabilities are registered** covering: compliance review, quality audit, policy management, incident review, roster management, financial reporting, payroll, HR, marketing, and general productivity.

---

## Chief of Staff (Deterministic Orchestration)

The Chief of Staff uses **keyword-based intent classification** — no LLM, no AI call:

1. Receives `{ title, description }` from the caller
2. Scores keywords against routing rules (each rule has: keywords, target capabilities, weight)
3. Selects top-scoring specialists (up to 4 specialists per task)
4. Determines the highest approval requirement across all selected specialists
5. Generates a numbered execution plan with estimated durations
6. Returns a `TaskPlan` object

**Intent classification is entirely synchronous and deterministic.** The same input always produces the same output. This makes it testable without mocking.

Future sprints will replace keyword routing with LLM-based intent classification (OpenClaw integration), while keeping the same `planTask()` interface.

---

## Task Model

```
Task States:
  draft → queued → planning → awaiting_approval → approved → executing → completed
                           ↓                                           ↓
                       cancelled ←───────────────────────────────── failed
                                                                        ↓
                                                                     queued (retry)
```

State transitions are validated by `isValidTransition(from, to)`. Terminal states (`completed`, `cancelled`) cannot transition out (except `failed → queued` for retry).

### Task lifecycle

1. Customer creates task via Task Centre
2. Task is immediately sent to Chief of Staff (`createTask` service)
3. Chief of Staff plans the task (synchronous, in-process)
4. Task moves to `planning` state, then `approved` or `awaiting_approval`
5. If awaiting approval, an `Approval` record is created
6. Once approved (manual in this sprint), task moves to `approved`
7. Execution is simulated (no real AI execution yet)

---

## Approval Model

Seven approval types are defined:

| Type | Description |
|------|-------------|
| `no_approval` | Proceeds immediately |
| `manager_approval` | Any manager-role member |
| `administrator_approval` | Any administrator-role member |
| `owner_approval` | Organisation owner only |
| `dual_approval` | Two separate approvers required |
| `compliance_approval` | Compliance-designated approver |
| `platform_approval` | NeedsOps platform team |

Approval priority (for conflict resolution when multiple specialists have different requirements):
`platform_approval > compliance_approval > dual_approval > owner_approval > administrator_approval > manager_approval > no_approval`

---

## Database Schema (Sprint 2 additions)

10 new tables:

| Table | Purpose |
|-------|---------|
| `specialists` | Specialist registry (platform-level) |
| `capabilities` | Named capability definitions |
| `specialist_capabilities` | Join table: which specialist has which capabilities |
| `tasks` | Platform-wide task entity (tenant-scoped) |
| `task_specialists` | Which specialists are assigned to a task |
| `task_execution_plans` | Chief of Staff's execution plan (JSONB) |
| `approvals` | Approval instances tied to tasks |
| `approval_rules` | Per-org approval rule overrides |
| `approval_history` | Immutable log of approval actions |

All task and approval tables include `organization_id` for tenant isolation.

---

## API Surface

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/workforce/packs` | List all workforce packs |
| GET | `/v1/workforce/packs/:code` | Get pack + its specialists |
| GET | `/v1/workforce/specialists` | List specialists (filterable by pack, status) |
| GET | `/v1/workforce/specialists/:code` | Get specialist + capabilities |
| GET | `/v1/workforce/capabilities` | List all capabilities |
| GET | `/v1/workforce/capabilities/:code` | Get capability + which specialists have it |

### Authenticated (tenant-scoped)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/workforce/plan` | Chief of Staff planning endpoint |
| GET | `/v1/organisations/:slug/tasks` | List tasks (filterable by state) |
| POST | `/v1/organisations/:slug/tasks` | Create task (triggers CoS planning) |
| GET | `/v1/organisations/:slug/tasks/:id` | Get task + execution plan |
| POST | `/v1/organisations/:slug/tasks/:id/transition` | Transition task state |
| DELETE | `/v1/organisations/:slug/tasks/:id` | Cancel task |
| GET | `/v1/organisations/:slug/approvals` | List approvals (filterable by state) |
| POST | `/v1/organisations/:slug/approvals` | Create approval |
| GET | `/v1/organisations/:slug/approvals/:id` | Get approval + history |
| POST | `/v1/organisations/:slug/approvals/:id/resolve` | Approve or reject |

---

## Relationship to Future Sprints

### OpenClaw Integration (Sprint 4+)
- Chief of Staff's `planTask()` signature is intentionally stable
- Replace `classifyIntent()` with an LLM call through the OpenClaw connector
- The `TaskPlan` output shape remains identical; only the routing logic changes

### Intelligence Engines (Sprint 5+)
- Each specialist will have an associated Intelligence Engine (an LLM + tool set)
- The task execution plan's `steps` array will drive actual execution
- `task_execution_plans.plan_data` stores the plan in a format ready for execution

### Connector Framework (Sprint 3)
- Specialists will use connectors to access external systems (NDIS portal, Xero, etc.)
- `requiredEntitlements` on specialists will map to connector permissions

### Billing (Sprint 3)
- `requiredEntitlements` and pack `tier` already encode the subscription requirements
- The billing system will gate access based on the org's active pack entitlements

---

## Web UI

- **Dashboard** — Workforce widgets: installed packs, available specialists, recent tasks, pending approvals
- **Workforce Explorer** (`/app/:slug/workforce`) — Browse all packs and specialists with status, capabilities, and approval requirements
- **Task Centre** (`/app/:slug/tasks`) — Create tasks, view queue by state, track progress
- **Approvals Centre** (`/app/:slug/approvals`) — Pending/approved/rejected/expired approvals with inline resolve

---

## Mobile

Mirror of web features with placeholder data (live API connection to be wired when mobile gets org context in Sprint 3):
- Workforce tab — pack and specialist browser
- Tasks tab — task list with state filtering
- Approvals tab — approval status with pending highlight banner
