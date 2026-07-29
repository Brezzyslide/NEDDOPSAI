# AI Executive Assistant — Runtime Manifest

> **Version:** 1.0.0  
> **Status:** employee_file_draft (manifest not compiled until DNA approved)  
> **Last Updated:** Sprint 13  
> **Architecture Level:** Runtime Manifest (Layer 5 of 6)

---

## What the Runtime Manifest Is

The Runtime Manifest is the lightweight, task-scoped representation of the Executive Assistant that is sent to the execution runtime (OpenClaw) for a single task execution.

It is **not** the Employee File. The Employee File is the complete professional identity of the EA — a rich, comprehensive document containing soul, personality, full values, full DNA profiles, and file metadata. The Runtime Manifest is a focused, security-conscious compilation of only what is needed to execute one specific task.

> **The Employee File is never sent to OpenClaw. Only the compiled Runtime Manifest is. This is an architectural invariant.**

---

## Why the Runtime Manifest Exists

| Reason | Explanation |
|---|---|
| **Security** | The Employee File contains sections (soul, full personality, detailed values) that are platform-layer definitions. Sending them to the execution runtime would expose internal architecture unnecessarily. |
| **Precision** | A task execution needs the EA's identity, permissions, and task context — not its full character definition. A focused manifest reduces noise and prevents the execution runtime from being confused by irrelevant content. |
| **Performance** | A smaller, targeted manifest reduces token consumption at execution time, making every task run leaner and faster. |
| **Least privilege** | The execution runtime receives exactly what it needs to do its job — no more. |

---

## What IS Included in the EA Runtime Manifest

### Employee Identity

| Field | Type | Example Value |
|---|---|---|
| `employeeId` | `string` | `"executive_assistant"` |
| `title` | `string` | `"AI Executive Assistant"` |
| `department` | `string` | `"Executive"` |
| `dnaVersion` | `string` | `"1.0.0"` |
| `workerProfileVersion` | `string` | `"1.0.0"` |
| `constitutionVersion` | `string` | `"1.0.0"` |

### Current Task (Injected at Execution Time)

| Field | Type | Purpose |
|---|---|---|
| `currentTask.taskId` | `string` | Unique identifier for this specific task execution |
| `currentTask.capabilityCode` | `string` | The capability being invoked (e.g. `"calendar.create_event"`, `"communications.draft"`) |
| `currentTask.conversationContext` | `string` | The conversation history and current request |
| `currentTask.organisationalContext` | `string` | Relevant organisational context for this task (tenant, active relationships, etc.) |

`currentTask` is `null` if the manifest is compiled without a task context (e.g. for validation purposes).

### Active Capabilities

| Field | Type | Purpose |
|---|---|---|
| `activeCapabilities` | `string[]` | The capability codes available to the EA for this execution, scoped to the current task context |

### Runtime Permissions

| Field | Type | Purpose |
|---|---|---|
| `runtimePermissions.execution` | `string[]` | What execution operations are permitted (e.g. `exec.calendar-write`, `exec.comms-send`) |
| `runtimePermissions.connectors` | `string[]` | Which external connectors may be used (e.g. `calendar`, `email`, `contacts`) |
| `runtimePermissions.memory` | `string[]` | Which memory categories may be read or written |
| `runtimePermissions.delegation` | `string[]` | What delegation operations are permitted (if any) |

### Execution Boundaries

| Field | Type | Purpose |
|---|---|---|
| `executionBoundaries.canDo` | `string[]` | Explicit list of permitted actions for this execution |
| `executionBoundaries.cannotDo` | `string[]` | Explicit list of prohibited actions |
| `executionBoundaries.requiresApproval` | `string[]` | Actions that require approval before proceeding (high-risk communication categories) |
| `executionBoundaries.hardStops` | `string[]` | Actions that must never be taken under any circumstances |

### Security Constraints

| Field | Type | Purpose |
|---|---|---|
| `securityConstraints` | `string[]` | Active security constraints for this execution (tenant isolation, connector restrictions, approval gate status) |

