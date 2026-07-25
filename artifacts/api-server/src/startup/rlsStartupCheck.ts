/**
 * RLS Startup Check — Sprint 7
 *
 * Verifies that Row Level Security is active on all required platform tables
 * before the server accepts traffic. If any table is missing its RLS policy,
 * the server refuses to start.
 *
 * This replaces the manual "remember to re-run sprint5-rls.sql" warning.
 * The check runs automatically on every startup and fails loudly.
 *
 * Called from: artifacts/api-server/src/index.ts
 */

import { verifyRLS, verifyNeedsOpsAppRoleIsSecure, RLSVerificationError } from "@workspace/org-db";
import { logger } from "../lib/logger";

/**
 * Performs the RLS startup verification.
 *
 * @throws {RLSVerificationError} if any required table lacks an RLS policy.
 *   The server should not start if this throws.
 */
export async function runRLSStartupCheck(): Promise<void> {
  logger.info("[startup] Verifying Row Level Security policies...");

  // Check RLS on all 19 required tables — throws if any are missing
  const result = await verifyRLS({ failFast: true });

  if (result.allPoliciesPresent) {
    logger.info(
      { tablesChecked: result.tableStatuses.length },
      "[startup] RLS verification passed — all required policies present",
    );
  }

  // Verify the application role cannot bypass RLS
  const roleCheck = await verifyNeedsOpsAppRoleIsSecure();
  if (!roleCheck.secure) {
    logger.warn(
      { reason: roleCheck.reason },
      "[startup] WARNING: needsops_app role security issue detected",
    );
    // Role check is a warning, not a hard failure — it may not exist in dev
  } else {
    logger.info("[startup] needsops_app role verified: rolbypassrls=false");
  }
}
