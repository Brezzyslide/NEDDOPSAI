import { describe, expect, it } from "vitest";
import { findUnconfirmedCarePlanProtectiveStrategies } from "../services/carePlanBehaviourStrategyService";

describe("care plan behaviour strategy confirmation", () => {
  it("ignores placeholder-only protective template rows", () => {
    const issues = findUnconfirmedCarePlanProtectiveStrategies(`## Behavioural Management

### Protective strategies

| Behaviour or trigger | Strategy | What the worker does | BSP source |
| --- | --- | --- | --- |
| [PROTECTIVE_BEHAVIOUR_OR_TRIGGER] | [PROTECTIVE_STRATEGY] (UNCONFIRMED - APO review required before approval) | [PROTECTIVE_WORKER_ACTIONS] | [PROTECTIVE_BSP_SOURCE] |`);

    expect(issues).toHaveLength(0);
  });

  it("blocks real protective rows until APO confirmation is represented", () => {
    const issues = findUnconfirmedCarePlanProtectiveStrategies(`## Behavioural Management

### Protective strategies

| Behaviour or trigger | Strategy | What the worker does | BSP source |
| --- | --- | --- | --- |
| Escalation with harm risk | Move hazards away (UNCONFIRMED - APO review required before approval) | Remove loose items from reach | "Remove loose items" - BSP page 8 |`);

    expect(issues).toEqual([
      expect.objectContaining({
        strategy: expect.stringContaining("Move hazards away"),
        reason: "Protective strategy is visibly marked unconfirmed.",
      }),
    ]);
  });

  it("allows real protective rows with an APO confirmation signal", () => {
    const issues = findUnconfirmedCarePlanProtectiveStrategies(`## Behavioural Management

### Protective strategies

| Behaviour or trigger | Strategy | What the worker does | BSP source |
| --- | --- | --- | --- |
| Escalation with harm risk | Move hazards away - APO confirmed | Remove loose items from reach after APO confirmation | "Remove loose items" - BSP page 8 |`);

    expect(issues).toHaveLength(0);
  });
});
