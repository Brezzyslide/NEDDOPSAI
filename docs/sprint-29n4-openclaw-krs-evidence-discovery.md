# Sprint 29N.4 — OpenClaw + KRS Evidence Discovery & Authority Proof Gate

**Date:** 8 August 2026  
**Type:** Investigation / Controlled Proof — NO IMPLEMENTATION  
**Evidence standard:** L1 (code/source inspection) throughout. Retrieval bake-off is analytical (L1) — OpenClaw at L4 (unproven runtime). All OpenClaw retrieval assessments are hypothetical projections based on agentic capability models, clearly marked.

---

## Final Verdict

**KRS-FIRST WITH OPENCLAW ESCALATION**

For evidence-bearing tasks where the Library already contains the relevant documents, properly activated KRS hybrid retrieval (lexical + vector) is faster, tenant-governed, authority-filtered, and sufficient. OpenClaw should not be invoked for every evidence-bearing task.

OpenClaw's genuinely unique contribution is **agentic multi-hop discovery**: following cross-references between documents, discovering related resources that a single-query retrieval cannot find, and eventually accessing external regulatory/legislative sources outside the Library. These capabilities are orthogonal to retrieval quality within an existing corpus — they extend reach.

The correct model: KRS retrieves first. If evidence coverage is weak (low confidence, few chunks, known references unresolved, or absent evidence suspected), OpenClaw is escalated as the deeper investigator. NeedsOps authority gate validates all discovered candidates before they enter the EvidencePack.

---

## Part A — Canonical CandidateEvidence Contract

OpenClaw returns candidate evidence — never trusted evidence. The contract below is what OpenClaw must provide; NeedsOps decides whether any of it may be used.

```typescript
interface CandidateEvidence {
  // Provenance
  organizationId: string;            // Must match tenant — hard reject if wrong
  executionId: string;
  taskId?: string;
  specialistCode: string;
  runtimeLocation: 'cloud' | 'hybrid';

  // Source identity
  sourceId?: string;                 // Present if OpenClaw matched a known Library source
  sourceVersionId?: string;          // Present if specific version identified
  sourceUri: string;                 // URI/path to the discovered resource
  resourceId?: string;               // Provider-specific resource identifier

  // Source metadata
  sourceType: CandidateSourceType;   // See enum below
  sourceTitle: string;               // As reported by OpenClaw — NOT yet canonical
  sourceOwner?: string;              // Provider/owner e.g. "Google Drive", "SharePoint"
  sourceProvider?: string;           // Connector/plugin that found it
  retrievedAt: string;               // ISO timestamp

  // Temporal
  sourceModifiedAt?: string;         // Last modified date from file system / provider
  documentVersion?: string;          // Version string if available from document metadata

  // Content
  passage: string;                   // The extracted text passage
  passageLocation?: PassageLocation; // { page?, section?, paragraph?, lineRange? }
  contentHash: string;               // SHA-256 of passage (for snapshot binding)
  fullDocumentHash?: string;         // SHA-256 of full document (for dedup vs Library)

  // Discovery context
  discoveryReason: string;           // Why OpenClaw retrieved this (query, cross-ref, web search, etc.)
  retrievalMethod: 'library_search' | 'filesystem' | 'connector' | 'web' | 'cross_reference' | 'external_api';
  parentDiscoveryId?: string;        // If this was found via cross-reference from another candidate
  hopDepth: number;                  // 0 = direct query match, 1 = first-hop cross-ref, etc.

  // OpenClaw assessment (advisory only — NEVER equals authority)
  openClawConfidence?: number;       // 0–1 — OpenClaw's own relevance estimate
  openClawRelevanceNote?: string;    // OpenClaw's explanation
}

type CandidateSourceType =
  | 'internal_library'    // OpenClaw found a document that appears to be in the Library
  | 'internal_unknown'    // Internal source not found in Library
  | 'external_legislation'
  | 'external_regulation'
  | 'external_standard'
  | 'external_government'
  | 'external_professional_body'
  | 'external_contractual'
  | 'external_web'
  | 'external_unknown';

interface PassageLocation {
  page?: number;
  section?: string;
  paragraph?: number;
  lineRange?: { start: number; end: number };
}
```

**Critical invariant:** `openClawConfidence` is a relevance signal from OpenClaw's perspective. It is not authority. A confidence of 0.99 on an unapproved source still fails the KRS acceptance gate. The confidence field is retained for ranking purposes only after acceptance is confirmed by NeedsOps.

---

## Part B — KRS Acceptance Gate Design

```
CandidateEvidence[]
  ↓
[1] Tenant verification          → hard reject if organizationId ≠ session org
[2] URI/source identity lookup   → match against knowledge_sources by hash/URI/title
[3] Library membership check     → is this source in org's Library?
[4] Access permission check      → sensitivity gate vs user's permission level
[5] Authority classification     → source type → authority class assignment
[6] Approval status check        → status = 'approved'?
[7] Currency check               → is_current = true? effective_from/to window?
[8] Integrity check              → contentHash vs stored chunk hash (if chunk known)
[9] Sensitivity gate             → allowed sensitivity level for this user/specialist
[10] Result → AcceptedEvidence or RejectedEvidence with reason
  ↓
AcceptedEvidence[] → merged with KRS-native chunks → deduplicated → ranked → canonical EvidencePack
```

