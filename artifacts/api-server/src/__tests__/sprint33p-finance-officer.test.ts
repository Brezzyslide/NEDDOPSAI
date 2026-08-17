/**
 * Sprint 33P - Finance Officer v2
 *
 * Proves Finance Officer owns operational financial record integrity,
 * reconciliation, AP/AR and transaction evidence without becoming Payroll,
 * FP&R, PAC, CQM, tax/legal/audit authority or unconstrained OpenClaw.
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
  FINANCE_OFFICER_DNA,
  PAYROLL_WORKFORCE_COST_OFFICER_DNA,
  PROCESS_ASSET_COORDINATOR_DNA,
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

const ORG_ID = "org-sprint33p";
const profile = getWorkerProfileByCode("finance_officer_profile")!;

type TransactionStatus =
  | "REQUESTED"
  | "APPROVED"
  | "INVOICED"
  | "RECORDED"
  | "SCHEDULED"
  | "PAID"
  | "RECEIVED"
  | "CLEARED"
  | "RECONCILED"
  | "REVERSED"
  | "REFUNDED"
  | "VOIDED"
  | "DISPUTED"
  | "UNVERIFIED";

type ReconciliationOutcome =
  | "MATCHED"
  | "PARTIALLY_MATCHED"
  | "UNMATCHED"
  | "DUPLICATE_SUSPECTED"
  | "AMOUNT_VARIANCE"
  | "DATE_VARIANCE"
  | "CODING_VARIANCE"
  | "MISSING_DOCUMENTATION"
  | "PAYMENT_NOT_VERIFIED"
  | "RECEIPT_NOT_ALLOCATED"
  | "REVERSED"
  | "DISPUTED"
  | "UNKNOWN";

function inferTransactionStatus(input: {
  invoiceReceived?: boolean;
  approved?: boolean;
  scheduled?: boolean;
  bankCleared?: boolean;
  bankReceipt?: boolean;
  receiptAllocated?: boolean;
  reversed?: boolean;
  refunded?: boolean;
  disputed?: boolean;
}): TransactionStatus {
  if (input.refunded) return "REFUNDED";
  if (input.reversed) return "REVERSED";
  if (input.disputed) return "DISPUTED";
  if (input.bankCleared) return "CLEARED";
  if (input.scheduled) return "SCHEDULED";
  if (input.receiptAllocated) return "RECONCILED";
  if (input.bankReceipt) return "RECEIVED";
  if (input.approved) return "APPROVED";
  if (input.invoiceReceived) return "INVOICED";
  return "UNVERIFIED";
}

function reconcile(input: {
  sourceDocument?: boolean;
  approval?: boolean;
  paymentEvidence?: boolean;
  receiptAllocated?: boolean;
  supplierOutstanding?: boolean;
  internalPaid?: boolean;
  duplicateIdentity?: boolean;
  amountVariance?: boolean;
  laterRefund?: boolean;
}): ReconciliationOutcome {
  if (input.laterRefund) return "REVERSED";
  if (input.duplicateIdentity) return "DUPLICATE_SUSPECTED";
  if (!input.sourceDocument || !input.approval) return "MISSING_DOCUMENTATION";
  if (input.internalPaid && !input.paymentEvidence) return "PAYMENT_NOT_VERIFIED";
  if (input.supplierOutstanding && input.internalPaid) return "DISPUTED";
  if (input.amountVariance) return "AMOUNT_VARIANCE";
  if (input.paymentEvidence && input.receiptAllocated) return "MATCHED";
  if (input.paymentEvidence && !input.receiptAllocated) return "RECEIPT_NOT_ALLOCATED";
  return "UNKNOWN";
}

function memoryOrAssertionProof(source: "memory" | "user_assertion" | "verified_record"): boolean {
  return source === "verified_record";
}

function anomalyClassification(input: { duplicate?: boolean; changedBankDetails?: boolean; evidenceMissing?: boolean }): "CONTROL_EXCEPTION" | "DUPLICATE_RISK" | "UNVERIFIED_TRANSACTION" {
  if (input.duplicate) return "DUPLICATE_RISK";
  if (input.changedBankDetails) return "CONTROL_EXCEPTION";
  if (input.evidenceMissing) return "UNVERIFIED_TRANSACTION";
  return "UNVERIFIED_TRANSACTION";
}

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(profile);
  return {
    executionId: "exec-33p",
    taskId: "task-33p",
    tenantId: ORG_ID,
    workforceRole: "finance_officer",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "finance_officer",
      displayName: "Finance Officer",
      domain: "operational finance and reconciliation",
      dnaProfileId: "finance_officer",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:finance-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "finance_officer",
    } as ExecutionPackage["specialistManifest"],
    runtimeInstructions: {
      instruction: "Execute operational finance assessment only.",
      instructionHash: "sha256:finance-instruction",
      manifestHash: "sha256:finance-manifest",
      dnaVersion: "1.0.0",
      specialistId: "finance_officer",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "finance_officer",
      action: "execute",
      description: "Assess financial evidence and reconciliation status",
      requiresApproval: false,
    }],
    requestedTools: [...profile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...profile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "financial_records", "invoice_records", "bank_records", "approval_records"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33P current-v2 activation", () => {
  it("activates Finance Officer as complete current-v2 role", () => {
    const specialist = getSpecialistByCode("finance_officer");

    expect(specialist).toMatchObject({
      code: "finance_officer",
      executionStatus: "available",
      dnaStatus: "approved",
      catalogueVersion: "2",
      workerProfileCodes: ["finance_officer_profile"],
    });
    expect(hasActiveIntelligence("finance_officer")).toBe(true);
  });

  it("resolves canonical DNA and WorkerProfile", () => {
    const legacy = getDNAProfile("finance_officer");
    const canonical = getCanonicalDNAProfile("finance_officer");
    const profiles = getWorkerProfilesForRole("finance_officer");

    expect(legacy).toBe(FINANCE_OFFICER_DNA);
    expect(canonical!.identity.specialistId).toBe("finance_officer");
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("finance_officer_profile");
    expect(profiles.map(p => p.code)).toEqual(["finance_officer_profile"]);
  });

  it("is runtime-ready and conversation-context eligible", async () => {
    _clearWorkforceCache();
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const finance = ctx.specialists.find(s => s.code === "finance_officer");

    expect(finance).toBeDefined();
    expect(finance!.availableForConversation).toBe(true);
    expect(finance!.availableForDispatch).toBe(true);
    expect(validateSpecialistEligibilitySync("finance_officer", "finance.bank_reconciliation")).toBe(true);
  });

  it("owns operational finance capabilities without taking payroll or FP&R capabilities", () => {
    for (const code of [
      "finance.reconciliation",
      "finance.bank_reconciliation",
      "finance.accounts_payable",
      "finance.accounts_receivable",
      "finance.invoice_review",
      "finance.payment_review",
      "finance.receipt_review",
      "finance.expense_review",
      "finance.reimbursement_review",
      "finance.transaction_review",
      "finance.duplicate_review",
      "finance.supplier_reconciliation",
      "finance.customer_reconciliation",
      "finance.credit_refund_review",
      "finance.financial_record_review",
      "finance.finance_exception_review",
      "accounting.reconciliation",
      "accounting.bas_analysis",
    ]) {
      const cap = getCapability(code);
      expect(cap?.eligibleRoles).toContain("finance_officer");
      expect(cap?.requiredWorkerProfiles).toContain("finance_officer_profile");
      expect(validateSpecialistEligibilitySync("finance_officer", code)).toBe(true);
    }

    expect(validateSpecialistEligibilitySync("finance_officer", "payroll.review")).toBe(false);
    expect(validateSpecialistEligibilitySync("finance_officer", "finance.budget_analysis")).toBe(false);
    expect(validateSpecialistEligibilitySync("finance_officer", "asset.lifecycle_review")).toBe(false);
  });

  it("routes operational finance Blueprint intents to Finance Officer-owned placeholder", () => {
    const blueprint = getRegistryEntry("operational_finance_reconciliation_review");
    const invoice = resolveIntent("finance.invoice_review");
    const bank = resolveIntent("finance.bank_reconciliation");
    const accounting = resolveIntent("accounting.reconciliation");

    expect(blueprint?.futureOwnerRoleCode).toBe("finance_officer");
    expect(invoice!.code).toBe("operational_finance_reconciliation_review");
    expect(bank!.code).toBe("operational_finance_reconciliation_review");
    expect(accounting!.code).toBe("operational_finance_reconciliation_review");
  });

  it("satisfies static DB publication prerequisites", () => {
    const specialist = getSpecialistByCode("finance_officer")!;
    const canonical = getCanonicalDNAProfile("finance_officer");

    expect(specialist.executionStatus).toBe("available");
    expect(specialist.dnaStatus).toBe("approved");
    expect(canonical).not.toBeNull();
    expect(getWorkerProfilesForRole("finance_officer")).toHaveLength(1);
  });
});

describe("Sprint 33P financial evidence reasoning", () => {
  it("keeps invoice, approval, payment and clearing statuses distinct", () => {
    expect(inferTransactionStatus({ invoiceReceived: true })).toBe("INVOICED");
    expect(inferTransactionStatus({ invoiceReceived: true, approved: true })).toBe("APPROVED");
    expect(inferTransactionStatus({ approved: true, scheduled: true })).toBe("SCHEDULED");
    expect(inferTransactionStatus({ scheduled: true, bankCleared: true })).toBe("CLEARED");
  });

  it("keeps bank receipt separate from correct customer allocation", () => {
    expect(inferTransactionStatus({ bankReceipt: true })).toBe("RECEIVED");
    expect(inferTransactionStatus({ bankReceipt: true, receiptAllocated: true })).toBe("RECONCILED");
    expect(reconcile({ sourceDocument: true, approval: true, paymentEvidence: true, receiptAllocated: false })).toBe("RECEIPT_NOT_ALLOCATED");
  });

  it("flags duplicate invoice pattern instead of assuming it is valid", () => {
    expect(reconcile({ sourceDocument: true, approval: true, duplicateIdentity: true })).toBe("DUPLICATE_SUSPECTED");
    expect(FINANCE_OFFICER_DNA.riskTolerance.riskCategories).toContain("duplicate_transaction_risk");
  });

  it("blocks definitive paid conclusion when payment evidence is missing", () => {
    expect(reconcile({ sourceDocument: true, approval: true, internalPaid: true, paymentEvidence: false })).toBe("PAYMENT_NOT_VERIFIED");
    expect(FINANCE_OFFICER_DNA.evidenceStandards.insufficiencyIndicators.join(" ")).toContain("payment");
  });

  it("treats supplier/internal evidence conflict as reconciliation required", () => {
    expect(reconcile({ sourceDocument: true, approval: true, internalPaid: true, supplierOutstanding: true, paymentEvidence: true })).toBe("DISPUTED");
    expect(FINANCE_OFFICER_DNA.decisionFramework.conflictResolution).toContain("supplier outstanding");
  });

  it("allows later refund or reversal to supersede earlier status", () => {
    expect(inferTransactionStatus({ bankCleared: true, refunded: true })).toBe("REFUNDED");
    expect(reconcile({ sourceDocument: true, approval: true, paymentEvidence: true, laterRefund: true })).toBe("REVERSED");
  });

  it("does not let memory or user assertion become financial truth", () => {
    expect(memoryOrAssertionProof("memory")).toBe(false);
    expect(memoryOrAssertionProof("user_assertion")).toBe(false);
    expect(memoryOrAssertionProof("verified_record")).toBe(true);
    expect(FINANCE_OFFICER_DNA.learningPolicy.conflictLearning).toContain("must not prove payment");
  });

  it("surfaces missing evidence rather than inventing a balancing entry", () => {
    expect(reconcile({ sourceDocument: false, approval: true, paymentEvidence: true })).toBe("MISSING_DOCUMENTATION");
    expect(FINANCE_OFFICER_DNA.escalationFramework.hardStops.join(" ")).toContain("balancing entries");
  });

  it("classifies anomaly without unsupported fraud finding", () => {
    expect(anomalyClassification({ duplicate: true })).toBe("DUPLICATE_RISK");
    expect(anomalyClassification({ changedBankDetails: true })).toBe("CONTROL_EXCEPTION");
    expect(FINANCE_OFFICER_DNA.professionalBoundaries.cannotDo.join(" ")).toContain("declare fraud solely from anomaly");
  });

  it("models AP as invoice, approval, credit and payment evidence review", () => {
    const ap = getCapability("finance.accounts_payable")!;

    expect(ap.description).toContain("supplier invoices");
    expect(ap.description).toContain("payment evidence");
    expect(FINANCE_OFFICER_DNA.competencies.some(c => c.code === "fo.accounts_payable")).toBe(true);
  });

  it("models AR as invoice, receipt, allocation and aged-debt review", () => {
    const ar = getCapability("finance.accounts_receivable")!;

    expect(ar.description).toContain("receipts");
    expect(ar.description).toContain("aged debt");
    expect(FINANCE_OFFICER_DNA.competencies.some(c => c.code === "fo.accounts_receivable")).toBe(true);
  });

  it("models expense and reimbursement review without inventing receipts or purpose", () => {
    const expense = getCapability("finance.expense_review")!;
    const reimbursement = getCapability("finance.reimbursement_review")!;

    expect(expense.description).toContain("business purpose");
    expect(reimbursement.description).toContain("claimant");
    expect(FINANCE_OFFICER_DNA.professionalBoundaries.cannotDo).toContain("fabricate invoices, receipts, approvals, remittances, bank evidence, journals or reconciliation entries");
  });
});

describe("Sprint 33P professional boundaries", () => {
  it("preserves Payroll ownership of award, SCHADS and payroll treatment", () => {
    const defers = FINANCE_OFFICER_DNA.conflictPolicy.defersTo;
    const payrollCapabilities = PAYROLL_WORKFORCE_COST_OFFICER_DNA.capabilityConfig.requiredCapabilities;

    expect(defers).toContain("payroll_workforce_cost_officer");
    expect(payrollCapabilities).toContain("payroll.schads_analysis");
    expect(profile.prohibitedActions).toContain("calculate_schads_entitlement");
  });

  it("preserves FP&R ownership of budgets, forecasts and variance interpretation", () => {
    const budget = getCapability("finance.budget_analysis")!;
    const reporting = getCapability("finance.financial_reporting")!;

    expect(budget.eligibleRoles).toEqual(["financial_planning_reporting_manager"]);
    expect(reporting.eligibleRoles).toEqual(["financial_planning_reporting_manager"]);
    expect(FINANCE_OFFICER_DNA.professionalBoundaries.cannotDo.join(" ")).toContain("budgets");
  });

  it("preserves PAC and CQM boundaries", () => {
    expect(PROCESS_ASSET_COORDINATOR_DNA.capabilityConfig.requiredCapabilities).toContain("asset.lifecycle_review");
    expect(FINANCE_OFFICER_DNA.conflictPolicy.defersTo).toContain("process_asset_coordinator");
    expect(FINANCE_OFFICER_DNA.conflictPolicy.defersTo).toContain("compliance_quality_manager");
    expect(FINANCE_OFFICER_DNA.professionalBoundaries.outOfScope.join(" ")).toContain("internal audit");
  });

  it("keeps tax, accounting, legal and audit authority outside autonomous scope", () => {
    const cannot = FINANCE_OFFICER_DNA.professionalBoundaries.cannotDo.join(" ");
    const hardStops = FINANCE_OFFICER_DNA.escalationFramework.hardStops.join(" ");

    expect(cannot).toContain("tax-agent");
    expect(cannot).toContain("statutory audit");
    expect(hardStops).toContain("legal");
  });

  it("uses minimum necessary financial evidence and protects unrelated sensitive data", () => {
    const constraints = FINANCE_OFFICER_DNA.professionalBoundaries.securityConstraints.join(" ");

    expect(constraints).toContain("minimum necessary financial evidence");
    expect(constraints).toContain("unrelated employee, participant, bank, tax or personal identifiers");
  });

  it("keeps generic cost/payment/money language from stealing Payroll or FP&R work", () => {
    expect(validateSpecialistEligibilitySync("payroll_workforce_cost_officer", "workforce_cost.review")).toBe(true);
    expect(validateSpecialistEligibilitySync("finance_officer", "workforce_cost.review")).toBe(false);
    expect(getCapability("finance.budget_analysis")!.eligibleRoles).toEqual(["financial_planning_reporting_manager"]);
    expect(validateSpecialistEligibilitySync("finance_officer", "finance.budget_analysis")).toBe(false);
  });
});

describe("Sprint 33P WorkerProfile and OpenClaw authority", () => {
  it("permits finance analysis and approval-gates financial mutation", () => {
    const analysis = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "finance_officer",
      actionIdentifier: "create_file",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
    });
    const postTransaction = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "finance_officer",
      actionIdentifier: "post_financial_transaction",
      actionType: "update_spreadsheet",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      connectorCategory: "finance_system",
    });

    expect(analysis.decision).toBe("PERMITTED");
    expect(postTransaction.decision).toBe("APPROVAL_REQUIRED");
  });

  it("cannot approve material payment or fabricate/force financial records even with approval", () => {
    for (const actionIdentifier of [
      "approve_payment_without_authority",
      "fabricate_receipt",
      "false_reconciliation",
      "force_balance_reconciliation",
      "manipulate_financial_evidence",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        workerProfile: profile,
        specialistCode: "finance_officer",
        actionIdentifier,
        actionType: "update_spreadsheet",
        executionChannel: "internal_api",
        toolCategory: "form_tools",
        connectorCategory: "finance_system",
        approvalGranted: true,
      });

      expect(decision.decision).toBe("PROHIBITED");
    }
  });

  it("OpenClaw package preserves financial authority boundaries", () => {
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
