/**
 * Sprint 33R - Marketing & Communications Manager v2
 *
 * Proves Marketing owns brand, audience, content, campaign and communications
 * reasoning without becoming policy, compliance, service, HR, incident,
 * finance, legal/regulatory or unconstrained external-publication authority.
 */

import { describe, expect, it, vi } from "vitest";
import type { ExecutionPackage } from "@workspace/agent-runtime";

vi.mock("../services/specialistCatalogueService.js", () => ({
  listCatalogue: vi.fn(async () => ({ entries: [] })),
}));

vi.mock("../services/entitlementService.js", () => ({
  tenantCanUseSpecialist: vi.fn(async () => ({ allowed: true })),
  tenantHasWorkforcePack: vi.fn(async () => ({ allowed: true, source: "plan" })),
  tenantCanUseFeature: vi.fn(async () => true),
  checkUsage: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn(async () => undefined),
}));

import {
  MARKETING_COMMUNICATIONS_MANAGER_DNA,
  getCanonicalDNAProfile,
  getDNAProfile,
} from "@workspace/workforce-dna";
import { getSpecialistByCode } from "../lib/workforceRegistry.js";
import { getCapability } from "../lib/capabilityRegistry.js";
import {
  getWorkerProfileByCode,
  getWorkerProfilesForRole,
} from "../lib/workerProfileRegistry.js";
import {
  hasActiveIntelligence,
  validateSpecialistEligibilitySync,
} from "../services/specialistEligibilityService.js";
import {
  getConversationWorkforceContext,
  _clearWorkforceCache,
} from "../services/conversationWorkforceContextService.js";
import { getRegistryEntry } from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import { evaluateWorkerProfileAuthority } from "../services/executionActionService.js";
import {
  buildWorkerProfileExecutionConstraints,
  validateOpenClawExecutionPackageAuthority,
} from "../services/executionService.js";

const ORG_ID = "org-sprint33r";
const profile = getWorkerProfileByCode("marketing_communications_manager_profile")!;

type ClaimClass = "VERIFIED_FACT" | "SUPPORTED_CLAIM" | "POSITIONING_STATEMENT" | "ASPIRATIONAL_LANGUAGE" | "OPINION" | "UNVERIFIED_CLAIM" | "PROHIBITED_RISKY_CLAIM";
type MarketingMetricConclusion = "AWARENESS_SIGNAL" | "CONVERSION_SIGNAL" | "CAUSATION_UNPROVEN";

function classifyClaim(input: { claim: string; evidence?: boolean; prohibited?: boolean; positioning?: boolean }): ClaimClass {
  if (input.prohibited) return "PROHIBITED_RISKY_CLAIM";
  if (input.evidence) return "SUPPORTED_CLAIM";
  if (input.positioning) return "POSITIONING_STATEMENT";
  return "UNVERIFIED_CLAIM";
}

function currentTruth(source: "verified_current" | "historical" | "memory" | "user_assertion"): boolean {
  return source === "verified_current";
}

function canUseIdentifiableStory(input: { consentVerified: boolean; authorityVerified: boolean; scopeMatches: boolean }): boolean {
  return input.consentVerified && input.authorityVerified && input.scopeMatches;
}