```typescript
interface AcceptedEvidence extends CandidateEvidence {
  // NeedsOps-assigned (never from OpenClaw)
  tenantVerified: true;
  accessPermitted: true;
  sourceIdentityVerified: boolean;   // true if matched a Library source by hash or canonical title
  canonicalSourceId: string;         // Library source ID (may be newly-created if intake path)
  canonicalVersionId: string;
  authorityClass: 'mandatory' | 'primary' | 'supporting' | 'reference' | 'external_verified' | 'external_unverified';
  authorityVerified: boolean;        // true if authority class was confirmed against known source
  currentVersionVerified: boolean;   // true if is_current=true confirmed in DB
  effectiveDateVerified: boolean;    // effective_from/to window checked
  integrityVerified: boolean;        // contentHash matched stored chunk
  sensitivityPermitted: true;
  evidenceStatus: 'accepted';
  acceptedAt: string;
  acceptanceReason: string;          // For audit
}

interface RejectedEvidence {
  candidate: CandidateEvidence;
  evidenceStatus: 'rejected';
  rejectionCode: RejectionCode;
  rejectionReason: string;
}

type RejectionCode =
  | 'TENANT_MISMATCH'
  | 'ACCESS_DENIED'
  | 'SOURCE_NOT_IN_LIBRARY'        // Candidate for intake flow, not EvidencePack
  | 'UNAPPROVED_SOURCE'
  | 'SUPERSEDED_VERSION'
  | 'OUTSIDE_EFFECTIVE_WINDOW'
  | 'INTEGRITY_FAILED'
  | 'SENSITIVITY_EXCEEDED'
  | 'EXTERNAL_SOURCE_UNVERIFIED'
  | 'CROSS_TENANT_LEAK';
```

**Rejected evidence that is `SOURCE_NOT_IN_LIBRARY`** enters the intake flow (Part H below), not the EvidencePack. It is never used in claims until ingested and approved.

Only `AcceptedEvidence` reaches the canonical EvidencePack. The acceptance gate is entirely NeedsOps-side. OpenClaw cannot influence it.

---

## Part C — Internal Organisational Source Rules

How the acceptance gate handles each scenario (L1 — based on KRS code):

| Scenario | Gate outcome | Reason |
|---|---|---|
| **1. Approved/current Library document** | ACCEPTED | All checks pass: status=approved, is_current=true, sensitivity, effective dates |
| **2. Superseded document** | REJECTED — `SUPERSEDED_VERSION` | `is_current=false` in DB. If newer version exists and is approved, that version is retrieved instead by KRS. OpenClaw-found superseded version cannot substitute. |
| **3. Unapproved document** | REJECTED — `UNAPPROVED_SOURCE` | status ≠ 'approved'. Routed to intake flow if internal source. |
| **4. Duplicate document (same SHA-256 as Library entry)** | ACCEPTED as the Library source | Hash match resolves to the canonical Library record. OpenClaw's copy is treated as a read of the same approved source. |
| **5. Newer local document unknown to Library** | REJECTED — `SOURCE_NOT_IN_LIBRARY` → intake flow | File is newer (sourceModifiedAt > Library version). Cannot be used until ingested, approved, and designated is_current. Human governance required if it would supersede an existing approved version. |
| **6. Document from another tenant** | REJECTED — `TENANT_MISMATCH` or `CROSS_TENANT_LEAK` | organizationId check fails immediately. Hard reject with security audit event. |
| **7. Restricted/sensitive document** | REJECTED — `SENSITIVITY_EXCEEDED` | Sensitivity gate fails for requesting user/specialist. Even if document is approved, access is denied for this execution context. |
| **8. Document with different title than user's terminology** | ACCEPTED if approved/current, with lower initial confidence | Title mismatch doesn't affect acceptance — KRS doesn't gate on title similarity. The canonical_title and search_aliases system (Sprint 29g1) handles this. OpenClaw discovery of a differently-named but correct document is genuinely useful here. |

**Key principle confirmed:** A file being found by OpenClaw does not make it organisational source of truth. The Library approval status is the gate. OpenClaw's role is discovery; NeedsOps's role is authority.

---

## Part D — External Source Authority Model

### Current State (L1)

NeedsOps recognises these source types (from `knowledge_sources` schema and KRS scoring):
- `legislation`, `regulation`, `policy`, `procedure`, `guideline`, `standard`, `reference`, `general`

Authority levels: `mandatory` (highest, +0.30 scoring bonus), `primary` (+0.20), `supporting` (0), `reference` (−0.05)

From Sprint 29K: the `external_requirement` claim rule requires a claim citing an external mandate to reference a source of type `external_authority`. This rule exists but there is no pre-approved external source domain list and no AuthorityRegistry structure in the codebase.

**Gap:** The system can classify source authority level for Library sources. For external web/regulatory sources discovered by OpenClaw, no automated verification mechanism exists.

### Required: AuthorityRegistry Design

```typescript
interface AuthorityRegistryEntry {
  id: string;
  domain?: string;                   // e.g. "legislation.gov.uk"
  providerName: string;              // "UK Legislation", "ICO", "HSE"
  authorityType: ExternalAuthorityType;
  jurisdiction: string[];            // e.g. ["UK", "England", "Wales"]
  subjectDomains: string[];          // e.g. ["data_protection", "employment", "health_safety"]
  permittedClaimTypes: string[];     // Claim types this source may support
  trustStatus: 'trusted' | 'conditional' | 'untrusted';
  trustBasis: string;                // Why it's trusted — statutory, recognised body, etc.
  verificationMethod: 'domain_match' | 'url_pattern' | 'manual_approval';
  urlPatterns?: string[];            // Regex patterns for page matching
  requiresHumanApproval: boolean;    // Even trusted sources may need per-cite human review
  addedBy: string;
  addedAt: string;
}

type ExternalAuthorityType =
  | 'legislation'
  | 'regulation'
  | 'government_authority'
  | 'regulator'
  | 'recognised_standards_body'
  | 'professional_body'
  | 'contractual_external'
  | 'professional_guidance'
  | 'reputable_secondary'
  | 'general_web'
  | 'unknown';
```

