/**
 * NeedsOps Runtime Broker — Execution Package Validation
 *
 * Validates inbound OpenClawExecutionPackage bodies before the broker
 * accepts them. This is defence-in-depth — NeedsOps already validates
 * on its side before sending, but the broker must not trust callers.
 *
 * Rules enforced:
 *   - Required fields must be present and non-empty
 *   - executionId and tenantId must be valid UUIDs
 *   - expiresAt must be a future ISO timestamp
 *   - steps must be a non-empty array
 *   - callbackUrl must be HTTPS (or HTTP in non-production)
 *   - callbackUrl must not point to loopback / private-network addresses
 *     (unless BROKER_ALLOW_LOCAL_CALLBACKS=true)
 */

import { z } from "zod";

// ─── UUID helper ──────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidSchema = z
  .string()
  .regex(UUID_RE, "must be a valid UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)");

// ─── Execution package schema ─────────────────────────────────────────────────

const workerProfileSchema = z.object({
  allowedChannels: z.array(z.string()).min(1),
  allowedBrowserDomains: z.array(z.string()),
  allowedLocalPathCategories: z.array(z.string()),
  allowedApplicationCategories: z.array(z.string()),
  prohibitedActions: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high"]),
  requiresApprovalFor: z.array(z.string()),
});

const stepSchema = z.object({
  sequence: z.number().int().min(1),
  specialist: z.string().min(1),
  action: z.string().min(1),
  description: z.string().min(1),
  requiresApproval: z.boolean(),
  estimatedDurationSeconds: z.number().int().positive().optional(),
});

const constraintsSchema = z.object({
  maxDurationSeconds: z.number().int().min(1).max(86400), // max 24 hours
  requireHumanApprovalBeforeSubmit: z.boolean(),
  allowedDataCategories: z.array(z.string()),
});

// ─── Specialist Runtime Manifest schema ───────────────────────────────────────
// Sprint SRM: all new packages must carry a compiled manifest.
// Old packages without specialistManifest are rejected with UNSUPPORTED_PACKAGE_VERSION.

const competencySchema = z.object({
  code:        z.string().min(1),
  name:        z.string().min(1),
  level:       z.string().min(1),
  description: z.string(),
  version:     z.string().min(1),
});

const specialistManifestSchema = z.object({
  specialistId:       z.string().min(1),
  workforceRole:      z.string().min(1),
  displayName:        z.string().min(1),
  domain:             z.string().min(1),
  dnaProfileId:       z.string().min(1),
  dnaVersion:         z.string().min(1),
  manifestVersion:    z.literal(1),
  mission:            z.string().min(1),
  objectives:         z.array(z.string()),
  responsibilities:   z.array(z.string()),
  operatingPrinciples: z.array(z.string()),
  communicationStyle: z.object({
    tone:        z.string(),
    detailLevel: z.string(),
    language:    z.string(),
  }),
  competencies:        z.array(competencySchema),
  escalationRules:     z.array(z.string()),
  prohibitedBehaviours: z.array(z.string()),
  memoryPolicy: z.object({
    allowedScopes:    z.array(z.string()),
    prohibitedScopes: z.array(z.string()),
  }),
  manifestHash: z.string().min(1),
  generatedAt:  z.string().datetime(),
});

export const executionPackageSchema = z.object({
  executionId: uuidSchema,
  tenantId: uuidSchema,
  workforceRole: z.string().min(1).max(64),
  // Sprint SRM: optional at the Zod level so parsing succeeds on old packages.
  // The post-parse backward-compat check below rejects absent manifests with
  // UNSUPPORTED_PACKAGE_VERSION instead of a generic schema error.
  specialistManifest: specialistManifestSchema.optional(),
  workerProfile: workerProfileSchema,
  steps: z.array(stepSchema).min(1).max(100),
  requestedTools: z.array(z.string()),
  requestedChannels: z.array(z.string()),
  requestedConnectorCategories: z.array(z.string()),
  approvalState: z.string(),
  constraints: constraintsSchema,
  callbackUrl: z.string().url("callbackUrl must be a valid URL"),
  expiresAt: z.string().datetime("expiresAt must be an ISO 8601 datetime"),
  issuedAt: z.string().datetime("issuedAt must be an ISO 8601 datetime"),
});

export type ValidatedExecutionPackage = z.infer<typeof executionPackageSchema>;

