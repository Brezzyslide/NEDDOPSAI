/**
 * @workspace/entitlements
 *
 * Subscription entitlements, workforce pack access gates,
 * connector permissions, and usage limits for the NeedsOps AI+ platform.
 *
 * Answers: "Does this organisation's plan include this feature?"
 * (Distinct from @workspace/permissions which answers: "Can this user do this action?")
 *
 * Sprint 0: types, tier feature map, usage limits, and static helpers.
 * Sprint 2+: async EntitlementService backed by live subscription records.
 */

export * from "./types.js";
export * from "./helpers.js";