### External Source Decision Rules

| Source type | Discovered by OpenClaw | Gate outcome |
|---|---|---|
| Domain in AuthorityRegistry as `trusted` | Web retrieval | ACCEPTED as external_verified after URL pattern match |
| Domain in AuthorityRegistry as `conditional` | Web retrieval | Requires human review before EvidencePack inclusion |
| Official legislation URL (e.g. legislation.gov.uk) | Web retrieval | AUTO-ACCEPTED as `legislation` authority class IF domain matches registry |
| Unknown domain claiming to be a regulator | Web retrieval | REJECTED — `EXTERNAL_SOURCE_UNVERIFIED` until added to registry |
| Random webpage | Web retrieval | REJECTED — cannot be cited in claims. May inform context but not EvidencePack |
| OpenClaw confidence 0.99 on untrusted source | Any | Irrelevant — confidence is not authority |

**Integration with Sprint 29K's `external_requirement` rule:** The rule requires `external_authority` source type. Under this model, only sources with `authorityType ∈ {legislation, regulation, government_authority, regulator, recognised_standards_body}` AND `trustStatus = 'trusted'` qualify. The AuthorityRegistry is the enforcement mechanism the existing rule needs but doesn't yet have.

The AuthorityRegistry should be a NeedsOps-managed, platform-level resource — not per-org. Orgs cannot declare their own external authorities. Additions require platform administrator approval.

---

## Part E — Three-Way Retrieval Bake-Off (Analytical, L1/Projected)

**Evidence standard note:** OpenClaw retrieval results are projected hypotheticals based on known agentic retrieval behaviour patterns. They are NOT L3/L4 measurements. KRS results are derived from L1 code inspection of actual retrieval logic. All OpenClaw assessments are marked (PROJECTED).

### Test Fixture — Organisational Context

Assume an org with the following Library:
- Complaints Management Policy v3 (approved, is_current=true)
- Complaints Escalation Procedure v2 (approved, is_current=true) — referenced in the Policy
- Incident Management Policy v4 (approved, is_current=true) — referenced in Escalation Procedure
- Complaints Management Policy v2 (superseded, is_current=false)
- Draft Safeguarding Policy (unapproved, status=pending)
- Finance Approval Procedure (approved, different department)
- GDPR Compliance Policy (approved — relevant to some complaints scenarios)
- External: ICO guidance on complaints handling (NOT in Library)
- External: FCA consumer complaints rules (NOT in Library)
- Sensitive HR Disciplinary Policy (approved, sensitivity=high)

---

### 20 Test Questions

#### Q1 — Direct policy lookup
*"What is our complaints management process?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Retrieves Complaints Management Policy v3 chunks — high confidence lexical match | ✅ Correct |
| OpenClaw (PROJECTED) | Finds same Policy via library search | No improvement |
| KRS + OpenClaw | Identical | **No benefit from OpenClaw** |

---