### Constitution Statements

| Field | Type | Purpose |
|---|---|---|
| `constitutionStatements` | `string[]` | The ten constitutional principle statements — always included verbatim |

### Manifest Metadata

| Field | Type | Purpose |
|---|---|---|
| `compiledAt` | `string` | ISO 8601 timestamp of when the manifest was compiled |

---

## What IS EXCLUDED from the EA Runtime Manifest

The following sections from the Executive Assistant Employee File are intentionally excluded from the Runtime Manifest:

| Excluded Section | Type | Why Excluded |
|---|---|---|
| `soul` | `EmployeeSoul` | The EA's soul (discreet, reliable, precise, etc.) is a platform-layer character definition. The execution runtime does not need the soul structure — it reflects the soul through the DNA and constitution it operates under. |
| `personality` | `EmployeePersonality` | Full personality traits and avoid list are design-time definitions. Personality is expressed through the DNA profile, not transmitted directly to the runtime. |
| `values.roleSpecificValues` (full detail) | `string[]` | The full enumeration of twelve role-specific values is not required at execution time. The Constitution statements (which are included) provide the operative values the runtime needs. |
| `decisionPhilosophy` (full) | `EmployeeDecisionPhilosophy` | The full ten-step methodology is encoded in the DNA profile, not re-transmitted as raw prose to the runtime. |
| `professionalDNA.v1` (full profile) | `EmployeeDNAVersion` | The full DNA profile object is not transmitted; only the active version identifier is included so the runtime knows which profile governs this execution. |
| `professionalDNA` (draft, if present) | `EmployeeDNAVersion?` | Draft DNA profiles are never included in the manifest — only the active published version is operative. |
| `responsibilities` (full prose) | `EmployeeResponsibilities` | Responsibilities are a definition-time construct; the runtime receives permission codes, not a prose responsibilities list. |
| `professionalOath` | `string` | The oath is a soul-layer commitment; it shapes DNA and behaviour but is not separately transmitted to the runtime. |
| `fileVersion`, `createdAt`, `updatedAt` | `string` | Employee File metadata is an internal platform record; it is not relevant to task execution. |
| `activationStatus` | `string` | Activation status is a platform-layer record; the runtime does not process it (the dispatch system validates it before manifest compilation). |

---

## Compilation Flow

The EA Runtime Manifest is compiled by the `compileRuntimeManifest()` function:

```
┌─────────────────────────────────────────────────────┐
│             Executive Assistant Employee File         │
│  (complete — soul, DNA, values, personality, etc.)   │
└──────────────────────────┬──────────────────────────┘
                           │
                           │  compileRuntimeManifest(
                           │    executiveAssistantFile,
                           │    taskContext?
                           │  )
                           │
┌──────────────────────────▼──────────────────────────┐
│                   Runtime Manifest                    │
│  (lightweight — identity + permissions + task only)  │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
                   Execution Runtime
                   (OpenClaw / Dispatcher)
```

Before compilation:
1. Constitution inheritance is validated — if not valid, compilation fails
2. DNA version is confirmed as `approved` — if DNA is `draft`, compilation fails
3. Worker Profile version is confirmed as active
4. Tenant context is confirmed

---

## Task Context Injection

The manifest can be compiled in two modes:

**1. Base manifest (no task context)** — used for validation, capability checks, and pre-execution setup:

```typescript
const baseManifest = compileRuntimeManifest(executiveAssistantFile);
// currentTask: null
```

**2. Task manifest (with context)** — used for actual task execution:

```typescript
const taskContext: RuntimeTaskContext = {
  taskId: "task-ea-2026-sprint13-001",
  capabilityCode: "calendar.create_event",
  conversationContext: "Please schedule the board preparation meeting for next Tuesday at 10am...",
  organisationalContext: "Client: Acme Services. Tenant: acme-001. Board meeting is 15 Nov.",
};

const executionManifest = compileRuntimeManifest(executiveAssistantFile, taskContext);
// currentTask: { taskId, capabilityCode, conversationContext, organisationalContext }
```

