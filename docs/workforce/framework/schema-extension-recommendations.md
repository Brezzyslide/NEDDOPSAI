# Schema Extension Recommendations

> **Purpose:** This document analyses the existing NeedsOps Employee File, DNA, and Runtime Manifest schema against the requirements of the Professional Design Framework and recommends what should be added, changed, or kept as-is.  
>  
> It distinguishes between three tiers of artefact:  
> - **Founder-only documentation** — never enters any software system  
> - **Platform layer** — lives in the Employee File schema, never compiled to runtime  
> - **Runtime layer** — compiled into the Runtime Manifest and used during execution  

---

## Current Schema Summary

### Employee File (`lib/workforce-dna/src/employee/types.ts`)

| Section | Current Type | Assessment |
|---|---|---|
| `identity` | `EmployeeIdentity` — flat strings (roleCode, title, department, purpose, etc.) | Sufficient for identity; no capability reference |
| `soul` | `{ traits: string[], version: string }` | Adequate; soul is not runtime content |
| `mission` | `{ mission: string, purpose: string, objectives: string[] }` | Adequate |
| `values` | `{ constitutionInherited: true, constitutionVersion: string, roleSpecificValues: string[] }` | Adequate; flat string values work at this layer |
| `personality` | `{ traits: string[], avoid: string[] }` | Adequate for non-runtime use |
| `authority` | `{ may: string[], mayNot: string[] }` | **Insufficient** — flat arrays cannot express thresholds, conditions, or gradations |
| `decisionPhilosophy` | `{ whenUncertaintyExists: string[], guidingPrinciples: string[] }` | Adequate; linked to DNA reasoning methodology |
| `communication` | `{ characteristics, distinguish, neverExaggerateCertainty, plainEnglish }` | Adequate |
| `responsibilities` | `{ responsibilities: string[] }` | **Insufficient** — flat array; cannot express ownership, escalation, or RACI |
| `professionalDNA` | `EmployeeProfessionalDNA` → `DNAProfile` | Comprehensive; see DNA section |
| `workerProfile` | `ExpandedWorkerProfile` — capability codes as string[] | **Partially insufficient** — capability codes exist; capability definitions do not |
| `resourceRequirements` | Optional `EmployeeResourceRequirements` | Adequate; already structured |

### DNA Profile (`lib/workforce-dna/src/types.ts`)

The DNA schema is well-structured. Key sections:

| Section | Assessment |
|---|---|
| `competencies: DNACompetency[]` | **Partially insufficient** — has code/name/description/level but lacks knowledge sources, evidence requirements, validation requirements, trusted providers, quality expectations |
| `escalationFramework: DNAEscalationFramework` | Adequate — rules, hardStops, defaultPath are well-structured |
| `professionalBoundaries: DNAProfessionalBoundaries` | Adequate — canDo/cannotDo/requiresApproval/outOfScope |
| `reasoningMethodology` | Adequate for runtime use |
| `confidenceModel: DNAConfidenceModel` | Adequate — per-output type thresholds |
| `capabilityConfig: DNACapabilityConfig` | **Partially insufficient** — lists capability codes but does not link to capability definitions |

### Runtime Manifest (compiler in `lib/workforce-dna/src/employee/index.ts`)

The compiler currently includes:
- `employeeId`, `title`, `department`, version fields
- `availableCapabilities` (string codes from Worker Profile)
- Four permission arrays
- `executionBoundaries` (DNA canDo/cannotDo/requiresApproval + hardStops)
- `securityConstraints`
- Abbreviated `constitutionStatements`
- `compiledAt`

The compiler explicitly excludes:
- Soul, personality, full values
- Full mission objectives
- Full professional DNA profiles
- Full worker profile detail
- File metadata

---

## Tier Classification

### Tier 1 — Founder-Only Documentation
*Never enters any software system. Lives in `/docs/workforce/` as approved design artefacts.*