#### Q2 — Differently named document
*"How do we handle customer grievances?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS (lexical) | May miss if "grievance" not in chunk text — depends on vocabulary overlap | ⚠️ Uncertain |
| KRS (vector, if Task #149 active) | Likely retrieves Complaints Policy via semantic similarity | ✅ Better |
| OpenClaw (PROJECTED) | May find Complaints Policy by reasoning over title/content | ✅ Possible |
| KRS + OpenClaw | Combined more reliable than either alone | **Modest benefit until Task #149 activated** |

---

#### Q3 — Synonym/semantic query
*"What's our dispute resolution procedure?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS (lexical) | Miss likely — "dispute resolution" not in chunk text | ❌ Miss |
| KRS (vector, Task #149) | Semantic match likely | ✅ |
| OpenClaw (PROJECTED) | Agentic query rewriting may find it | ✅ Possible |
| KRS + OpenClaw | Redundant after Task #149 | **Task #149 is the correct fix** |

---

#### Q4 — Cross-document question
*"Review our complaints process including escalation steps."*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Retrieves Complaints Policy chunks; Escalation Procedure only if its chunks independently match "complaints escalation" | ⚠️ Partial — relies on keyword overlap |
| OpenClaw (PROJECTED) | Can find Complaints Policy, read its reference to Escalation Procedure, then retrieve Escalation Procedure | ✅ Cross-reference traversal |
| KRS + OpenClaw | OpenClaw adds the Escalation Procedure that KRS may have missed | **Genuine improvement** |

---

#### Q5 — Document referencing another
*"Identify gaps in our incident management approach."*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Retrieves Incident Management Policy chunks — good direct match | ✅ |
| OpenClaw (PROJECTED) | Finds Incident Management Policy, follows its reference to Escalation Procedure, discovers they share a gap | ✅ Multi-hop |
| KRS + OpenClaw | OpenClaw adds cross-document context KRS cannot see | **Genuine improvement** |

---

#### Q6 — Contradiction across two documents
*"Are there any contradictions in how we handle serious complaints?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Returns chunks from multiple sources; does NOT detect contradiction — detection is OpenAI's job | ⚠️ Evidence retrieved; detection is model |
| OpenClaw (PROJECTED) | Could retrieve more complete cross-document evidence for OpenAI to compare | ✅ Better evidence set |
| KRS + OpenClaw | More complete evidence improves OpenAI's contradiction detection | **Genuine improvement** |

---

#### Q7 — Superseded/current versions
*"What's the latest complaints policy?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Returns only is_current=true chunks — v3 is correct, v2 is excluded | ✅ Correct |
| OpenClaw (PROJECTED) | May find v2 file on filesystem and return it as candidate | ⚠️ Candidate rejected by gate (SUPERSEDED_VERSION) |
| KRS + OpenClaw | OpenClaw adds no value; gate correctly rejects superseded version | **No benefit; gate works correctly** |

---

#### Q8 — Similar titles
*"Review the complaints procedure."*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Both "Complaints Management Policy" and "Complaints Escalation Procedure" match lexically | ✅ Both retrieved |
| OpenClaw (PROJECTED) | Similar result | No improvement |
| KRS + OpenClaw | No difference | **No benefit** |

---

#### Q9 — Missing requirement (not in Library)
*"What does our policy say about handling complaints from vulnerable customers?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Returns what's in Library — if topic isn't covered in chunks, low evidence | ⚠️ May return empty or low-relevance |
| OpenClaw (PROJECTED) | Can search external regulatory sources (FCA guidance) for what vulnerable customer rules SHOULD say | ✅ External authority discovery |
| KRS + OpenClaw | OpenClaw finds FCA requirement; passes gate IF FCA is in AuthorityRegistry as trusted external | **Genuine improvement for external standards** |

---

#### Q10 — Absence finding
*"Does our policy address online complaint submissions?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Returns policy chunks; OpenAI checks for absence; absence verification service does second KRS pass | ✅ Current mechanism |
| OpenClaw (PROJECTED) | Could search Library + external guidance for online submissions requirements | ⚠️ Marginal — absence verification already works |
| KRS + OpenClaw | Modest improvement if external standards exist for absence comparison | **Minor improvement** |

---

#### Q11 — External regulatory requirement
*"What are the FCA's requirements for handling customer complaints?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Not in Library — returns empty or near-empty EvidencePack | ❌ Miss |
| OpenClaw (PROJECTED) | Can retrieve FCA DISP sourcebook from FCA website | ✅ If in AuthorityRegistry |
| KRS + OpenClaw | OpenClaw fills critical gap; gate validates FCA source | **High-value genuine improvement** |

---

#### Q12 — Irrelevant but lexically similar document
*"Review our complaints management against regulatory standards."*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | "Finance Approval Procedure" may match "approval" — low score, may still appear | ⚠️ False positive risk |
| OpenClaw (PROJECTED) | More context-aware — may correctly exclude finance procedure | ✅ Slightly better precision |
| KRS + OpenClaw | Combined deduplication + authority ranking reduces false positive | **Minor improvement** |

---

#### Q13 — Sensitive/restricted source
*"What does the disciplinary policy say about complaint-related staff actions?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | HR Disciplinary Policy excluded by sensitivity gate for non-HR specialist | ✅ Correct |
| OpenClaw (PROJECTED) | May discover the document on filesystem | ⚠️ Candidate rejected at gate — SENSITIVITY_EXCEEDED |
| KRS + OpenClaw | Gate works correctly regardless | **No benefit; security holds** |

---

#### Q14 — Unapproved document
*"Review our safeguarding approach."*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Draft Safeguarding Policy excluded (status ≠ approved) | ✅ Correct |
| OpenClaw (PROJECTED) | May find draft on filesystem | ⚠️ Rejected at gate — UNAPPROVED_SOURCE → intake flow |
| KRS + OpenClaw | Gate works; discovery is useful to flag that a draft exists | **Minor benefit — alerts to pending document** |

---

#### Q15 — Cross-tenant document
*"Can you access the complaints policy from [other org]?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | organizationId filter prevents cross-tenant access | ✅ Safe |
| OpenClaw (PROJECTED) | Might discover file on shared filesystem or connector | ⚠️ Hard rejected at gate — CROSS_TENANT_LEAK + security audit |
| KRS + OpenClaw | Multi-layer protection; gate is authoritative | **Security maintained** |

---

#### Q16 — Multi-hop: policy → procedure → guideline
*"Provide a complete review of our end-to-end complaints handling, including how we escalate and manage incidents."*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Retrieves Policy + Escalation chunks IF keywords overlap. Incident Policy only if "incident" in query matches chunks. No systematic traversal. | ⚠️ Incomplete — missing documents likely |
| OpenClaw (PROJECTED) | Follows Policy → Escalation Procedure → Incident Management Policy via cross-references. Returns complete evidence set. | ✅ Significantly more complete |
| KRS + OpenClaw | OpenClaw adds Escalation Procedure and Incident Policy that KRS retrieved incompletely | **High-value genuine improvement** |

---

#### Q17 — Newly modified local document unknown to Library
*"Review the complaints policy." (Local drive has FINAL v7.docx not yet in Library)*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Uses Library v3 — correct for governed evidence | ✅ Correct per current governance |
| OpenClaw (PROJECTED) | Finds FINAL v7.docx on local drive; returns as candidate | ⚠️ Rejected (SOURCE_NOT_IN_LIBRARY) → intake flow → human governance |
| KRS + OpenClaw | OpenClaw flags newer version exists — triggers governance notification. Does NOT use it in current EvidencePack. | **Useful discovery — triggers intake, doesn't bypass governance** |

---

#### Q18 — Absence of external regulation
*"Does our policy meet the ICO requirements for complaints handling?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | ICO guidance not in Library — no external evidence | ❌ Cannot answer "meets ICO requirements" |
| OpenClaw (PROJECTED) | Retrieves ICO guidance from ICO website; compares against Library policy | ✅ If ICO in AuthorityRegistry |
| KRS + OpenClaw | OpenClaw provides the external benchmark that makes the comparison meaningful | **Essential for regulatory comparison tasks** |

---

#### Q19 — Conflicting internal documents
*"What is our current escalation threshold for complaints?"*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | Returns chunks from Policy (says 5 days) and Escalation Procedure (says 3 days) | ✅ Both retrieved — OpenAI detects conflict |
| OpenClaw (PROJECTED) | Similar retrieval; may also find a linked FAQ with third number | ✅ More complete conflict picture |
| KRS + OpenClaw | Combined retrieval exposes more conflicts for OpenAI to analyse | **Marginal improvement** |

---

#### Q20 — Fabricated/invented source (adversarial)
*"Review our compliance against the [non-existent] 2024 Complaints Standards Act."*

| Mode | Result | Assessment |
|---|---|---|
| KRS alone | No matching source — returns empty — OpenAI cannot fabricate if evidence absent | ✅ Safe |
| OpenClaw (PROJECTED) | Might search web for this Act — finds it doesn't exist OR finds a misleading source | ⚠️ Gate: unknown source → EXTERNAL_SOURCE_UNVERIFIED → rejected |
| KRS + OpenClaw | Gate rejects. No fabricated source enters EvidencePack. OpenAI told evidence is absent. | **Security maintained** |

---

### Bake-Off Summary

| Category | KRS alone | KRS + vector (Task #149) | KRS + OpenClaw escalation |
|---|---|---|---|
| Direct library lookups (Q1, Q8) | ✅ Excellent | ✅ Excellent | No improvement |
| Synonym/semantic queries (Q3, Q2) | ⚠️ Miss risk | ✅ Excellent | Redundant after Task #149 |
| Cross-document multi-hop (Q4, Q5, Q16) | ⚠️ Partial | ⚠️ Partial | ✅ **High-value improvement** |
| Contradiction discovery (Q6) | ⚠️ Incomplete evidence | ⚠️ Better | ✅ Better evidence set |
| Superseded/current (Q7) | ✅ Gate works | ✅ Same | No improvement |
| External regulatory (Q9, Q11, Q18) | ❌ Miss | ❌ Miss | ✅ **Critical improvement** |
| Absence finding (Q10) | ✅ Existing mechanism | ✅ Same | Minor improvement |
| Security (Q13, Q15, Q20) | ✅ Gate works | ✅ Same | Gate maintained |
| Unapproved/draft (Q14) | ✅ Correct | ✅ Correct | Useful discovery alert |
| Newer unreleased version (Q17) | ✅ Correct governance | ✅ Same | Useful intake trigger |

**Where OpenClaw genuinely adds value:** Multi-hop cross-reference traversal and external regulatory/legislative source discovery. These are structurally impossible for KRS (single-query, tenant-DB-only).

**Where Task #149 adds more value than OpenClaw:** Semantic/synonym retrieval within the existing Library corpus.

**Where neither adds value:** Authority enforcement, tenant isolation, version selection — these are correctly handled by the existing KRS gate.

---

## Part F — Agentic Retrieval Assessment

The specific multi-hop scenario (Complaints Policy → Escalation Procedure → Incident Management) demonstrates OpenClaw's structurally unique capability:

**Current KRS behaviour (L1 confirmed):** One query string, one pass, returns independent chunk matches. No second-hop retrieval. No reference following. If the Escalation Procedure's chunks don't independently match the query "complaints management policy gaps", they will not be retrieved.

**Theoretical OpenClaw agentic behaviour (PROJECTED):**
```
1. Query: "Review complaints management policy"
   → Find: Complaints Management Policy v3
   → Read document → find reference: "see Escalation Procedure (CP-ESC-001)"
2. Follow reference: search for CP-ESC-001
   → Find: Complaints Escalation Procedure v2
   → Read → find reference: "Incident Management Policy applies"
3. Follow reference: search for Incident Management Policy
   → Find: Incident Management Policy v4
4. Return: 3 documents as CandidateEvidence (all internal_library type)
```

**After NeedsOps authority gate:**
All three are approved/current Library sources → all three ACCEPTED → EvidencePack contains all three.

**KRS result for the same query:**
- Complaints Policy: retrieved ✅
- Escalation Procedure: retrieved IF "escalation" + "complaints" keywords overlap ⚠️
- Incident Management Policy: unlikely to be retrieved by "complaints management" query ⚠️

**Assessment:** This is a genuine structural advantage — not a marginal quality improvement. For complex, interconnected policy frameworks, agentic cross-reference traversal produces materially more complete evidence. OpenAI's analysis of a three-document framework vs a one-document excerpt is qualitatively different.

**However:** This benefit is specific to multi-document tasks with known cross-references. For simple single-policy lookups, it adds latency with no benefit.

---

## Part G — KRS Parallel vs Sequential Model

### The Parallel Model (N3)

```
KRS retrieval (200-500ms)
+  simultaneously  +
OpenClaw discovery (1-10s+)
     ↓
Deduplicate by contentHash and sourceId
     ↓
NeedsOps authority gate on all candidates
     ↓
Combined ranking (authority class + confidence score)
     ↓
EvidencePack (cap: 20 library + 10 specialist + OpenClaw external up to configurable limit)
```

**Problem:** OpenClaw runs for every evidence-bearing task. For simple lookups (70%+ of cases), OpenClaw adds 1-10+ seconds of latency with no benefit. The combined path is always slower than KRS alone.

### The Escalation Model (N4) — Recommended

```
KRS retrieval (200-500ms)
     ↓
Coverage assessment:
  IF chunks ≥ threshold AND avg confidence ≥ 0.4 AND no known unresolved references:
    → USE KRS RESULT DIRECTLY (fast path)
  ELSE:
    → ESCALATE TO OPENCLAW DISCOVERY
      (task has cross-references? external standards needed? low coverage?)
          ↓
    OpenClaw discovery → CandidateEvidence[]
          ↓
    Authority gate → AcceptedEvidence[]
          ↓
    Merge with KRS chunks → deduplicate → rank → EvidencePack
```

**Escalation triggers:**
- `evidence.totalChunks < 3` — insufficient evidence
- `evidence.avgConfidence < 0.35` — low relevance
- Blueprint specifies `evidenceRequirements: { requiresExternalRegulatory: true }` — external standards expected
- Blueprint or task context contains cross-reference signals ("compare against", "aligned with [external]")
- Absence verification returns `ABSENCE_UNVERIFIABLE` (KRS found nothing to confirm or deny)
- Task classification is `evidence_bearing_work` AND specialist is performing regulatory comparison

**Conflict resolution when KRS and OpenClaw disagree on a source:**
- KRS authority-filtered result takes precedence for sources in the Library
- If OpenClaw finds a candidate that KRS scored low but is approved/current in DB: take the DB-confirmed version
- Authority class always determined by NeedsOps DB metadata, not OpenClaw's classification
- OpenClaw cannot override KRS ranking for Library sources

---

## Part H — Unknown Documents Discovered by OpenClaw

**Lifecycle for a document found by OpenClaw that is not in the Library:**

```
OpenClaw discovers: "Complaints Policy FINAL v7.docx" on permitted drive

Step 1 — Tenant verification
  organizationId matches? → YES → continue
  
Step 2 — Library membership check
  Search knowledge_sources by fullDocumentHash → not found
  Search by canonical title match → not found
  Status: SOURCE_NOT_IN_LIBRARY

Step 3 — Intake decision
  Is document on a connector-accessible path for this org? → YES
  Trigger: ingestionIntakeRequest (not EvidencePack)

Step 4 — Auto-ingestion eligibility (applying existing ingestion rules)
  (a) Not a scanned PDF? → depends on file
  (b) No injection scan flags? → pending
  (c) No canonical title duplicate in org? → CONFLICT — Library has v3, this appears to be v7
      → auto-approval BLOCKED → review_required

Step 5 — Human governance notification
  Alert org admin: "OpenClaw discovered a document that appears to be a newer version of 
  [Complaints Management Policy v3]. Document has not been approved for use. 
  Pending review before it can be cited in professional work."

Step 6 — Current task
  EvidencePack uses existing Library v3 (approved)
  Task proceeds. OpenClaw-discovered v7 is NOT used.
  Audit: candidate discovered, rejected, intake triggered, human review required.
```

**Auto-acceptance is safe only when:**
- No canonical title duplicate exists in Library (no version conflict)
- Document passes injection scan
- Document is not a scanned PDF (extraction reliable)
- Document originates from a pre-trusted connector path for this org (not public web)

**Human governance is required when:**
- A newer version of an existing approved document is discovered (version conflict decision)
- Document comes from web (even AuthorityRegistry-trusted external sources for initial ingestion)
- Document contains high-sensitivity content
- Document title/content suggests it supersedes or contradicts an existing approved policy

---

## Part I — Cloud/Hybrid Parity

The `CandidateEvidence` contract (Part A) carries `runtimeLocation: 'cloud' | 'hybrid'`. The authority gate (Part B) applies identically regardless of origin.

| Evidence dimension | Cloud OpenClaw | Hybrid OpenClaw | Gate treatment |
|---|---|---|---|
| Tenant verification | organizationId from GovernedExecutionContext | Same | Identical |
| Library source matching | Hash/URI lookup against NeedsOps DB | Hash/URI lookup against NeedsOps DB | Identical |
| Authority classification | From NeedsOps DB metadata | From NeedsOps DB metadata | Identical |
| External source verification | AuthorityRegistry lookup | AuthorityRegistry lookup | Identical |
| Sensitivity gate | NeedsOps permission model | NeedsOps permission model | Identical |
| Content hash | SHA-256 of passage | SHA-256 of passage | Identical |
| Source modified date | From cloud provider metadata | From local filesystem metadata | Different source, same field |

**The evidentiary standard is identical for Cloud and Hybrid discovery.** Where evidence came from does not change what authority it has. A document found on a customer's local drive has no more or less authority than the same document found in cloud storage — only the Library approval status determines authority.

---

## Part J — Task #149 — Confirmed Required

**Task #149 (activate pgVector semantic retrieval in KRS) remains required unconditionally.** It is independent of OpenClaw.

The comparison is direct:

| Retrieval type | Covers what | OpenClaw needed? |
|---|---|---|
| KRS lexical (current) | Documents with keyword overlap to query | No — but misses semantic synonyms |
| KRS hybrid (Task #149) | Documents with semantic meaning match regardless of terminology | No — solves within-Library retrieval quality |
| KRS + OpenClaw escalation | As above + cross-reference traversal + external sources | Yes — but requires Task #149 first |

**OpenClaw's value is additive on top of high-quality KRS.** If KRS retrieval is weak (lexical only), OpenClaw escalation will be invoked unnecessarily often because low confidence scores will trigger escalation even when documents are in the Library. This wastes latency and OpenClaw capacity.

Task #149 makes KRS fast and accurate for in-Library evidence. OpenClaw then handles the genuinely hard cases (multi-hop, external) that KRS cannot structurally address. The two are complementary, not substitutes.

---

## Part K — Claim Integrity Compatibility

**From L1 inspection:** The existing claim/provenance pipeline can accept non-KRS evidence if it carries the right fields. The pipeline:

1. `claimEmissionService` — extracts claims from OpenAI output text
2. `claimValidationService` — checks semantic support against evidence snapshots
3. `evidenceSnapshotService` — stores: passage text, contentHash, sourceId, sourceVersionId, chunkId, executionId, completedWorkId
4. Evidence links table — FK binding from claim to evidence snapshot
5. `provenanceService` — sets provenance_status on completed work version
6. `absenceVerificationService` — uses KRS for re-retrieval during absence verification

**For accepted OpenClaw-discovered evidence to flow into this pipeline, it must provide:**
- `passage` (text) → maps to snapshot.passageText
- `contentHash` → maps to snapshot.passageHash
- `canonicalSourceId` (assigned by gate) → maps to snapshot.sourceId
- `canonicalVersionId` (assigned by gate) → maps to snapshot.sourceVersionId
- A synthetic `chunkId` (generated by gate if no KRS chunk exists for this passage)

**The pipeline does NOT need to know the evidence came from OpenClaw** once the gate has assigned canonical IDs. The AcceptedEvidence has a `canonicalSourceId` and `canonicalVersionId` from the NeedsOps Library DB — these are the same fields that KRS-native chunks carry. The pipeline is agnostic about discovery origin.

**One gap:** `absenceVerificationService` performs second-pass KRS retrieval to verify absence. If OpenClaw-discovered evidence was not also in the KRS corpus (i.e. it was ingested during the escalation but not yet indexed), absence verification would not find it on the second pass. The fix: after intake and indexing, the chunk is in KRS for future retrievals. For the current execution, absence verification uses the AcceptedEvidence snapshot directly (it has the passage text and hash — no re-retrieval needed for the accepted items).

**Sprint 29K guarantees preserved:**
- Passage hash integrity: AcceptedEvidence carries contentHash, gate verifies against stored chunk if it exists
- Semantic entailment: runs against stored snapshot text — identical for KRS or OpenClaw source
- Claim provenance: canonicalSourceId/VersionId assigned by NeedsOps, never by OpenClaw
- Evidence status: accepted status assigned by gate, not OpenClaw
- Tenant scope: enforced at gate before anything enters the pipeline

---

## Part L — Failure and Adversarial Tests

| Scenario | Expected failure point | Layer that fails closed |
|---|---|---|
| **OpenClaw fabricates a source** (non-existent URI, invented text) | Gate: URI lookup fails Library match → SOURCE_NOT_IN_LIBRARY. If passage hash computed over fabricated text — no stored chunk to verify against. → Cannot be admitted as accepted Library evidence | **NeedsOps gate rejects** |
| **Incorrect tenant ID** | Gate: TENANT_MISMATCH → hard reject → security audit event | **NeedsOps gate rejects immediately** |
| **Valid source from wrong tenant** | Gate: organizationId filter catches it | **NeedsOps gate rejects immediately** |
| **Stale document** | Gate: is_current=false → SUPERSEDED_VERSION reject | **NeedsOps gate rejects** |
| **Altered document after retrieval** (hash mismatch) | Gate: contentHash ≠ stored chunk hash → INTEGRITY_FAILED | **NeedsOps gate rejects** |
| **Invented supporting passage** (real document, fabricated quote) | Gate: contentHash of fabricated passage ≠ any stored chunk hash. Not admissible as Library evidence. | **Gate rejects** — but if the document was never ingested, no hash to compare. Risk: intake needed first for full hash protection. |
| **Valid URL but wrong authority** (correct domain, misleading content) | AuthorityRegistry domain match only — URL pattern check insufficient for content. Human review required for conditional sources. | **Partial protection** — URL pattern matching is necessary but not sufficient |
| **Malicious webpage claiming to be regulator** | AuthorityRegistry: domain not registered → EXTERNAL_SOURCE_UNVERIFIED → rejected | **Gate rejects** |
| **Conflicting internal documents** | Both may be accepted if both approved/current. OpenAI detects the conflict from the EvidencePack. This is the desired behaviour. | **Correctly passed through** — conflict detection is OpenAI's job |
| **OpenClaw confidence 0.99 on unapproved source** | Gate: status ≠ approved → UNAPPROVED_SOURCE. Confidence is ignored at gate. | **Gate rejects** |
| **OpenClaw fails midway** | Escalation times out → fall back to KRS-only result. Task continues with reduced evidence. Audit notes escalation failure. | **KRS fallback — degraded but not failed** |
| **OpenClaw returns no evidence** | Empty CandidateEvidence[] → EvidencePack has KRS results only → task continues or fails evidence gate if minimum not met | **Graceful degradation** |
| **KRS and OpenClaw disagree** (KRS scores source low; OpenClaw scores it high) | Gate resolves: if DB confirms approved/current, accept regardless of KRS confidence score. DB is authoritative. | **NeedsOps DB metadata wins** |

**Key principle confirmed:** Discovery failure may reduce recall. It must never lower the authority standard. Every adversarial test is caught at the NeedsOps authority gate, not at OpenClaw.

---

## Part M — Architecture Decision Questions

**1. Does OpenClaw retrieve materially more relevant evidence than current KRS?**  
For in-Library single-document queries: No. For multi-hop cross-referenced policy frameworks and external regulatory sources: Yes — structurally and materially.

**2. Does that remain true after KRS semantic/vector retrieval is properly enabled (Task #149)?**  
For synonym/semantic queries: OpenClaw's advantage disappears when Task #149 is active — KRS handles these correctly. For cross-reference traversal and external sources: OpenClaw's advantage is structural and remains regardless of Task #149.

**3. Is OpenClaw particularly better at multi-document/agentic discovery?**  
Yes — this is its unique structural capability. KRS cannot follow document cross-references. A single-query system cannot traverse a policy → procedure → guideline chain. OpenClaw can.

**4. Does OpenClaw improve external web authority discovery?**  
Yes — provided the AuthorityRegistry is built and maintained. Without it, no external source can be safely admitted to EvidencePack. The AuthorityRegistry is a precondition, not an afterthought.

**5. Can NeedsOps reliably validate what OpenClaw discovers?**  
Yes — for Library sources (hash + DB lookup). Partially — for external sources (domain/URL pattern, not content). The authority gate is reliable for known sources; external sources require the AuthorityRegistry and, for new domains, human review.

**6. Does combined retrieval outperform either system alone?**  
Yes — but only when OpenClaw is escalated, not when run in parallel always. The escalation model captures most of the benefit without the latency cost on simple tasks.

**7. What is the latency/cost penalty?**  
KRS-only: 200-500ms. KRS + OpenClaw escalation: +1-10s for the OpenClaw discovery leg. For tasks where escalation is triggered (complex multi-hop, external regulatory), this is acceptable because the alternative is incomplete evidence. For simple tasks, escalation is not triggered — no penalty.

**8. Should OpenClaw run for every evidence-bearing task or only when KRS coverage is insufficient?**  
Only when escalation triggers are met. Running for every task would add 1-10s to simple lookups with no benefit.

**9. Should OpenClaw ever directly place evidence into EvidencePack?**  
**NO.** All OpenClaw-discovered evidence passes through the NeedsOps authority gate before entering EvidencePack. There is no direct path.

**10. Should OpenClaw ever determine organisational source of truth?**  
**NO.** Organisational source of truth is determined by Library approval status (human-reviewed), authority level (set at ingestion), currentness (is_current=true), and effective dates — all NeedsOps DB metadata. OpenClaw discovers resources. NeedsOps determines what they mean.

---

## Part N — Architecture Recommendation

**N4 — KRS-First with OpenClaw Escalation**

```
Evidence-bearing task arrives
     ↓
KRS retrieval (lexical + vector, 200-500ms) [Task #149 required first]
     ↓
Coverage assessment
     ├── Adequate? (≥3 chunks, avg confidence ≥0.35, no known unresolved refs, no external req)
     │        └── FAST PATH: EvidencePack = KRS result
     └── Insufficient? (low coverage, cross-refs present, external standards needed)
              └── ESCALATE TO OPENCLAW
                    ↓
                OpenClaw agentic discovery
                  - follow cross-references in Library documents
                  - search external sources (if AuthorityRegistry built)
                  - return CandidateEvidence[]
                    ↓
                NeedsOps authority gate
                  - tenant check, library lookup, approval status, currency, integrity, sensitivity
                    ↓
                AcceptedEvidence[] merged with KRS chunks
                → deduplicated → ranked → canonical EvidencePack
```

**Why not N1 (KRS only)?** KRS structurally cannot do cross-reference traversal or external regulatory source discovery. For complex policy work, this produces incomplete evidence.

**Why not N2 (OpenClaw replaces KRS)?** OpenClaw has no authority model, no tenant scope, no approval status awareness. Replacing KRS with OpenClaw would eliminate all governance guarantees. Rejected.

**Why not N3 (parallel always)?** Unnecessary latency for simple tasks. Adds 1-10s to every evidence-bearing request. The benefit (more complete evidence) only materialises for multi-hop and external-source queries, which are the minority of tasks.

**N4 gives:** Fast path for simple queries (KRS quality after Task #149). Deep investigation path for complex multi-document and external-regulatory work. Same authority gate regardless of discovery source. No latency penalty for tasks that don't need OpenClaw.

---

## Part O — Carrying Forward 29N.3 Findings

All 29N.3 findings remain unchanged:
- `/v1/execution` may become the common OpenClaw adapter (confirmed correct direction)
- `execution.openclaw_runtime` entitlement coupling on UEE Cloud is architecturally wrong (confirmed)
- Proposed entitlement model: `execution.professional_work` / `execution.openclaw_cloud` / `execution.openclaw_hybrid` (confirmed)
- OpenAI remains the default professional reasoning engine (confirmed — nothing in this audit changes that)
- TypedExecutionResult is required before production OpenClaw integration (confirmed)

New addition from 29N.4:
- The AuthorityRegistry is a precondition for external source discovery — without it, OpenClaw cannot safely return external evidence
- `CandidateEvidence` contract must be defined before OpenClaw escalation can be wired
- Task #149 is a precondition for efficient escalation (avoids false-positive escalation on synonym mismatches)

**Recommended implementation order:**
1. Task #149 — activate KRS vector retrieval (independent, immediate value)
2. AuthorityRegistry schema design (foundation for external source handling)
3. CandidateEvidence + acceptance gate design (the evidence contract)
4. TypedExecutionResult protocol (gating OpenClaw production integration)
5. OpenClaw escalation wiring (after 1-4 are done)

---

## Evidence Levels Summary

| Finding | Evidence level |
|---|---|
| KRS is lexical-only in production | L1 — confirmed code inspection |
| KRS cannot follow cross-references | L1 — confirmed, no second-hop logic exists |
| KRS vector retrieval is correctly implemented but inactive | L1 — confirmed, `queryEmbedding: null` |
| OpenClaw can perform agentic multi-hop retrieval | PROJECTED — not proven at L3/L4 in this integration |
| OpenClaw external source discovery (web/regulatory) | PROJECTED — no OpenClaw skill confirmed in this codebase |
| Authority gate design (Part B) | L1 — based on existing KRS SQL logic |
| Claim pipeline compatibility | L1 — field mapping confirmed from schema inspection |
| Ingestion auto-approval rules | L1 — confirmed from ingestionPipelineService |
| SHA-256 deduplication at ingestion | L1 — confirmed |
| No AuthorityRegistry exists today | L1 — confirmed absent |
| External requirement claim rule (Sprint 29K) | L1 — confirmed |

---

*Report produced: 8 August 2026. Investigation and design only. No implementation.*
