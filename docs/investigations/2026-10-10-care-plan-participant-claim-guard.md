# Care Plan Participant Claim Guard

Branch: `fix/care-plan-participant-claim-guard`

## Scope

This branch adds a render-time guard for participant-attributed care-plan claims. Goals, needs, capabilities, preferences, risks and attestations do not render without supporting evidence. Absence statements are separate: they render only when represented as a structured absence/gap record, not because a cited content chunk exists.

## Client Endorsement

Client Endorsement renders as an unsigned completion block only. The system must not generate participant involvement, agreement, consent or signature wording.

## Goals

Goals remains model-generated in an isolated batch. The guard suppresses uncited rendered rows. A batch that returns no supported goal rows produces suppression records instead of invented goal content.

## Contradiction Check

Do not add a source-evidence contradiction checker in this branch. Contradiction across sources and sections belongs to the participant-scoped fact ledger, where facts can be normalised, classified by nature, linked to cited spans and resolved by precedence. Duplicating that logic in the render guard would create a second, weaker ledger.
