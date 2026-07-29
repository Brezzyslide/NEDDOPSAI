# Runtime Manifest — Architecture and Usage

> **Version:** 1.0.0  
> **Status:** Active  
> **Architecture Level:** Runtime Manifest (Layer 5 of 6)  
> **Source Type:** `RuntimeManifest` (`lib/workforce-dna/src/employee/types.ts`)

---

## What the Runtime Manifest Is

The Runtime Manifest is the lightweight, task-scoped representation of an AI Employee that is sent to the execution runtime (OpenClaw) for a single task execution.

It is **not** the Employee File. The Employee File is the complete professional identity of an AI Employee — a rich, comprehensive document containing soul, personality, full values, full DNA profiles, and file metadata. The Runtime Manifest is a focused, security-conscious compilation of only what is needed to execute one specific task.

### Why It Exists

The separation of Employee File from Runtime Manifest exists for three reasons:

| Reason | Explanation |
|---|---|
| **Security** | The Employee File contains sections (soul, full personality, detailed values) that are platform-layer definitions. Sending them to the execution runtime would expose internal architecture to external systems unnecessarily. |
| **Precision** | A task execution needs the employee's identity, permissions, and task context — not their full character definition. A focused manifest reduces noise and prevents the execution runtime from being confused by irrelevant content. |
| **Performance** | A smaller, targeted manifest reduces token consumption at execution time, making every task run leaner and faster. |

> **The Employee File is never sent to OpenClaw.**  
> Only the compiled Runtime Manifest is. This is an architectural invariant.

---

## The Compilation Process

The Runtime Manifest is produced by the `compileRuntimeManifest()` function, which takes an Employee File and an optional task context as inputs and produces a `RuntimeManifest` as output.

```
┌─────────────────────────────────────────────────────┐
│                   Employee File                       │
│  (complete — soul, DNA, values, personality, etc.)   │
└──────────────────────────┬──────────────────────────┘
                           │
                           │  compileRuntimeManifest(
                           │    employeeFile,
                           │    taskContext?
                           │  )
                           │
┌──────────────────────────▼──────────────────────────┐
│                  Runtime Manifest                     │
│  (lightweight — identity + permissions + task only)  │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
                   Execution Runtime
                   (OpenClaw / Dispatcher)
```

The compilation step is the security boundary. What enters `compileRuntimeManifest()` is the full Employee File. What exits is a carefully controlled subset.

---

## What IS Included in the Manifest

The following fields are present in every compiled `RuntimeManifest`:

### Employee Identity

| Field | Type | Purpose |
|---|---|---|
| `employeeId` | `string` | Role code — identifies which employee is executing (e.g. `"chief-of-staff"`) |
| `title` | `string` | Human-readable professional title (e.g. `"AI Chief of Staff"`) |
| `department` | `string` | Department the employee belongs to (e.g. `"Executive"`) |
| `dnaVersion` | `string` | The active DNA version used for this execution (e.g. `"1.0.0"`) |
| `workerProfileVersion` | `string` | The Worker Profile version in use (e.g. `"1.0.0"`) |
| `constitutionVersion` | `string` | Must always be present — confirms Constitution is in effect |

### Current Task (Injected at Execution Time)

| Field | Type | Purpose |
|---|---|---|
| `currentTask.taskId` | `string` | Unique identifier for this specific task execution |
| `currentTask.capabilityCode` | `string` | The capability being invoked (e.g. `"executive.brief"`) |
| `currentTask.conversationContext` | `string` | The conversation history and current request |
| `currentTask.organisationalContext` | `string` | Relevant organisational context for this task |

`currentTask` may be `null` if the manifest is compiled without a task context (e.g. for validation purposes).

### Active Capabilities

| Field | Type | Purpose |
|---|---|---|
| `activeCapabilities` | `string[]` | The capability codes available to this employee for this execution |

This is scoped to capabilities the employee holds **and** that are relevant to the current task context.

### Runtime Permissions

| Field | Type | Purpose |
|---|---|---|
| `runtimePermissions.execution` | `string[]` | What execution operations are permitted |
| `runtimePermissions.connectors` | `string[]` | Which external connectors may be used (empty for Chief of Staff) |
| `runtimePermissions.memory` | `string[]` | Which memory categories may be read or written |
| `runtimePermissions.delegation` | `string[]` | What delegation operations are permitted |

### Execution Boundaries

| Field | Type | Purpose |
|---|---|---|
| `executionBoundaries.canDo` | `string[]` | Explicit list of permitted actions |
| `executionBoundaries.cannotDo` | `string[]` | Explicit list of prohibited actions |
| `executionBoundaries.requiresApproval` | `string[]` | Actions that require approval before proceeding |
| `executionBoundaries.hardStops` | `string[]` | Actions that must never be taken under any circumstances |

### Security Constraints

| Field | Type | Purpose |
|---|---|---|
| `securityConstraints` | `string[]` | Active security constraints for this execution |

### Constitution Statements

| Field | Type | Purpose |
|---|---|---|
| `constitutionStatements` | `string[]` | The ten constitutional principle statements — always included verbatim |

