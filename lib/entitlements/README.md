# @workspace/entitlements

Subscription entitlements, workforce pack access gates, connector permissions, and usage limits for the NeedsOps AI+ platform.

## The permissions / entitlements distinction

| Package | Question answered | Key input |
|---|---|---|
| `@workspace/permissions` | "Can **this user** perform this action?" | User role (RBAC) |
| `@workspace/entitlements` | "Does **this organisation's plan** include this?" | Subscription tier + usage counters |

Both checks must pass. An org admin cannot activate a workforce pack if the pack isn't included in their subscription tier, even though they have the RBAC permission to do so.

## Feature gates

Every gated feature has a `FeatureFlag` string constant. Features are mapped to tiers in `TIER_FEATURES`:

| Feature | Starter | Professional | Enterprise |
|---|:---:|:---:|:---:|
| NDIS Compliance pack | ✅ | ✅ | ✅ |
| NDIS Operations pack | ✅ | ✅ | ✅ |
| Enterprise pack | — | ✅ | ✅ |
| Healthcare pack | — | — | ✅ |
| Google Workspace connector | — | ✅ | ✅ |
| Microsoft 365 connector | — | ✅ | ✅ |
| SSO | — | — | ✅ |
| Custom branding | — | — | ✅ |
| Multi-agent orchestration (AI) | — | — | ✅ |

## Usage limits

| Dimension | Starter | Professional | Enterprise |
|---|---|---|---|
| Users | 10 | 50 | Unlimited |
| Active workforce packs | 2 | 5 | Unlimited |
| AI tasks / month | 500 | 5,000 | Unlimited |
| Document pages / month | 100 | 2,000 | Unlimited |
| Active connectors | 0 | 3 | Unlimited |

## Sprint 0 status

Types, tier feature map, usage limits table, and synchronous `checkEntitlementFromTier` / `checkUsageFromTier` helpers for use before Sprint 2 implements the full async `EntitlementService`.

## Sprint 2 plan

1. Create `entitlement_overrides` DB table for per-org plan customisation (enterprise deals)
2. Implement `DbEntitlementService` backed by subscription + override records
3. Wire `checkFeature` into API route middleware
4. Surface entitlement denials in the web portal with contextual upgrade prompts

## Usage (Sprint 0+)

```typescript
import { checkEntitlementFromTier } from "@workspace/entitlements";

const result = checkEntitlementFromTier(
  { subscriptionTier: "starter" },
  "connector:google-workspace",
);

if (!result.granted) {
  // result.denialReason === "feature_not_on_tier"
  // result.requiredTier === "professional"
  // Return HTTP 403 with upgrade prompt
}
```
