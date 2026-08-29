# Item 11 Repair Assembly Measurement

No deploy, image build/push, Terraform apply, DB write, ECS mutation, AWS resource creation or git push occurred.

## Source of Truth

This run used the saved item 11 provider-boundary request bodies and applied the current local repair-assembly and validation contract:

- `deliverable.assembledMarkdown` removed from strict response schema.
- Model returns `deliverable.sections[]`.
- Repair returns only changed section deltas.
- Local code merges repair deltas by `requirementId`.
- Markdown is assembled deterministically from merged `deliverable.sections[]`.
- Self-describing section prose is stripped before fallback substantive word count.
- Internal classification tokens in deliverable content are hard methodology leakage failures.

## Diagnosis

Repair already receives only deficient sections, not the full deliverable. The defect was downstream assembly: repair output was treated as a replacement deliverable instead of a delta over the existing `deliverable.sections[]`.

Stage 2 and repair now use the same deterministic assembly rule: ordered `deliverable.sections[]` become the final markdown. Repair first merges changed sections into the current section set, then assembles.

## Before vs After

Before is the prior item 11 live measurement. After is this repair-assembly rerun.

| Stage | Before input | Before output | Before total | After input | After output | After total |
|---|---:|---:|---:|---:|---:|---:|
| Stage 1 professional draft | 8,246 | 1,327 | 9,573 | 8,239 | 1,567 | 9,806 |
| Targeted repair | 1,056 | 302 | 1,358 | 1,326 | 392 | 1,718 |
| Total measured generation | 9,302 | 1,629 | 10,931 | 9,565 | 1,959 | 11,524 |

## Cost

Using the same script rates as prior item 11 measurement:

| Metric | Value |
|---|---:|
| Before actual cost | $0.002373 |
| After actual cost | $0.001996 |
| After with observed Stage 1 cache hit | $0.001996 |
| Observed Stage 1 cached prefix | 8,192 tokens / 99.4% |
| Additional projected saving over this run | $0.000000 because the provider reported the Stage 1 prefix cache hit in this run |

## Output

| Metric | Value |
|---|---:|
| Stage 1 sections | 9 |
| Stage 1 missing/thin requirements | mandatory-1, mandatory-2, mandatory-8 |
| Repair returned delta sections | 3 |
| Merged final sections | 9 |
| Required requirements | 9 |
| Final assembled words | 279 |
| Final assembled chars | 2,337 |

## Gate Results

| Gate | Result |
|---|---|
| Structured output | pass |
| `deliverable.sections[]` populated per requirement | pass |
| Fallback heuristic validated | 8/9 |
| Adequacy criteria validated | 0/9 |
| Missing/thin requirements after repair | mandatory-2 |
| Classification leakage | none |
| Self-reported readyForCompletedWork | true |
| Self-reported methodologyLeakage | false |

All current Care Plan requirements remain `DERIVED` with no authored adequacy criteria, so validation is still fallback heuristic only. After stripping self-description, the final output is blocked because `mandatory-2` is only field labels/placeholders and has 13 counted words.

## Remaining Quality Caveat

The assembly defect is fixed, and the rerun no longer leaked `FACTUAL_FIELD` labels. The stricter fallback gate now correctly blocks the hollow Goals and Preferences section. This confirms the next quality problem is authored requirement/adequacy content and validation depth, not repair assembly.

Gate: SELF-ASSERTION AND CLASSIFICATION LEAKAGE FIXED — rerun blocked by substantive fallback validation.
