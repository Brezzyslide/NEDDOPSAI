import { db, workerProfilesTable, workforceRoleProfilesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  ROLE_TO_PROFILES,
  WORKER_PROFILES,
  getWorkerProfileByCode,
} from "../lib/workerProfileRegistry.js";
import { getCurrentSpecialists } from "../lib/workforceRegistry.js";
import { buildWorkforceDnaPublicationInventory } from "./dnaStorageService.js";

export interface WorkerProfilePublicationResult {
  workerProfilesInserted: number;
  workerProfilesExisting: number;
  roleMappingsInserted: number;
  roleMappingsExisting: number;
}

export interface WorkforceRuntimeAcceptanceResult {
  expectedRoleCount: number;
  workerProfilesPresent: number;
  roleMappingsPresent: number;
  activePublishedDnaCount: number;
  missing: Array<{
    roleCode: string;
    workerProfileExists: boolean;
    roleMappingExists: boolean;
    activePublishedDnaExists: boolean;
  }>;
  duplicateActive: Array<{ roleCode: string; count: number }>;
}

export function getRuntimeRequiredSpecialistCodes(): string[] {
  return getCurrentSpecialists()
    .filter(s =>
      s.catalogueVersion === "2" &&
      (s.executionStatus === "available" || s.executionStatus === "beta") &&
      s.dnaStatus === "approved"
    )
    .map(s => s.code)
    .sort();
}

export async function reconcileWorkerProfilePublication(): Promise<WorkerProfilePublicationResult> {
  let workerProfilesInserted = 0;
  let workerProfilesExisting = 0;
  let roleMappingsInserted = 0;
  let roleMappingsExisting = 0;

  for (const profile of WORKER_PROFILES) {
    const [existing] = await db
      .select({ code: workerProfilesTable.code })
      .from(workerProfilesTable)
      .where(eq(workerProfilesTable.code, profile.code))
      .limit(1);

    if (existing) {
      workerProfilesExisting += 1;
    } else {
      await db.insert(workerProfilesTable).values({
        id: profile.id,
        code: profile.code,
        displayName: profile.displayName,
        description: profile.description,
        allowedExecutionChannels: profile.allowedExecutionChannels,
        allowedToolCategories: profile.allowedToolCategories,
        allowedConnectorCategories: profile.allowedConnectorCategories,
        allowedBrowserDomains: profile.allowedBrowserDomains,
        allowedLocalPathCategories: profile.allowedLocalPathCategories,
        allowedApplicationCategories: profile.allowedApplicationCategories,
        prohibitedActions: profile.prohibitedActions,
        approvalRequiredActions: profile.approvalRequiredActions,
        riskLevel: profile.riskLevel,
        status: profile.status,
        version: profile.version,
      });
      workerProfilesInserted += 1;
    }
  }

  for (const [roleCode, profileCodes] of Object.entries(ROLE_TO_PROFILES)) {
    for (const profileCode of profileCodes) {
      if (!getWorkerProfileByCode(profileCode)) continue;

      const [existing] = await db
        .select({
          workforceRoleCode: workforceRoleProfilesTable.workforceRoleCode,
          workerProfileCode: workforceRoleProfilesTable.workerProfileCode,
        })
        .from(workforceRoleProfilesTable)
        .where(and(
          eq(workforceRoleProfilesTable.workforceRoleCode, roleCode),
          eq(workforceRoleProfilesTable.workerProfileCode, profileCode),
        ))
        .limit(1);

      if (existing) {
        roleMappingsExisting += 1;
      } else {
        await db.insert(workforceRoleProfilesTable).values({
          workforceRoleCode: roleCode,
          workerProfileCode: profileCode,
          isPrimary: true,
        });
        roleMappingsInserted += 1;
      }
    }
  }

  return {
    workerProfilesInserted,
    workerProfilesExisting,
    roleMappingsInserted,
    roleMappingsExisting,
  };
}

export async function checkWorkforceRuntimeAcceptance(): Promise<WorkforceRuntimeAcceptanceResult> {
  const requiredRoleCodes = getRuntimeRequiredSpecialistCodes();
  const dnaInventory = await buildWorkforceDnaPublicationInventory(requiredRoleCodes);

  const workerProfileRows = await db
    .select({ code: workerProfilesTable.code })
    .from(workerProfilesTable);
  const workerProfileCodes = new Set(workerProfileRows.map(row => row.code));

  const roleMappingRows = await db
    .select({
      workforceRoleCode: workforceRoleProfilesTable.workforceRoleCode,
      workerProfileCode: workforceRoleProfilesTable.workerProfileCode,
    })
    .from(workforceRoleProfilesTable);

  const roleMappings = new Map<string, string[]>();
  for (const row of roleMappingRows) {
    const current = roleMappings.get(row.workforceRoleCode) ?? [];
    current.push(row.workerProfileCode);
    roleMappings.set(row.workforceRoleCode, current);
  }

  const missing: WorkforceRuntimeAcceptanceResult["missing"] = [];
  const duplicateActive: WorkforceRuntimeAcceptanceResult["duplicateActive"] = [];

  for (const roleCode of requiredRoleCodes) {
    const expectedProfileCodes = ROLE_TO_PROFILES[roleCode] ?? [];
    const mappedProfileCodes = roleMappings.get(roleCode) ?? [];
    const workerProfileExists = expectedProfileCodes.some(code => workerProfileCodes.has(code));
    const roleMappingExists = mappedProfileCodes.length > 0;
    const dnaEntry = dnaInventory.find(entry => entry.roleCode === roleCode);
    const activePublishedDnaExists = dnaEntry?.dbPublished === true && dnaEntry.status === "UNCHANGED";

    if (!workerProfileExists || !roleMappingExists || !activePublishedDnaExists) {
      missing.push({
        roleCode,
        workerProfileExists,
        roleMappingExists,
        activePublishedDnaExists,
      });
    }

    if (dnaEntry?.status === "INVALID" && dnaEntry.reasons.some(reason => reason.includes("Multiple published"))) {
      duplicateActive.push({ roleCode, count: 2 });
    }
  }

  return {
    expectedRoleCount: requiredRoleCodes.length,
    workerProfilesPresent: workerProfileRows.length,
    roleMappingsPresent: roleMappingRows.length,
    activePublishedDnaCount: dnaInventory.filter(entry => entry.dbPublished && entry.status === "UNCHANGED").length,
    missing,
    duplicateActive,
  };
}

export function assertWorkforceRuntimeAcceptance(result: WorkforceRuntimeAcceptanceResult): void {
  if (result.missing.length > 0 || result.duplicateActive.length > 0) {
    throw new Error(
      `Workforce runtime acceptance failed: missing=${result.missing.length}, ` +
      `duplicateActive=${result.duplicateActive.length}`,
    );
  }
}
