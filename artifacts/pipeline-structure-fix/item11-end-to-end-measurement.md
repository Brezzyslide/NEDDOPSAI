# Item 11 End-to-End Measurement

Status: blocked for real model generation.

No deploy, image build/push, Terraform apply, DB write, ECS mutation, AWS resource creation or git push occurred.

## Blocker

A true fixed-pipeline care-plan generation requires the OpenAI API key. Local environment does not contain `OPENAI_API_KEY`. Read-only retrieval from AWS Secrets Manager was attempted, but the `needsops-dev` SSO token is expired and the browser callback did not complete in the allowed window. The SSO command was interrupted locally.

This report therefore records the fixed-pipeline structural/token measurement only. It does not claim a generated care-plan document, gate result or model quality result.

## Before/After Token Ledger

Baseline after item 1 deduplication: 37,823 tokens per document.

Approximate stage ledger after items 2-10:

| Stage | Before item 10 | After item 10 | Notes |
|---|---:|---:|---|
| Stage 1 professional draft | 14,779 | 14,657 | Prompt-cache ordering removed the duplicate user request from reusable context/system description; most content is reordered, not removed. |
| Stage 2 final synthesis | 12,650 | 12,650 | Unchanged by item 10. |
| Self-review | ~1,950 | ~1,950 | Unchanged by item 10. |
| Targeted repair | ~1,800 | ~1,800 | Unchanged by item 10. |
| Total | ~31,179 | ~31,057 | Item 10 is primarily a cache-economics fix, not a token-volume reduction. |

## Prompt-Cache Prefix Proof

Using the captured care-plan Stage 1 payload blocks as the before reference and the item-10 source ordering as the after structure:

| Metric | Value |
|---|---:|
| Reordered Stage 1 user-message size | 32,638 chars / ~8,160 tokens |
| Static prefix before cache divider | 30,994 chars / ~7,749 tokens |
| Static prefix share of user message | 95.0% |
| Byte-identical prefix for two different care-plan template requests | 30,994 chars before divider |

Current after ordering:

1. requested operation and deliverable contract
2. deliverable requirement coverage contract
3. blueprint summary
4. standard reusable template mode/output contract
5. internal professional method checklist
6. cache divider
7. organisation style/context, evidence and citation requirements
8. work request

## Variable Elements Moved Behind Divider

The cache-hostile request-specific elements moved out of the static prefix are:

- raw user request
- duplicate `USER_REQUEST` inside professional execution context
- organisation style guidance
- organisation library/evidence chunks
- task-upload metadata when no indexed evidence exists
- organisation memory content
- entity knowledge JSON
- citation requirements tied to retrieved evidence
- evidence chunk IDs and source titles in claim instructions

## Generation Result

Not run. Because the real model generation did not run, the following are not available and must not be inferred:

- output length
- section count
- `deliverable.sections[]` population
- gate result
- adequacyCriteria vs fallback-heuristic validation split
- comparison against the captured skeleton document

Gate: ITEM 11 STRUCTURAL MEASUREMENT RECORDED — LIVE GENERATION BLOCKED BY EXPIRED SSO/OPENAI SECRET ACCESS
