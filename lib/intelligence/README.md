# @workspace/intelligence

Business rule engines for the NeedsOps AI+ platform.

## Architectural principle

**Agents call engines. Engines never call agents.**

Rule engines encode deterministic, auditable domain knowledge — Australian Award rates, NDIS price limits, compliance thresholds, risk matrices, and quality indicators. This knowledge is governed by legislation and must be:

- **Versioned** — rules change with each NDIS Pricing Arrangement update (typically annually) and each Fair Work Commission determination
- **Auditable** — every evaluation result must trace back to a specific version of a rule with a source reference
- **Deterministic** — same inputs must always produce the same output, independent of LLM non-determinism
- **Testable** — rule engines have 100% unit test coverage; AI agents do not

Keeping intelligence separate from agents means rule updates do not require retraining or redeploying agents.

## Rule engines (Sprint 2+)

| Engine | ID | Governing document |
|---|---|---|
| SCHADS Award | `schads-award` | Social, Community, Home Care & Disability Services Industry Award 2010 (updated annually by Fair Work Commission) |
| NDIS Pricing | `ndis-pricing` | NDIS Pricing Arrangements & Price Limits (PACE, updated typically annually) |
| NDIS Compliance | `ndis-compliance` | NDIS Practice Standards & Quality Indicators (NDIS Commission) |
| Risk | `risk` | AS/NZS ISO 31000:2018 Risk Management |
| Quality | `quality` | NDIS Quality and Safeguards Commission quality framework |

## Sprint 0 status

Type definitions and `RuleEngine<TInput, TContext>` interface only. No implementations yet.

## Sprint 2 plan

1. Implement `SCHADSAwardEngine` — pay rate lookup against current Fair Work rates
2. Implement `NDISPricingEngine` — price limit lookup against current NDIS Pricing Arrangements
3. Implement `NDISComplianceEngine` — evidence-based compliance check against Practice Standards
4. Implement `RiskMatrixEngine` — 5×5 likelihood × consequence risk rating
5. Implement `QualityIndicatorEngine` — quality domain scoring
6. Version all rule data as JSON under `src/data/<engine-id>/<version>.json`
7. Register engines with an `IntelligenceRegistry` accessible to all agents

## Usage pattern (Sprint 2+)

```typescript
import type { RuleEngine, SCHADSPayRateQuery } from "@workspace/intelligence";

// In a SCHADS-aware agent or API route:
const engine = intelligenceRegistry.get("schads-award");
const result = engine.evaluate({ classification: "disability-services-employee", level: "level-3", payPoint: 1, asOf: "2025-07-01" });

if (!result.passed) {
  // Handle violations — e.g. pay rate below Award minimum
}
```
