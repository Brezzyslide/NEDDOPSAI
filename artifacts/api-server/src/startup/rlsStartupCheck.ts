/**
 * RLS + Write Restriction Startup Check — Sprint 7.1
 *
 * Two checks run before the server accepts any traffic:
 *
 * 1. RLS Check: Verifies that Row Level Security is active on all 19 required
 *    platform tables. Missing policy → server refuses to start.
 *
 * 2. Legacy Write Restriction Check: Verifies that needsops_app cannot INSERT,
 *    UPDATE, or DELETE on the 7 legacy write-restricted tables. If write access
 *    exists (e.g. migration was not applied), the server refuses to start.
 *
 * This replaces any manual "remember to run the migration" warnings.
 * Both checks run automatically on every startup and fail loudly.
 *
 * Called from: artifacts/api-server/src/index.ts
 */

import {
  verifyRLS,
  verifyNeedsOpsAppRoleIsSecure,
  RLSVerificationError,
  verifyLegacyTablesReadOnly,
  LegacyWriteError,
} from "@workspace/org-db";
import { logger } from "../lib/logger";

/**
 * Performs the RLS and write restriction startup verifications.
 *
 * @throws {RLSVerificationError} if any required table lacks an RLS policy.
 * @throws {LegacyWriteError} if needsops_app retains write access to legacy tables.
 *   The server should not start if either throws.
 */
export async function runRLSStartupCheck(): Promise<void> {
  // ── 1. RLS policy check ───────────────────────────────────────────────────

  logger.info("[startup] Verifying Row Level Security policies...");
  const rlsResult = await verifyRLS({ failFast: true });

  if (rlsResult.allPoliciesPresent) {
    logger.info(
      { tablesChecked: rlsResult.tableStatuses.length },
      "[startup] RLS verification passed — all required policies present",
    );
  }

  // ── 2. App role bypass check ──────────────────────────────────────────────

  const roleCheck = await verifyNeedsOpsAppRoleIsSecure();
  if (!roleCheck.secure) {
    logger.warn(
      { reason: roleCheck.reason },
      "[startup] WARNING: needsops_app role security issue detected",
    );
  } else {
    logger.info("[startup] needsops_app role verified: rolbypassrls=false");
  }

  // ── 3. Legacy write restriction check ────────────────────────────────────

  logger.info("[startup] Verifying legacy table write restrictions...");
  const writeResult = await verifyLegacyTablesReadOnly();

  if (writeResult.allReadOnly) {
    logger.info(
      { tablesChecked: writeResult.writeableTable.length === 0 ? 7 : writeResult.writeableTable.length },
      "[startup] Legacy table write restriction check passed — all legacy tables read-only",
    );
  } else {
    // Write access on legacy tables is a hard startup failure
    const err = new LegacyWriteError(writeResult);
    logger.error(
      {
        writeableTables: writeResult.writeableTable.map(t => ({
          table: t.tableName,
          privileges: t.privileges,
        })),
      },
      "[FATAL] Legacy table write restrictions not applied. " +
      "Run lib/db/migrations/sprint71-write-restrictions.sql. Server will not start.",
    );
    throw err;
  }
}
