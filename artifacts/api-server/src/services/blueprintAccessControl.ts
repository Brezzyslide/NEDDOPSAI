/**
 * Blueprint Access Control — Production Blueprint Architecture
 *
 * Enforces the two-layer visibility model:
 *
 *   BlueprintDescriptor  — safe to expose to any authenticated user
 *   BlueprintSpecification — platform-private; never returned to tenant roles
 *
 * Visibility matrix:
 *
 *   ┌─────────────────────┬──────────────┬──────────────────────────────────┐
 *   │ Role                │ Platform bp  │ Org-owned bp                     │
 *   ├─────────────────────┼──────────────┼──────────────────────────────────┤
 *   │ member / viewer     │ Descriptor   │ Descriptor                       │
 *   │ manager / auditor   │ Descriptor   │ Descriptor                       │
 *   │ org owner / admin   │ Descriptor + │ Full (they own it)               │
 *   │                     │ permittedOverrides │                           │
 *   │ platform admin      │ Full spec    │ Full                             │
 *   └─────────────────────┴──────────────┴──────────────────────────────────┘
 *
 * Private specification fields are stripped at the API boundary.
 * They must NEVER appear in client responses for tenant roles.
 */

// ─── Private spec fields (never returned to tenant roles on platform bps) ────

const PRIVATE_SPEC_FIELDS: ReadonlySet<string> = new Set([
  "objective",
  "primarySpecialist",
  "supportingSpecialists",
  "requiredLibraryKnowledge",
  "requiredEntityKnowledge",
  "requiredMemories",
  "requiredApprovals",
  "validationRules",
  "qualityRules",
  "successCriteria",
  "outputTypes",
  "escalationRules",
  "mandatoryCitations",
  "deliverableContract",
  "evidenceContract",
  "internalExecutionInstructions",
]);

// ─── Context ──────────────────────────────────────────────────────────────────

export interface BlueprintAccessContext {
  /** Tenant membership role of the requesting user. */
  role: string | null;
  /** Organisation UUID of the requesting user's tenant. */
  tenantId: string;
  /** True if the user has platform-level admin access. */
  isPlatformAdmin: boolean;
}

// ─── Filter function ──────────────────────────────────────────────────────────

/**
 * Strips private specification fields from a blueprint object based on caller
 * role and blueprint ownership.
 *
 * Returns a copy — does NOT mutate the input.
 */
export function filterBlueprintForRole(
  blueprint: Record<string, unknown>,
  ctx: BlueprintAccessContext,
): Record<string, unknown> {
  // Platform admin: full access
  if (ctx.isPlatformAdmin) return { ...blueprint };

  const isPlatformBlueprint =
    blueprint.organizationId == null || blueprint.ownerType === "platform_owned";

  const isOrgOwnedByCallerOrg =
    !isPlatformBlueprint &&
    blueprint.organizationId === ctx.tenantId;

  // Org-owned blueprint fully visible to the owning org's owner/admin
  if (isOrgOwnedByCallerOrg) {
    if (ctx.role === "owner" || ctx.role === "administrator") {
      return { ...blueprint };
    }
    // Other roles in the org: descriptor only
    return stripSpecFields(blueprint, /* includePermittedOverrides */ false);
  }

  // Platform blueprint: strip spec fields for all tenant roles
  const includePermittedOverrides =
    ctx.role === "owner" || ctx.role === "administrator";

  return stripSpecFields(blueprint, includePermittedOverrides);
}

/**
 * Filter an array of blueprints.
 */
export function filterBlueprintsForRole(
  blueprints: Record<string, unknown>[],
  ctx: BlueprintAccessContext,
): Record<string, unknown>[] {
  return blueprints.map(bp => filterBlueprintForRole(bp, ctx));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripSpecFields(
  bp: Record<string, unknown>,
  includePermittedOverrides: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bp)) {
    if (PRIVATE_SPEC_FIELDS.has(key)) continue;
    if (key === "permittedOrgOverrides" && !includePermittedOverrides) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Returns true if the blueprint contains any private spec fields.
 * Used in tests to assert no leakage.
 */
export function blueprintHasPrivateFields(bp: Record<string, unknown>): boolean {
  return [...PRIVATE_SPEC_FIELDS].some(f => f in bp);
}

/**
 * Check whether a given Clerk session / app user context qualifies as
 * platform admin. Matches the AppShell isPlatformAdmin pattern.
 */
export function isTenantPlatformAdmin(req: any): boolean {
  try {
    // Express req may have Clerk auth attached via getAuth()
    const metadata =
      (req?.auth?.sessionClaims as any)?.metadata ??
      (req?.appUser as any)?.publicMetadata;
    return metadata?.platformAdmin === true || metadata?.platformRole != null;
  } catch {
    return false;
  }
}