The task context is injected at dispatch time. The same Employee File supports unlimited task executions — each receives its own task-specific manifest.

---

## Example Manifest Structure (Abbreviated)

The following illustrates the structure of a compiled EA Runtime Manifest:

```json
{
  "employeeId": "executive_assistant",
  "title": "AI Executive Assistant",
  "department": "Executive",
  "dnaVersion": "1.0.0",
  "workerProfileVersion": "1.0.0",
  "constitutionVersion": "1.0.0",

  "currentTask": {
    "taskId": "task-ea-2026-sprint13-001",
    "capabilityCode": "calendar.create_event",
    "conversationContext": "Schedule board prep meeting for next Tuesday 10am...",
    "organisationalContext": "Client: Acme Services. Board meeting 15 Nov."
  },

  "activeCapabilities": [
    "calendar.read",
    "calendar.management",
    "calendar.create_event",
    "calendar.propose_times"
  ],

  "runtimePermissions": {
    "execution": [
      "exec.calendar-read",
      "exec.calendar-write",
      "exec.calendar-propose",
      "exec.escalate"
    ],
    "connectors": ["calendar", "contacts"],
    "memory": [
      "mem.recurring-meetings.read",
      "mem.comm-preferences.read",
      "mem.standard-procedures.read"
    ],
    "delegation": []
  },

  "executionBoundaries": {
    "canDo": [
      "Read calendar data",
      "Create calendar events with conflict check",
      "Propose meeting times",
      "Look up attendee availability"
    ],
    "cannotDo": [
      "Send communications without approval gate",
      "Access banking, payroll, or clinical systems",
      "Make financial commitments",
      "Skip conflict check before creating events"
    ],
    "requiresApproval": [
      "Sending any high-risk communication category",
      "Creating commitments on behalf of the organisation"
    ],
    "hardStops": [
      "Transmit high-risk communication without explicit human approval",
      "Access prohibited connector categories",
      "Store prohibited information in memory",
      "Proceed with confidence below block threshold (0.35)"
    ]
  },

  "securityConstraints": [
    "tenant_isolation:acme-001",
    "approval_gate:active",
    "connector_restriction:prohibited_categories_enforced"
  ],

  "constitutionStatements": [
    "..."
  ],

  "compiledAt": "2026-11-01T09:00:00.000Z"
}
```

---

## Security Rationale

### Why OpenClaw Receives Only the Manifest

Sending the full Employee File to OpenClaw would:

| Risk | Consequence |
|---|---|
| **Expose soul and personality definitions** | Internal character architecture would be transmitted to an external system, creating unnecessary exposure of platform IP |
| **Expose draft DNA** | The draft v1.0.0 DNA profile (before approval) could influence execution behaviour if transmitted |
| **Expose file metadata** | Creation timestamps and version history are administrative records with no role in task execution |
| **Increase attack surface** | Any system that receives more data than it needs has a larger potential exposure surface |
| **Violate least privilege** | The execution runtime should receive exactly the data it needs to do its job — no more |

### The Compilation Boundary Is the Security Gate

The `compileRuntimeManifest()` function is the security gate for the Executive Assistant, as for all AI employees. It is the only authorised pathway from Employee File to execution context. What exits is a carefully controlled subset — not more.

---

## Manifest Compilation Gate

> **Important:** The EA Runtime Manifest cannot be compiled until the DNA activation gate is passed.

```
DNA Status: draft  →  Manifest compilation: BLOCKED
DNA Status: approved  →  Manifest compilation: PERMITTED
```

This is enforced by the `compileRuntimeManifest()` function, which checks `file.professionalDNA.activeVersion` before proceeding. If no active version is set (i.e., DNA is still in draft), the function throws and no manifest is produced.

---

*Runtime Manifest v1.0.0 — Sprint 13. The EA Runtime Manifest is the security boundary between the platform layer and the execution layer.*
