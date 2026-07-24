/**
 * Worker Profile tests — Sprint 2 Architecture Correction
 *
 * Tests: role-to-worker-profile mapping, profile integrity,
 * permission boundary rules, risk classification, architecture chain.
 */

import { describe, it, expect } from "vitest";

import {
  WORKER_PROFILES,
  ROLE_TO_PROFILES,
  getWorkerProfileByCode,
  getWorkerProfilesForRole,
  getActiveWorkerProfilesForRole,
  getRoleCodesForProfile,
  type WorkerProfile,
} from "../lib/workerProfileRegistry.js";

import {
  SPECIALISTS,
  getSpecialistByCode,
} from "../lib/workforceRegistry.js";

import {
  EXECUTION_CHANNELS,
  TOOL_CATEGORIES,
  CONNECTOR_CATEGORIES,
  RISK_LEVELS,
  WORKER_PROFILE_STATUSES,
} from "@workspace/shared";

// ─── Registry integrity ───────────────────────────────────────────────────────

describe("Worker Profile Registry integrity", () => {
  it("contains exactly 32 worker profiles (one per specialist)", () => {
    expect(WORKER_PROFILES).toHaveLength(32);
  });

  it("every profile has a unique id", () => {
    const ids = WORKER_PROFILES.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every profile has a unique code", () => {
    const codes = WORKER_PROFILES.map(p => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every profile has a valid status", () => {
    for (const p of WORKER_PROFILES) {
      expect(WORKER_PROFILE_STATUSES).toContain(p.status);
    }
  });

  it("every profile has a valid risk level", () => {
    for (const p of WORKER_PROFILES) {
      expect(RISK_LEVELS).toContain(p.riskLevel);
    }
  });

  it("every profile has a semver version", () => {
    for (const p of WORKER_PROFILES) {
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("every profile's allowedExecutionChannels are valid EXECUTION_CHANNELS values", () => {
    const valid = new Set(EXECUTION_CHANNELS);
    for (const p of WORKER_PROFILES) {
      for (const ch of p.allowedExecutionChannels) {
        expect(valid.has(ch as never)).toBe(true);
      }
    }
  });

  it("every profile's allowedToolCategories are valid TOOL_CATEGORIES values", () => {
    const valid = new Set(TOOL_CATEGORIES);
    for (const p of WORKER_PROFILES) {
      for (const tc of p.allowedToolCategories) {
        expect(valid.has(tc as never)).toBe(true);
      }
    }
  });

  it("every profile's allowedConnectorCategories are valid CONNECTOR_CATEGORIES values", () => {
    const valid = new Set(CONNECTOR_CATEGORIES);
    for (const p of WORKER_PROFILES) {
      for (const cc of p.allowedConnectorCategories) {
        expect(valid.has(cc as never)).toBe(true);
      }
    }
  });

  it("every profile has arrays (not undefined) for all boundary fields", () => {
    const fields: (keyof WorkerProfile)[] = [
      "allowedExecutionChannels",
      "allowedToolCategories",
      "allowedConnectorCategories",
      "allowedBrowserDomains",
      "allowedLocalPathCategories",
      "allowedApplicationCategories",
      "prohibitedActions",
      "approvalRequiredActions",
    ];
    for (const p of WORKER_PROFILES) {
      for (const field of fields) {
        expect(Array.isArray(p[field])).toBe(true);
      }
    }
  });
});

// ─── Role-to-profile mapping ──────────────────────────────────────────────────

describe("Role-to-Worker-Profile mapping", () => {
  it("every Workforce Role (specialist) has at least one Worker Profile mapped", () => {
    for (const specialist of SPECIALISTS) {
      const profiles = ROLE_TO_PROFILES[specialist.code];
      expect(profiles).toBeDefined();
      expect(profiles!.length).toBeGreaterThan(0);
    }
  });

  it("every profile code referenced in ROLE_TO_PROFILES exists in WORKER_PROFILES", () => {
    const profileCodes = new Set(WORKER_PROFILES.map(p => p.code));
    for (const [, codes] of Object.entries(ROLE_TO_PROFILES)) {
      for (const code of codes) {
        expect(profileCodes.has(code)).toBe(true);
      }
    }
  });

  it("every Workforce Role's workerProfileCodes field references real profiles", () => {
    const profileCodes = new Set(WORKER_PROFILES.map(p => p.code));
    for (const specialist of SPECIALISTS) {
      for (const code of specialist.workerProfileCodes) {
        expect(profileCodes.has(code)).toBe(
          true,
          `${specialist.code} references unknown profile: ${code}`
        );
      }
    }
  });

  it("ROLE_TO_PROFILES covers all 32 specialists", () => {
    expect(Object.keys(ROLE_TO_PROFILES)).toHaveLength(32);
  });

  it("getWorkerProfilesForRole returns profiles for a valid role", () => {
    const profiles = getWorkerProfilesForRole("compliance_officer");
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles[0]!.code).toBe("compliance_officer_profile");
  });

  it("getWorkerProfilesForRole returns empty array for unknown role", () => {
    expect(getWorkerProfilesForRole("nonexistent_role")).toHaveLength(0);
  });

  it("getWorkerProfileByCode finds a profile by code", () => {
    const p = getWorkerProfileByCode("chief_of_staff_profile");
    expect(p).toBeDefined();
    expect(p?.displayName).toContain("Chief of Staff");
  });

  it("getWorkerProfileByCode returns undefined for unknown code", () => {
    expect(getWorkerProfileByCode("does_not_exist")).toBeUndefined();
  });

  it("getRoleCodesForProfile returns the role(s) that use a given profile", () => {
    const roles = getRoleCodesForProfile("payroll_officer_profile");
    expect(roles).toContain("payroll_officer");
  });

  it("getRoleCodesForProfile returns empty array for profile not mapped to any role", () => {
    expect(getRoleCodesForProfile("ghost_profile")).toHaveLength(0);
  });
});

// ─── Active profile filtering ─────────────────────────────────────────────────

describe("Active Worker Profile filtering", () => {
  it("getActiveWorkerProfilesForRole excludes coming_soon profiles", () => {
    // Marketing roles have coming_soon profiles
    const profiles = getActiveWorkerProfilesForRole("marketing_director");
    expect(profiles.filter(p => p.status === "coming_soon")).toHaveLength(0);
  });

  it("getActiveWorkerProfilesForRole returns active profiles for core roles", () => {
    const profiles = getActiveWorkerProfilesForRole("chief_of_staff");
    expect(profiles.length).toBeGreaterThan(0);
    for (const p of profiles) {
      expect(["active", "beta"]).toContain(p.status);
    }
  });
});

// ─── Architecture correctness ────────────────────────────────────────────────

describe("Architecture correctness — Workforce Role vs Worker Profile separation", () => {
  it("Chief of Staff profile has no direct data access channels (orchestration only)", () => {
    const profile = getWorkerProfileByCode("chief_of_staff_profile");
    expect(profile?.allowedExecutionChannels).toEqual(["internal_api"]);
    expect(profile?.allowedConnectorCategories).toHaveLength(0);
  });

  it("Chief of Staff profile prohibits data modification", () => {
    const profile = getWorkerProfileByCode("chief_of_staff_profile");
    expect(profile?.prohibitedActions).toContain("modify_data");
  });

  it("Payroll Officer profile prohibits payment processing (highest-sensitivity finance role)", () => {
    const profile = getWorkerProfileByCode("payroll_officer_profile");
    expect(profile?.prohibitedActions).toContain("process_payment");
    expect(profile?.prohibitedActions).toContain("modify_bank_account_details");
    expect(profile?.prohibitedActions).toContain("approve_payrun");
    expect(profile?.prohibitedActions).toContain("access_tax_file_numbers");
  });

  it("Restrictive Practice Officer profile requires approval for all NDIS submissions", () => {
    const profile = getWorkerProfileByCode("restrictive_practice_officer_profile");
    expect(profile?.approvalRequiredActions).toContain("submit_rp_report_to_ndis");
  });

  it("all marketing profiles are coming_soon (pack not yet released)", () => {
    const marketingRoles = ["marketing_director", "content_strategist", "campaign_manager", "brand_manager", "social_media_specialist"];
    for (const role of marketingRoles) {
      const profiles = getWorkerProfilesForRole(role);
      for (const p of profiles) {
        expect(p.status).toBe("coming_soon");
      }
    }
  });

  it("no worker profile grants local_files channel (not live yet)", () => {
    for (const p of WORKER_PROFILES) {
      expect(p.allowedExecutionChannels).not.toContain("local_files");
    }
  });

  it("no worker profile has allowed browser domains defined (future sprint)", () => {
    for (const p of WORKER_PROFILES) {
      expect(p.allowedBrowserDomains).toHaveLength(0);
    }
  });

  it("no worker profile has local path categories defined (future sprint)", () => {
    for (const p of WORKER_PROFILES) {
      expect(p.allowedLocalPathCategories).toHaveLength(0);
    }
  });

  it("high-risk profiles all have prohibitedActions defined", () => {
    const highRisk = WORKER_PROFILES.filter(p => p.riskLevel === "high");
    expect(highRisk.length).toBeGreaterThan(0);
    for (const p of highRisk) {
      expect(p.prohibitedActions.length).toBeGreaterThan(0);
    }
  });

  it("Workforce Roles do not own execution permissions — that is Worker Profile's concern", () => {
    // Specialists (Workforce Roles) have no direct channel or tool access fields
    const specialist = getSpecialistByCode("compliance_officer");
    expect((specialist as unknown as Record<string, unknown>)["allowedExecutionChannels"]).toBeUndefined();
    expect((specialist as unknown as Record<string, unknown>)["allowedToolCategories"]).toBeUndefined();
    expect((specialist as unknown as Record<string, unknown>)["prohibitedActions"]).toBeUndefined();
  });
});

// ─── Risk classification ──────────────────────────────────────────────────────

describe("Risk classification", () => {
  it("finance and compliance profiles involving external submissions are medium or high risk", () => {
    const sensitiveRoles = ["payroll_officer", "accounts_officer", "financial_reporting_officer",
      "incident_review_officer", "restrictive_practice_officer"];
    for (const role of sensitiveRoles) {
      const profiles = getWorkerProfilesForRole(role);
      for (const p of profiles) {
        expect(["medium", "high", "critical"]).toContain(p.riskLevel);
      }
    }
  });

  it("orchestration-only profiles (Chief of Staff) are low risk", () => {
    const p = getWorkerProfileByCode("chief_of_staff_profile");
    expect(p?.riskLevel).toBe("low");
  });

  it("no profiles are classified as critical risk (critical reserved for future enforcement layer)", () => {
    const critical = WORKER_PROFILES.filter(p => p.riskLevel === "critical");
    expect(critical).toHaveLength(0);
  });
});