// ─── Private network CIDR detection ──────────────────────────────────────────

const LOOPBACK_RE = /^(127\.|::1$|localhost)/i;
const PRIVATE_RE =
  /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;

function isLocalAddress(hostname: string): boolean {
  return LOOPBACK_RE.test(hostname) || PRIVATE_RE.test(hostname);
}

// ─── Public validation function ───────────────────────────────────────────────

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  package?: ValidatedExecutionPackage;
}

export function validateInboundPackage(
  body: unknown,
  options: { allowLocalCallbacks?: boolean; nodeEnv?: string } = {},
): ValidationResult {
  const allowLocal = options.allowLocalCallbacks ??
    (process.env.BROKER_ALLOW_LOCAL_CALLBACKS === "true");
  const isProd = (options.nodeEnv ?? process.env.NODE_ENV) === "production";

  // 1. Schema validation
  const parsed = executionPackageSchema.safeParse(body);
  if (!parsed.success) {
    const errors: ValidationError[] = parsed.error.issues.map((issue) => ({
      code: "VALIDATION_ERROR",
      message: issue.message,
      field: issue.path.join("."),
    }));
    return { valid: false, errors };
  }

  const pkg = parsed.data;
  const errors: ValidationError[] = [];

  // 2. Backward compatibility: reject packages without a specialist manifest.
  //    Old packages compiled before Sprint SRM must not be re-submitted.
  //    They must not silently produce an unversioned persona.
  if (!pkg.specialistManifest) {
    return {
      valid: false,
      errors: [{
        code: "UNSUPPORTED_PACKAGE_VERSION",
        message:
          "Execution package is missing specialistManifest. " +
          "This package was compiled before Sprint SRM and is no longer accepted. " +
          "Re-submit with a compiled SpecialistRuntimeManifest (manifestVersion: 1).",
        field: "specialistManifest",
      }],
    };
  }

  // 3. workforceRole must match manifest
  if (pkg.specialistManifest.workforceRole !== pkg.workforceRole) {
    return {
      valid: false,
      errors: [{
        code: "MANIFEST_ROLE_MISMATCH",
        message:
          `specialistManifest.workforceRole (${pkg.specialistManifest.workforceRole}) ` +
          `does not match workforceRole (${pkg.workforceRole})`,
        field: "specialistManifest.workforceRole",
      }],
    };
  }

  // 2. Expiry check
  const now = Date.now();
  const expiresAt = new Date(pkg.expiresAt).getTime();
  if (expiresAt <= now) {
    errors.push({
      code: "PACKAGE_EXPIRED",
      message: `Execution package expired at ${pkg.expiresAt}`,
      field: "expiresAt",
    });
  }

  // 3. callbackUrl scheme check — HTTPS required in production
  let callbackHostname: string;
  try {
    const url = new URL(pkg.callbackUrl);
    callbackHostname = url.hostname;
    if (isProd && url.protocol !== "https:") {
      errors.push({
        code: "INSECURE_CALLBACK",
        message: "callbackUrl must use HTTPS in production",
        field: "callbackUrl",
      });
    }
  } catch {
    errors.push({
      code: "INVALID_CALLBACK_URL",
      message: "callbackUrl is not a valid URL",
      field: "callbackUrl",
    });
    return { valid: false, errors };
  }

  // 4. callbackUrl must not point to local/private addresses in production
  if (isProd && !allowLocal && isLocalAddress(callbackHostname)) {
    errors.push({
      code: "LOCAL_CALLBACK_FORBIDDEN",
      message:
        "callbackUrl must not point to a loopback or private-network address in production. " +
        "Set BROKER_ALLOW_LOCAL_CALLBACKS=true to override.",
      field: "callbackUrl",
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], package: pkg };
}

// ─── Control request validation ───────────────────────────────────────────────

export const controlRequestSchema = z.object({
  tenantId: uuidSchema,
  requestedAt: z.string().datetime().optional(),
});

export type ValidatedControlRequest = z.infer<typeof controlRequestSchema>;

export function validateControlRequest(body: unknown): ValidationResult {
  const parsed = controlRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => ({
        code: "VALIDATION_ERROR",
        message: i.message,
        field: i.path.join("."),
      })),
    };
  }
  return { valid: true, errors: [], package: undefined };
}