| Artefact | Where it lives | Why it stays here |
|---|---|---|
| Professional Design Brief | `docs/workforce/[role]/professional-design-brief.md` | This is the founder's professional knowledge. It is the source from which the Employee File is derived. It is not an instruction set. It must never be templated into prompts. |
| Responsibility Matrix | `docs/workforce/[role]/responsibility-matrix.md` | RACI-style accountability is an organisational governance document. It informs the Employee File but is too detailed and context-specific to belong in a schema field. |
| Authority Matrix | `docs/workforce/[role]/authority-matrix.md` | Authority thresholds and domain-level authority tables are reference documentation. They inform the Employee File `authority` section and DNA `professionalBoundaries`, but the full matrix is too rich for a flat schema field. |
| Collaboration Matrix | `docs/workforce/[role]/collaboration-matrix.md` | Relationship maps inform the Employee File identity (reportingLine) and DNA escalation framework. They are not runtime content. |
| Professional Competency Model | `docs/workforce/[role]/competency-model.md` | The competency model is the source from which `DNACompetency[]` entries are derived. The full model (knowledge sources, validation requirements, review requirements) belongs in documentation, not schema fields. |

---

### Tier 2 — Platform Layer (Employee File schema, never compiled to Runtime)
*Lives in the TypeScript schema. Read at system configuration time. Never sent to the Execution Runtime.*

#### Recommended schema changes

**1. Structured authority section**

The current `EmployeeAuthority { may: string[], mayNot: string[] }` should be extended to support structured authority domains.

*Recommended addition (non-breaking — extends the type):*

```typescript
export interface AuthorityThreshold {
  domain: string;
  condition: string;
  belowThreshold: "decide" | "recommend" | "consult" | "escalate";
  atOrAboveThreshold: "decide" | "recommend" | "consult" | "escalate" | "refuse";
}

export interface EmployeeAuthority {
  may: string[];           // existing — keep
  mayNot: string[];        // existing — keep
  thresholds?: AuthorityThreshold[];   // new — optional, non-breaking
}
```

**2. Structured responsibilities section**

The current `EmployeeResponsibilities { responsibilities: string[] }` should be extended to support responsibility groups.

*Recommended addition (non-breaking):*

```typescript
export interface StructuredResponsibility {
  group: string;
  responsibility: string;
  owner: "primary" | "shared" | "supports" | "consults";
}

export interface EmployeeResponsibilities {
  responsibilities: string[];                      // existing — keep
  structured?: StructuredResponsibility[];          // new — optional
}
```

**3. Extended competency in DNA**

`DNACompetency` should be extended to include knowledge sources and validation requirements:

```typescript
export interface DNACompetency {
  code: string;            // existing
  name: string;            // existing
  description: string;     // existing
  level: "foundational" | "practitioner" | "expert" | "authority";  // existing
  knowledgeSources?: string[];      // new — legislaton/standards referenced
  evidenceRequirements?: string[];  // new — what must exist before applying
  validationRequirements?: string[];// new — how the output is validated
}
```

**4. Collaboration declarations in identity**

`EmployeeIdentity` should optionally declare collaboration relationships for use in orchestration:

```typescript
export interface EmployeeIdentity {
  // ... existing fields
  collaborates?: {
    mustConsult?: string[];    // role codes this specialist must consult
    cannotBypass?: string[];   // role codes this specialist cannot route around
  };
}
```

---

### Tier 3 — Runtime Layer (compiled into Runtime Manifest)
*Compiled by `compileRuntimeManifest()`. Sent to OpenClaw / Task Dispatcher during execution.*

The current runtime manifest is already well-scoped. The following additions are recommended:

**1. Hard stops from Authority Matrix**

The `hardStops` array in the Runtime Manifest should include entries derived from the Authority Matrix "Must Refuse" and "Never Authorised" rows. This is already supported via `DNAEscalationFramework.hardStops` — no schema change needed, but the Authority Matrix must feed into DNA design.