function inferMetricMeaning(input: { reach?: boolean; engagement?: boolean; conversion?: boolean; controlledExperiment?: boolean }): MarketingMetricConclusion {
  if (input.controlledExperiment && input.conversion) return "CONVERSION_SIGNAL";
  if (input.engagement || input.reach) return "AWARENESS_SIGNAL";
  return "CAUSATION_UNPROVEN";
}

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(profile);
  return {
    executionId: "exec-33r",
    taskId: "task-33r",
    tenantId: ORG_ID,
    workforceRole: "marketing_communications_manager",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "marketing_communications_manager",
      displayName: "Marketing & Communications Manager",
      domain: "marketing and communications",
      dnaProfileId: "marketing_communications_manager",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:mcm-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "marketing_communications_manager",
    } as ExecutionPackage["specialistManifest"],
    runtimeInstructions: {
      instruction: "Execute marketing and communications assessment only.",
      instructionHash: "sha256:mcm-instruction",
      manifestHash: "sha256:mcm-manifest",
      dnaVersion: "1.0.0",
      specialistId: "marketing_communications_manager",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "marketing_communications_manager",
      action: "execute",
      description: "Assess marketing, campaign or communications evidence",
      requiresApproval: false,
    }],
    requestedTools: [...profile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...profile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "brand_materials", "campaign_data", "approved_service_information", "analytics"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33R current-v2 activation", () => {
  it("activates Marketing & Communications as a complete current-v2 role", () => {
    const specialist = getSpecialistByCode("marketing_communications_manager");

    expect(specialist).toMatchObject({
      code: "marketing_communications_manager",
      executionStatus: "available",
      dnaStatus: "approved",
      catalogueVersion: "2",
      workerProfileCodes: ["marketing_communications_manager_profile"],
    });
    expect(hasActiveIntelligence("marketing_communications_manager")).toBe(true);
  });

  it("resolves canonical DNA and WorkerProfile", () => {
    const legacy = getDNAProfile("marketing_communications_manager");
    const canonical = getCanonicalDNAProfile("marketing_communications_manager");
    const profiles = getWorkerProfilesForRole("marketing_communications_manager");

    expect(legacy).toBe(MARKETING_COMMUNICATIONS_MANAGER_DNA);
    expect(canonical!.identity.specialistId).toBe("marketing_communications_manager");
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("marketing_communications_manager_profile");
    expect(profiles.map(p => p.code)).toEqual(["marketing_communications_manager_profile"]);
  });

  it("is runtime-ready and conversation-context eligible", async () => {
    _clearWorkforceCache();
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const marketing = ctx.specialists.find(s => s.code === "marketing_communications_manager");

    expect(marketing).toBeDefined();
    expect(marketing!.availableForConversation).toBe(true);
    expect(marketing!.availableForDispatch).toBe(true);
    expect(validateSpecialistEligibilitySync("marketing_communications_manager", "marketing.strategy")).toBe(true);
  });

  it("owns marketing and communications capabilities", () => {
    for (const code of [
      "marketing.strategy",
      "marketing.campaign",
      "marketing.content_strategy",
      "marketing.content_calendar",
      "marketing.audience_analysis",
      "marketing.brand",
      "marketing.messaging",
      "marketing.social_media",
      "marketing.website_content",
      "marketing.email_campaign",
      "marketing.stakeholder_communication",
      "marketing.referral_campaign",
      "marketing.event_promotion",
      "marketing.performance_review",
      "communications.plan",
      "communications.external",
      "communications.internal",
      "communications.crisis",
      "communications.media",
      "marketing.campaign_planning",
      "marketing.brand_management",
      "reporting.marketing",
    ]) {
      const cap = getCapability(code);
      expect(cap?.eligibleRoles).toContain("marketing_communications_manager");
      expect(cap?.requiredWorkerProfiles).toContain("marketing_communications_manager_profile");
      expect(validateSpecialistEligibilitySync("marketing_communications_manager", code)).toBe(true);
    }
  });

  it("routes marketing Blueprint intents to Marketing without turning social.post into a work product", () => {
    const blueprint = getRegistryEntry("marketing_communications_review");

    expect(blueprint?.futureOwnerRoleCode).toBe("marketing_communications_manager");
    expect(resolveIntent("marketing.campaign")?.code).toBe("marketing_communications_review");
    expect(resolveIntent("marketing.website_content")?.code).toBe("marketing_communications_review");
    expect(resolveIntent("communications.crisis")?.code).toBe("marketing_communications_review");
    expect(resolveIntent("social.post")?.isAction).toBe(true);
  });

  it("does not own policy, compliance, service, HR or financial truth", () => {
    expect(validateSpecialistEligibilitySync("marketing_communications_manager", "policy.review")).toBe(false);
    expect(validateSpecialistEligibilitySync("marketing_communications_manager", "quality.practice_standard_review")).toBe(false);
    expect(validateSpecialistEligibilitySync("marketing_communications_manager", "people.performance_review")).toBe(false);
    expect(validateSpecialistEligibilitySync("marketing_communications_manager", "finance.financial_reporting")).toBe(false);
    expect(validateSpecialistEligibilitySync("marketing_communications_manager", "financial_planning.forecast")).toBe(false);
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.conflictPolicy.defersTo).toEqual(expect.arrayContaining([
      "policy_governance_specialist",
      "compliance_quality_manager",
      "service_delivery_coordinator",
      "people_culture_manager",
      "finance_officer",
      "financial_planning_reporting_manager",
    ]));
  });

  it("requires proof for public claims and rejects unsupported accreditation claims", () => {
    expect(classifyClaim({ claim: "We are accredited and industry-leading" })).toBe("UNVERIFIED_CLAIM");
    expect(classifyClaim({ claim: "We are NDIS registered", evidence: true })).toBe("SUPPORTED_CLAIM");
    expect(profile.prohibitedActions).toContain("invent_accreditation_or_award");
  });

  it("encodes a substantive brand model beyond colours and logos", () => {
    const text = [
      MARKETING_COMMUNICATIONS_MANAGER_DNA.competencies.map(c => c.description).join(" "),
      MARKETING_COMMUNICATIONS_MANAGER_DNA.decisionFramework.priorities.join(" "),
    ].join(" ");

    expect(text).toContain("positioning");
    expect(text).toContain("proof");
    expect(text).toContain("brand consistency");
    expect(text).toContain("claim");
  });

  it("encodes audience strategy and does not assume one message fits all", () => {
    const audience = MARKETING_COMMUNICATIONS_MANAGER_DNA.competencies.find(c => c.code === "mcm.audience_strategy");

    expect(audience?.description).toContain("decision-maker");
    expect(audience?.description).toContain("family/carer");
    expect(audience?.description).toContain("stakeholder");
  });

  it("requires content strategy elements before content volume", () => {
    const schema = MARKETING_COMMUNICATIONS_MANAGER_DNA.outputSchema.requiredKeys;

    expect(schema).toEqual(expect.arrayContaining(["objective", "audience", "verifiedMessage", "channel", "cta", "measurementPlan"]));
  });

  it("uses campaign reasoning rather than treating social posting as strategy", () => {
    const steps = MARKETING_COMMUNICATIONS_MANAGER_DNA.reasoningMethodology.steps.map(s => s.stepId);

    expect(steps).toEqual([
      "mcm.scope",
      "mcm.verify_truth",
      "mcm.claim_review",
      "mcm.audience",
      "mcm.message",
      "mcm.channel",
      "mcm.privacy",
      "mcm.measure",
      "mcm.boundary",
      "mcm.validate",
    ]);
  });

  it("supports respectful disability-sector communication without unsupported NDIS claims", () => {
    const text = [
      MARKETING_COMMUNICATIONS_MANAGER_DNA.competencies.find(c => c.code === "mcm.ndis_communication")?.description,
      MARKETING_COMMUNICATIONS_MANAGER_DNA.evidenceStandards.standards.map(s => s.requirements.join(" ")).join(" "),
    ].join(" ");

    expect(text).toContain("respectful");
    expect(text).toContain("NDIS");
    expect(text).toContain("official or professional-owner evidence");
  });

  it("includes privacy, consent and accessibility as first-class professional checks", () => {
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.competencies.some(c => c.code === "mcm.privacy_consent")).toBe(true);
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.competencies.some(c => c.code === "mcm.accessibility")).toBe(true);
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.outputSchema.requiredKeys).toEqual(expect.arrayContaining(["privacyConsentCheck", "accessibilityCheck"]));
  });

  it("prohibits invented statistics and testimonials", () => {
    expect(classifyClaim({ claim: "98% success rate", prohibited: true })).toBe("PROHIBITED_RISKY_CLAIM");
    expect(classifyClaim({ claim: "A fabricated testimonial", prohibited: true })).toBe("PROHIBITED_RISKY_CLAIM");
    expect(profile.prohibitedActions).toContain("invent_marketing_statistic");
    expect(profile.prohibitedActions).toContain("publish_false_testimonial");
  });

  it("does not treat old service information, old price or memory as current truth", () => {
    expect(currentTruth("historical")).toBe(false);
    expect(currentTruth("memory")).toBe(false);
    expect(currentTruth("user_assertion")).toBe(false);
    expect(currentTruth("verified_current")).toBe(true);
  });

  it("requires consent and authority for participant-identifying content", () => {
    expect(canUseIdentifiableStory({ consentVerified: false, authorityVerified: true, scopeMatches: true })).toBe(false);
    expect(canUseIdentifiableStory({ consentVerified: true, authorityVerified: false, scopeMatches: true })).toBe(false);
    expect(canUseIdentifiableStory({ consentVerified: true, authorityVerified: true, scopeMatches: false })).toBe(false);
    expect(canUseIdentifiableStory({ consentVerified: true, authorityVerified: true, scopeMatches: true })).toBe(true);
    expect(profile.prohibitedActions).toContain("publish_participant_identifying_content_without_consent");
  });

  it("gates serious incident, crisis and regulatory communications", () => {
    for (const actionIdentifier of ["publish_crisis_statement", "publish_media_release", "publish_material_public_claim"]) {
      const decision = evaluateWorkerProfileAuthority({
        workerProfile: profile,
        specialistCode: "marketing_communications_manager",
        actionIdentifier,
        actionType: "create_file",
        executionChannel: "document_store",
        toolCategory: "document_tools",
        connectorCategory: "document_management",
      });

      expect(decision.decision).toBe("APPROVAL_REQUIRED");
    }
  });

  it("keeps serious incident facts with ISS and escalates crisis communication", () => {
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.conflictPolicy.defersTo).toContain("incident_safeguarding_specialist");
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.riskTolerance.autoEscalateWhen.join(" ")).toContain("serious incident");
    expect(validateSpecialistEligibilitySync("marketing_communications_manager", "incident.review")).toBe(false);
  });

  it("keeps internal HR meaning with P&C when professional HR content matters", () => {
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.professionalBoundaries.outOfScope.join(" ")).toContain("employment");
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.conflictPolicy.defersTo).toContain("people_culture_manager");
  });

  it("cannot expose unverified allegations or incident/safeguarding information", () => {
    const decision = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "marketing_communications_manager",
      actionIdentifier: "disclose_incident_or_safeguarding_information",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("does not confuse engagement, conversion, correlation or causation", () => {
    expect(inferMetricMeaning({ reach: true })).toBe("AWARENESS_SIGNAL");
    expect(inferMetricMeaning({ engagement: true })).toBe("AWARENESS_SIGNAL");
    expect(inferMetricMeaning({ conversion: true })).toBe("CAUSATION_UNPROVEN");
    expect(inferMetricMeaning({ conversion: true, controlledExperiment: true })).toBe("CONVERSION_SIGNAL");
  });

  it("A/B testing preserves claim-safety constraints", () => {
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.competencies.some(c => c.code === "mcm.experimentation")).toBe(true);
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.escalationFramework.hardStops.join(" ")).toContain("invent");
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.evidenceStandards.insufficiencyIndicators.join(" ")).toContain("analytics");
  });

  it("surfaces missing evidence instead of inventing proof", () => {
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.evidenceStandards.allowInventedReferences).toBe(false);
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.escalationFramework.defaultPath).toContain("evidence gaps");
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.outputSchema.validationRules.join(" ")).toContain("invented statistics");
  });

  it("keeps financial and commercial truth with Finance and FP&R", () => {
    expect(MARKETING_COMMUNICATIONS_MANAGER_DNA.conflictPolicy.defersTo).toEqual(expect.arrayContaining([
      "finance_officer",
      "financial_planning_reporting_manager",
    ]));
    expect(profile.prohibitedActions).toContain("make_financial_claim_without_verified_evidence");
  });

  it("public posting, website publication, mass email and paid launch require approval", () => {
    for (const [actionIdentifier, actionType, executionChannel, toolCategory, connectorCategory] of [
      ["post_to_social_media", "create_file", "document_store", "communication_tools", "document_management"],
      ["publish_website_content", "create_file", "document_store", "document_tools", "document_management"],
      ["send_mass_email_or_newsletter", "send_email", "email_system", "communication_tools", "email_system"],
      ["launch_paid_campaign", "create_file", "document_store", "communication_tools", "document_management"],
    ] as const) {
      const decision = evaluateWorkerProfileAuthority({
        workerProfile: profile,
        specialistCode: "marketing_communications_manager",
        actionIdentifier,
        actionType,
        executionChannel,
        toolCategory,
        connectorCategory,
      });

      expect(decision.decision).toBe("APPROVAL_REQUIRED");
    }
  });

  it("approval cannot override false or prohibited content", () => {
    for (const actionIdentifier of [
      "publish_unverified_professional_claim",
      "publish_false_testimonial",
      "invent_marketing_statistic",
      "invent_regulatory_approval",
      "publish_deceptive_marketing",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        workerProfile: profile,
        specialistCode: "marketing_communications_manager",
        actionIdentifier,
        actionType: "create_file",
        executionChannel: "document_store",
        toolCategory: "document_tools",
        connectorCategory: "document_management",
        approvalGranted: true,
      });

      expect(decision.decision).toBe("PROHIBITED");
    }
  });

  it("is publication eligible through static prerequisites", () => {
    const specialist = getSpecialistByCode("marketing_communications_manager");
    const dna = getDNAProfile("marketing_communications_manager");
    const workerProfiles = getWorkerProfilesForRole("marketing_communications_manager");

    expect(specialist?.dnaStatus).toBe("approved");
    expect(specialist?.executionStatus).toBe("available");
    expect(dna?.currentVersion.isActive).toBe(true);
    expect(workerProfiles[0]?.status).toBe("active");
    expect(hasActiveIntelligence("marketing_communications_manager")).toBe(true);
  });

  it("OpenClaw package preserves external-publication restrictions", () => {
    const valid = validateOpenClawExecutionPackageAuthority({ pkg: makePackage(), workerProfile: profile });
    const missingProhibitions = validateOpenClawExecutionPackageAuthority(
      { pkg: makePackage({
        workerProfile: {
          ...buildWorkerProfileExecutionConstraints(profile),
          prohibitedActions: [],
        },
      }), workerProfile: profile },
    );

    expect(valid.decision).toBe("PERMITTED");
    expect(missingProhibitions.decision).toBe("PROHIBITED");
    expect(missingProhibitions.reason).toContain("removed WorkerProfile prohibitions");
  });
});
