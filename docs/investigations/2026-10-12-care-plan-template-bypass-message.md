# Care Plan Template Bypass Message

Local branch: `fix/care-plan-template-bypass-message`

## Residual Hole

The participant-bound invariant is the safety boundary: a task with a bound participant can never use template mode.

The classifier also treats obvious participant-target wording such as `create a care plan from the template for Michael` as evidence-bearing even before a participant is bound. That is still wording logic, not the structural invariant.

Residual risk: if a user asks for a care plan for a person who has no participant record yet, and the wording looks like a template request but does not match the participant-target wording guard, the classifier may route as template mode because there is no participant binding for UEE to re-assert. This is lower likelihood than the bound-participant bypass risk, but it remains debt if template vocabulary expands.
