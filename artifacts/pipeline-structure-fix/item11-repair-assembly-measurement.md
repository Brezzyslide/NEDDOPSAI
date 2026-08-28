# Item 11 Repair Assembly Measurement

No deploy, image build/push, Terraform apply, DB write, ECS mutation, AWS resource creation or git push occurred.

## Source of Truth

This run used the saved item 11 provider-boundary request bodies and applied the current local repair-assembly contract:

- `deliverable.assembledMarkdown` removed from strict response schema.
- Model returns `deliverable.sections[]`.
- Repair returns only changed section deltas.
- Local code merges repair deltas by `requirementId`.
- Markdown is assembled deterministically from merged `deliverable.sections[]`.

## Diagnosis

Repair already receives only deficient sections, not the full deliverable. The defect was downstream assembly: repair output was treated as a replacement deliverable instead of a delta over the existing `deliverable.sections[]`.

Stage 2 and repair now use the same deterministic assembly rule: ordered `deliverable.sections[]` become the final markdown. Repair first merges changed sections into the current section set, then assembles.

## Before vs After

Before is the prior item 11 live measurement. After is this repair-assembly rerun.

| Stage | Before input | Before output | Before total | After input | After output | After total |
|---|---:|---:|---:|---:|---:|---:|
| Stage 1 professional draft | 8,246 | 1,327 | 9,573 | 8,239 | 1,603 | 9,842 |
| Targeted repair | 1,056 | 302 | 1,358 | 1,029 | 225 | 1,254 |
| Total measured generation | 9,302 | 1,629 | 10,931 | 9,268 | 1,828 | 11,096 |

## Cost

Using the same script rates as prior item 11 measurement:

| Metric | Value |
|---|---:|
| Before actual cost | $0.002373 |
| After actual cost | $0.002487 |
| After with Stage 1 cache-hit estimate | $0.001893 |
| Stage 1 cacheable prefix | 7,923 tokens / 96.2% |
| Projected cache-hit saving | $0.000594 per document |

## Output

| Metric | Value |
|---|---:|
| Stage 1 sections | 9 |
| Stage 1 missing/thin requirements | mandatory-7 |
| Repair returned delta sections | 1 |
| Merged final sections | 9 |
| Required requirements | 9 |
| Final assembled words | 291 |
| Final assembled chars | 2,334 |

## Gate Results

| Gate | Result |
|---|---|
| Structured output | pass |
| `deliverable.sections[]` populated per requirement | pass |
| Fallback heuristic validated | 9/9 |
| Adequacy criteria validated | 0/9 |
| Missing/thin requirements after repair | none |
| Self-reported readyForCompletedWork | true |
| Self-reported methodologyLeakage | false |

All current Care Plan requirements remain `DERIVED` with no authored adequacy criteria, so validation is still fallback heuristic only.

## Remaining Quality Caveat

The assembly defect is fixed, but the generated document is still shallow and the repaired risk section includes `FACTUAL_FIELD:` labels. The current fallback heuristic passes it because every requirement has a section and at least 18 words. This confirms the next quality problem is authored requirement/adequacy content and validation depth, not repair assembly.

Gate: REPAIR ASSEMBLY FIXED — deterministic assembly, repair returns deltas only.
