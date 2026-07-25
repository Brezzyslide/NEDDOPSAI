/**
 * @workspace/org-db — Sprint 6
 *
 * Organisation Operational Database library.
 *
 * Exports:
 *   - createOrgSchema()       — Drizzle schema definitions for org tables
 *   - withOrgContext()        — Primary org data access gateway
 *   - provisionOrgDb()        — Provision a new org database/schema
 *   - deprovisionOrgDb()      — Remove an org schema (pre-migration only)
 *   - checkOrgDbHealth()      — Health check for an org's schema
 *   - drainAllPools()         — Graceful shutdown
 *   - drainOrgPool()          — Drain one org's connection pool
 *   - getPoolStatus()         — Connection pool metrics
 *   - deriveSchemaName()      — Org UUID → PostgreSQL schema name
 *   - OrgConnectionError      — Typed error for routing failures
 */

export { createOrgSchema, type OrgSchemaType } from "./schema";
export {
  withOrgContext,
  checkOrgDbHealth,
  drainAllPools,
  drainOrgPool,
  getPoolStatus,
  OrgConnectionError,
  type OrgConnection,
  type OrgConnectionContext,
  type OrgDbHealth,
} from "./orgConnectionManager";
export {
  provisionOrgDb,
  deprovisionOrgDb,
  deriveSchemaName,
  type ProvisionOrgDbInput,
  type ProvisionOrgDbResult,
  type ProvisioningStep,
} from "./orgProvisioningService";