The Constitution statements are always included in the manifest. The execution runtime must have the ten principles available at all times, even in the lean manifest format.

### Manifest Metadata

| Field | Type | Purpose |
|---|---|---|
| `compiledAt` | `string` | ISO 8601 timestamp of when the manifest was compiled |

---

## What IS EXCLUDED from the Manifest

The following Employee File sections are **intentionally excluded** from the Runtime Manifest:

| Excluded Section | Type | Why Excluded |
|---|---|---|
| `soul` | `EmployeeSoul` | Enduring character definition is a platform-layer concern; the execution runtime does not need to know the soul structure — it reflects the soul through the DNA and constitution it operates under |
| `personality` | `EmployeePersonality` | Full personality traits and avoid list are design-time definitions; the personality is expressed through the DNA profile, not transmitted directly to the runtime |
| `values.roleSpecificValues` (full detail) | `string[]` | The full enumeration of role-specific values is not required at execution time; the Constitution statements (which are included) provide the operative values the runtime needs |
| `decisionPhilosophy` (full) | `EmployeeDecisionPhilosophy` | The full decision philosophy is encoded in the DNA profile, not re-transmitted as raw data to the runtime |
| `professionalDNA.v1` (full profile) | `EmployeeDNAVersion` | The full DNA profile object is not transmitted; only the active version identifier is included so the runtime knows which profile governs this execution |
| `professionalDNA.v2` (draft) | `EmployeeDNAVersion?` | Draft DNA profiles are never included in the manifest — only the active published version is operative |
| `responsibilities` (full) | `EmployeeResponsibilities` | Responsibilities are a definition-time construct; the runtime receives permission codes, not a prose responsibilities list |
| `communication` (full) | `EmployeeCommunicationStyle` | Communication style is shaped by the DNA profile; it is not separately transmitted to the runtime |
| `fileVersion`, `createdAt`, `updatedAt` | `string` | Employee File metadata is an internal platform record; it is not relevant to task execution |

---

## How Task Context Is Injected at Execution Time

The manifest can be compiled in two modes:

**1. Base manifest (no task context)** — used for validation, capability checks, and pre-execution setup:

```typescript
const baseManifest = compileRuntimeManifest(employeeFile);
// currentTask: null
```

**2. Task manifest (with context)** — used for actual task execution:

```typescript
const taskContext: RuntimeTaskContext = {
  taskId: "task-2026-07-29-001",
  capabilityCode: "executive.brief",
  conversationContext: "Organisation Owner has requested a briefing on Q3 compliance status...",
  organisationalContext: "NeedsOps client: Acme Corp. Industry: Healthcare. Active regulations: ...",
};

const executionManifest = compileRuntimeManifest(employeeFile, taskContext);
// currentTask: { taskId, capabilityCode, conversationContext, organisationalContext }
```

The task context is injected at dispatch time, not at Employee File load time. This means the same Employee File can be used across unlimited task executions — each execution receives its own task-specific manifest compiled from the same underlying file.

---

## Code Example: Full compileRuntimeManifest() Usage

```typescript
import type { EmployeeFile, RuntimeManifest, RuntimeTaskContext } from "./employee/types.js";
import { validateConstitutionInheritance, CONSTITUTION_VERSION, getConstitutionStatements } from "./constitution.js";

function compileRuntimeManifest(
  file: EmployeeFile,
  taskContext?: RuntimeTaskContext,
): RuntimeManifest {
  // 1. Validate Constitution inheritance before compilation
  const constitutionValid = validateConstitutionInheritance(
    file.values.constitutionVersion,
    file.values.constitutionInherited,
  );

  if (!constitutionValid) {
    throw new Error(
      `Cannot compile Runtime Manifest: Employee File for "${file.identity.roleCode}" ` +
      `has invalid Constitution inheritance. ` +
      `Expected version "${CONSTITUTION_VERSION}", ` +
      `declared version "${file.values.constitutionVersion}", ` +
      `inherited: ${file.values.constitutionInherited}`,
    );
  }

  // 2. Determine active DNA version
  const dnaVersion = file.professionalDNA.activeVersion;

  // 3. Compile the manifest — include only permitted fields
  const manifest: RuntimeManifest = {
    // Employee identity
    employeeId: file.identity.roleCode,
    title: file.identity.title,
    department: file.identity.department,
    dnaVersion,
    workerProfileVersion: file.workerProfile.version,
    constitutionVersion: file.values.constitutionVersion,

    // Task context (null if not provided)
    currentTask: taskContext
      ? {
          taskId: taskContext.taskId,
          capabilityCode: taskContext.capabilityCode,
          conversationContext: taskContext.conversationContext,
          organisationalContext: taskContext.organisationalContext,
        }
      : null,

    // Active capabilities from Worker Profile
    activeCapabilities: file.workerProfile.availableCapabilities,

    // Runtime permissions from Worker Profile
    runtimePermissions: {
      execution: file.workerProfile.executionPermissions,
      connectors: file.workerProfile.connectorPermissions,
      memory: file.workerProfile.memoryPermissions,
      delegation: file.workerProfile.delegationPermissions,
    },

    // Execution boundaries derived from Authority
    executionBoundaries: {
      canDo: file.authority.may,
      cannotDo: file.authority.mayNot,
      requiresApproval: [],
      hardStops: file.authority.mayNot,
    },

    // Security constraints
    securityConstraints: [],

    // Constitution statements — always included
    constitutionStatements: getConstitutionStatements(),

    // Metadata
    compiledAt: new Date().toISOString(),
  };

  return manifest;
}

// ── Usage in dispatch ─────────────────────────────────────────────────────────

// Load the Chief of Staff Employee File
import { chiefOfStaffEmployeeFile } from "./employees/chief-of-staff/employee.js";

// Compile for a specific task
const manifest = compileRuntimeManifest(chiefOfStaffEmployeeFile, {
  taskId: "task-2026-07-29-001",
  capabilityCode: "executive.brief",
  conversationContext: "Please prepare a briefing on our Q3 compliance position.",
  organisationalContext: "Client: Acme Corp. Sector: Healthcare.",
});

// Send ONLY the manifest to the execution runtime
// Never send chiefOfStaffEmployeeFile directly
await openClaw.execute(manifest);
```