**2. Active capability codes remain string references**

Capability definitions (inputs, outputs, evidence requirements, refusal conditions) are Tier 1 documentation. The Runtime Manifest correctly carries only capability *codes* — not definitions. This distinction must be maintained. The Runtime Manifest should never grow to include capability definition content.

**3. Collaboration constraints remain out of runtime**

The `collaborates.mustConsult` and `collaborates.cannotBypass` fields recommended for the Employee File platform layer should NOT compile into the Runtime Manifest. Collaboration constraints are orchestration-layer concerns (handled by the Chief of Staff and the execution coordinator), not per-specialist runtime behaviour.

---

## Summary Table

| Artefact | Tier | Recommended Location | Schema Change Required? |
|---|---|---|---|
| Professional Design Brief | 1 — Founder docs | `docs/workforce/[role]/professional-design-brief.md` | No |
| Responsibility Matrix | 1 — Founder docs | `docs/workforce/[role]/responsibility-matrix.md` | No |
| Authority Matrix | 1 — Founder docs | `docs/workforce/[role]/authority-matrix.md` | No |
| Collaboration Matrix | 1 — Founder docs | `docs/workforce/[role]/collaboration-matrix.md` | No |
| Professional Competency Model | 1 — Founder docs | `docs/workforce/[role]/competency-model.md` | No |
| Authority thresholds | 2 — Employee File | `EmployeeAuthority` extension | Yes — optional `thresholds[]` |
| Structured responsibilities | 2 — Employee File | `EmployeeResponsibilities` extension | Yes — optional `structured[]` |
| Extended competency fields | 2 — DNA | `DNACompetency` extension | Yes — optional knowledge/evidence/validation |
| Collaboration constraints | 2 — Employee File | `EmployeeIdentity` extension | Yes — optional `collaborates{}` |
| Capability codes | 3 — Runtime | No change — already correct | No |
| Hard stops | 3 — Runtime | No change — already compiled from DNA | No |
| Full capability definitions | 1 — Founder docs | `docs/workforce/[role]/capabilities/[code].md` | No |

---

## What Must Stay Out of Runtime — Permanently

These artefacts must never be compiled into the Runtime Manifest, regardless of future schema evolution:

| Artefact | Reason |
|---|---|
| Professional Design Brief content | Contains founder intellectual property and professional philosophy not intended as instruction content |
| Soul traits | Soul is enduring character design; it should not be re-injected as instruction at execution time |
| Full personality descriptions | Runtime behaviour is shaped by mission, values, and DNA — full personality text is design documentation |
| Responsibility Matrix | Accountability frameworks are organisational governance; they are not execution instructions |
| Authority Matrix full detail | Thresholds and domain tables are reference documentation; only hard stops compile to runtime |
| Collaboration Matrix | Cross-role relationships are orchestration-layer design; they are not per-execution runtime behaviour |
| Competency definitions | Evidence requirements and knowledge sources are design-time reference; confidence thresholds already exist in DNA |
| File metadata (fileVersion, createdAt) | Administrative; no runtime value |

---

## Implementation Priority

If schema extensions are approved, the recommended order is:

1. **Extended `DNACompetency`** — highest value; directly improves how DNA profiles translate professional competency into execution behaviour. Non-breaking.
2. **`EmployeeIdentity.collaborates`** — improves orchestration quality when multiple specialists are active. Non-breaking.
3. **`EmployeeAuthority.thresholds`** — improves authority boundary clarity for specialists with graduated authority. Non-breaking.
4. **`EmployeeResponsibilities.structured`** — improvements at Employee File layer; lower runtime impact. Non-breaking.

All four are backward-compatible additions. Existing Employee Files (Chief of Staff, Executive Assistant) do not need to be updated immediately — the fields are optional.

---

*Schema Extension Recommendations v1.0 — NeedsOps Digital Workforce Professional Design Framework*