---

## Security Rationale

### Why OpenClaw Receives Only the Manifest

OpenClaw is the execution runtime — the external AI system that processes tasks. It is a powerful system, but it operates at the task execution layer. The Employee File is a platform-layer artefact.

Sending the full Employee File to OpenClaw would:

| Risk | Consequence |
|---|---|
| **Expose soul and personality definitions** | Internal character architecture would be transmitted to an external system, creating unnecessary exposure of platform IP |
| **Expose draft DNA profiles** | A draft v2.0.0 DNA profile, not yet approved for production, could influence execution behaviour if transmitted |
| **Expose file metadata** | Creation timestamps and version history are administrative records with no role in task execution |
| **Increase attack surface** | Any system that receives more data than it needs has a larger potential exposure surface |
| **Violate principle of least privilege** | The execution runtime should receive exactly the data it needs to do its job — no more |

The Runtime Manifest is the solution: a purpose-built, security-conscious subset of the Employee File that gives the execution runtime everything it needs for one task and nothing it does not need.

### The Compilation Boundary Is the Security Gate

The `compileRuntimeManifest()` function is the security gate. It is the only pathway from Employee File to execution context. Every field in the `RuntimeManifest` type was deliberately chosen. Anything not in the `RuntimeManifest` interface does not cross the boundary — the TypeScript type system enforces this structurally.

---

## Complete Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                  NeedsOps Workforce Constitution                      │
│                     10 Immutable Principles                           │
│                        constitution.ts · v1.0.0                      │
│                    ┌──────────────────────────┐                      │
│                    │ Inherited by all employees│                      │
│                    └──────────────────────────┘                      │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Employee File                                │
│    identity · soul · mission · values · personality · authority      │
│      decisions · communication · responsibilities · DNA              │
│                   employee/types.ts · EmployeeFile                   │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  SENSITIVE SECTIONS (never leave this layer)                 │    │
│  │  soul · personality · full values · full DNA · file metadata │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Professional DNA                               │
│              v1.0.0 [ACTIVE]   ·   v2.0.0 [DRAFT]                   │
│              Reasoning · Competencies · Behaviours                   │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Worker Profile                                │
│     Capabilities · Permissions · Escalation · Performance            │
│              ExpandedWorkerProfile · v1.0.0                          │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                    compileRuntimeManifest(employeeFile, taskContext)
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Runtime Manifest                               │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  INCLUDED                                                    │     │
│  │  employeeId · title · department · dnaVersion               │     │
│  │  workerProfileVersion · constitutionVersion                  │     │
│  │  currentTask · activeCapabilities · runtimePermissions      │     │
│  │  executionBoundaries · securityConstraints                   │     │
│  │  constitutionStatements · compiledAt                         │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  EXCLUDED (stays in platform layer)                          │     │
│  │  soul · personality · full values · full DNA · file metadata │     │
│  └────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   │  sent to OpenClaw
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Execution Runtime                               │
│                   OpenClaw  ·  Task Dispatcher                       │
│               Receives: RuntimeManifest only                         │
│               Never receives: Employee File                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

| Question | Answer |
|---|---|
| What is sent to OpenClaw? | The Runtime Manifest only |
| What is never sent to OpenClaw? | The full Employee File |
| How is the manifest produced? | `compileRuntimeManifest(employeeFile, taskContext?)` |
| Is the Constitution in the manifest? | Yes — always, in `constitutionStatements` |
| When is the task context injected? | At dispatch time, not at load time |
| What validates Constitution inheritance? | `validateConstitutionInheritance()` — runs before compilation |
| What happens if Constitution is not inherited? | `compileRuntimeManifest()` throws — manifest is not produced |
| Can a draft DNA version appear in the manifest? | No — only `activeVersion` is referenced |

---

*The Runtime Manifest is the security boundary between the platform layer and the execution layer. It is the only authorised pathway for Employee File data to reach the execution runtime.*
