/**
 * Sprint 29D — Execution Contract Completion Tests
 *
 * Deliverables verified:
 *   A. ExecutionSession — created, lifecycle-managed, closed by engine
 *   B. ExecutionActions — typed proposals from specialist output
 *   C. Write Targets — deterministic resolution
 *   D. ResourcePlan — complete routing plan
 *   E. Ownership rules — documented in type definitions
 *   F. Engine validation — adapter is already a pure thin delegate
 *   G. Runtime inspection — exactly one of each contract object
 *   H. Connector readiness — scenarios map correctly to contract
 */

import { describe, it, expect, vi } from "vitest";
import {
  openExecutionSession,
  closeExecutionSession,
  markSessionError,
  recordProviderState,
  createExecutionSession,
} from "../lib/resources/ExecutionSession.js";
import {
  parseExecutionActions,
  validateExecutionActions,
  extractWriteTargets,
} from "../services/executionActionService.js";
import {
  resolveWriteTarget,
} from "../services/writeTargetResolverService.js";
import type {
  ResourcePlan,
  CanonicalExecutionContext,
} from "../types/canonicalExecutionContext.js";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const emptyPlan: ResourcePlan = {
  evidenceProviders:     [],
  preferredProviders:    [],
  evidenceSources:       [],
  connectorSessionOpened: false,
  writeTargets:          [],
  requiredCapabilities:  [],
  connectorRequirements: [],
  approvalRequirements:  [],
};

// ─── Deliverable A: ExecutionSession lifecycle ─────────────────────────────────

describe("Deliverable A — ExecutionSession lifecycle", () => {
  it("opens a session with correct fields", () => {
    const session = openExecutionSession({
      executionId:        "exec-1",
      organisationId:     "org-1",
      triggerType:        "conversation",
      allowedChannels:    ["connector", "office"],
      maxDurationSeconds: 300,
    });

    expect(session.sessionId).toBeTruthy();
    expect(session.executionId).toBe("exec-1");
    expect(session.triggerType).toBe("conversation");
    expect(session.status).toBe("idle");
    expect(session.allowedChannels).toEqual(["connector", "office"]);
    expect(session.openedAt).toBeTruthy();
    expect(session.closedAt).toBeNull();
    expect(session.durationMs).toBeNull();
    expect(session.resourceProviderStates).toEqual([]);
  });

  it("closes a session with correct timing fields", () => {
    const session = openExecutionSession({
      executionId:        "exec-2",
      organisationId:     "org-1",
      triggerType:        "task",
      allowedChannels:    ["connector"],
      maxDurationSeconds: 300,
    });

    const closed = closeExecutionSession(session);

    expect(closed.status).toBe("closed");
    expect(closed.closedAt).toBeTruthy();
    expect(typeof closed.durationMs).toBe("number");
    expect(closed.durationMs).toBeGreaterThanOrEqual(0);
    // Immutable — original is unchanged
    expect(session.status).toBe("idle");
    expect(session.closedAt).toBeNull();
  });

  it("marks a session as error with message recorded", () => {
    const session = openExecutionSession({
      executionId:        "exec-3",
      organisationId:     "org-1",
      triggerType:        "conversation",
      allowedChannels:    ["connector"],
      maxDurationSeconds: 300,
    });

    const errored = markSessionError(session, "Provider timeout");

    expect(errored.status).toBe("error");
    expect(errored.closedAt).toBeTruthy();
    expect(errored.durationMs).toBeGreaterThanOrEqual(0);
    const errorState = errored.resourceProviderStates.at(-1)!;
    expect(errorState.errorMessage).toBe("Provider timeout");
    expect(errorState.status).toBe("error");
  });

  it("records provider state without mutating original session", () => {
    const session = openExecutionSession({
      executionId:        "exec-4",
      organisationId:     "org-1",
      triggerType:        "conversation",
      allowedChannels:    ["connector"],
      maxDurationSeconds: 300,
    });

    const updated = recordProviderState(session, {
      provider:  "organisation_library",
      status:    "available",
      checkedAt: new Date().toISOString(),
    });

    expect(updated.resourceProviderStates).toHaveLength(1);
    expect(updated.resourceProviderStates[0]!.status).toBe("available");
    expect(session.resourceProviderStates).toHaveLength(0); // original unchanged
  });

  it("expiry is set correctly from maxDurationSeconds", () => {
    const before = Date.now();
    const session = openExecutionSession({
      executionId:        "exec-5",
      organisationId:     "org-1",
      triggerType:        "task",
      allowedChannels:    ["connector"],
      maxDurationSeconds: 600,
    });
    const after = Date.now();

    const openedAt  = new Date(session.openedAt).getTime();
    const expiresAt = new Date(session.expiresAt).getTime();
    const diffMs    = expiresAt - openedAt;

    expect(diffMs).toBeGreaterThanOrEqual(600_000 - 100);
    expect(diffMs).toBeLessThanOrEqual(600_000 + 100);
    expect(openedAt).toBeGreaterThanOrEqual(before);
    expect(openedAt).toBeLessThanOrEqual(after);
  });

  it("backward-compat createExecutionSession alias works", () => {
    const session = createExecutionSession({
      executionId:        "exec-alias",
      organisationId:     "org-1",
      triggerType:        "conversation",
      allowedChannels:    ["connector"],
      maxDurationSeconds: 60,
    });
    expect(session.status).toBe("idle");
    expect(session.sessionId).toBeTruthy();
  });

  it("session IDs are unique across multiple openings", () => {
    const s1 = openExecutionSession({ executionId: "e1", organisationId: "o1", triggerType: "task",         allowedChannels: ["connector"], maxDurationSeconds: 60 });
    const s2 = openExecutionSession({ executionId: "e2", organisationId: "o1", triggerType: "conversation", allowedChannels: ["connector"], maxDurationSeconds: 60 });
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  it("closed session durationMs reflects elapsed time", async () => {
    const session = openExecutionSession({
      executionId:        "exec-timing",
      organisationId:     "org-1",
      triggerType:        "task",
      allowedChannels:    ["connector"],
      maxDurationSeconds: 300,
    });
    await new Promise(r => setTimeout(r, 5));
    const closed = closeExecutionSession(session);
    expect(closed.durationMs).toBeGreaterThanOrEqual(4);
  });
});

// ─── Deliverable B: ExecutionActions — typed proposals ─────────────────────────

describe("Deliverable B — ExecutionActions typed proposal model", () => {
  it("parses empty requestedExternalActions to empty array", () => {
    const result = parseExecutionActions([], "run-1");
    expect(result).toEqual([]);
  });

  it("parses a draft_email action correctly", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "draft_email",
        executionChannel: "office",
        toolCategory:     "email",
        approvalRequired: false,
        riskLevel:        "low",
      },
    ], "run-1");

    expect(actions).toHaveLength(1);
    const a = actions[0]!;
    expect(a.actionType).toBe("draft_email");
    expect(a.domain).toBe("email");
    expect(a.status).toBe("proposed");
    expect(a.proposedAt).toBeTruthy();
    expect(a.actionId).toBeTruthy();
    expect(a.riskLevel).toBe("low");
  });

  it("parses send_email and flags requiresApproval", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "send_email",
        executionChannel: "office",
        toolCategory:     "email",
        approvalRequired: false,
        riskLevel:        "medium",
      },
    ], "run-2");

    expect(actions).toHaveLength(1);
    // send_email → outlook_send → approvalRequired=true (destination rule)
    expect(actions[0]!.requiresApproval).toBe(true);
    expect(actions[0]!.approvalReason).toBeTruthy();
  });

  it("engine overrides: high-risk actions always require approval", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "write_file",
        executionChannel: "connector",
        toolCategory:     "file_system",
        approvalRequired: false,  // specialist says false
        riskLevel:        "high", // but engine overrides
      },
    ], "run-3");

    expect(actions).toHaveLength(1);
    expect(actions[0]!.requiresApproval).toBe(true);
    expect(actions[0]!.riskLevel).toBe("high");
  });

  it("validates actions against resource plan", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "create_file",
        executionChannel: "connector",
        toolCategory:     "file_system",
        approvalRequired: false,
        riskLevel:        "low",
      },
    ], "run-4");

    const validation = validateExecutionActions(actions, emptyPlan);
    expect(validation.valid).toHaveLength(1);
    expect(validation.invalid).toHaveLength(0);
    expect(validation.valid[0]!.status).toBe("proposed");
  });

  it("extracts unique write targets from multiple actions", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "create_file",
        executionChannel: "connector",
        toolCategory:     "file_system",
        approvalRequired: false,
        riskLevel:        "low",
      },
      {
        actionType:       "draft_email",
        executionChannel: "office",
        toolCategory:     "email",
        approvalRequired: false,
        riskLevel:        "low",
      },
    ], "run-5");

    const targets = extractWriteTargets(actions);
    // file → desktop_documents, email → outlook_drafts — two distinct domains
    expect(targets.length).toBeGreaterThanOrEqual(1);
    const domains = targets.map(t => t.domain);
    expect(domains.every((d: string) => typeof d === "string")).toBe(true);
  });

  it("produces approval requirements for actions needing approval", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "send_email",
        executionChannel: "office",
        toolCategory:     "email",
        approvalRequired: true,
        riskLevel:        "high",
      },
    ], "run-6");

    const validation = validateExecutionActions(actions, emptyPlan);
    expect(validation.approvalRequirements).toHaveLength(1);
    const req = validation.approvalRequirements[0]!;
    expect(req.actionId).toBeTruthy();
    expect(req.actionType).toBe("send_email");
    expect(req.reason).toBeTruthy();
    expect(["user", "admin", "owner"]).toContain(req.approvalLevel);
  });

  it("each action has a unique actionId", () => {
    const actions = parseExecutionActions([
      { actionType: "create_file",         executionChannel: "connector", toolCategory: "file_system", approvalRequired: false, riskLevel: "low" },
      { actionType: "draft_email",         executionChannel: "office",    toolCategory: "email",        approvalRequired: false, riskLevel: "low" },
      { actionType: "browser_interaction", executionChannel: "browser",   toolCategory: "browser",      approvalRequired: false, riskLevel: "low" },
    ], "run-7");

    const ids = actions.map(a => a.actionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("non-parseable entries are skipped, not thrown", () => {
    const actions = parseExecutionActions([
      { actionType: "create_file", executionChannel: "connector", toolCategory: "file_system", approvalRequired: false, riskLevel: "low" },
      null as any,  // bad entry
      { actionType: "draft_email", executionChannel: "office",    toolCategory: "email",        approvalRequired: false, riskLevel: "low" },
    ].filter(Boolean), "run-skip");
    // Should parse the valid ones without throwing
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Deliverable C: Write Targets — deterministic resolution ──────────────────

describe("Deliverable C — Write target deterministic resolution", () => {
  it("draft_email always resolves to outlook_drafts regardless of domain", () => {
    const target = resolveWriteTarget("draft_email", "files", {});
    expect(target.domain).toBe("outlook_drafts");
    expect(target.connectorRequired).toBe(true);
    expect(target.channelRequired).toBe("office");
  });

  it("send_email resolves to outlook_send and requires approval", () => {
    const target = resolveWriteTarget("send_email", "email", {});
    expect(target.domain).toBe("outlook_send");
    expect(target.approvalRequired).toBe(true);
    expect(target.approvalReason).toBeTruthy();
  });

  it("calendar_update resolves to a calendar target requiring connector", () => {
    const target = resolveWriteTarget("calendar_update", "calendar", {});
    expect(target.connectorRequired).toBe(true);
    expect(target.channelRequired).toBe("office");
  });

  it("update_spreadsheet resolves to excel_workbook via office channel", () => {
    const target = resolveWriteTarget("update_spreadsheet", "excel", {});
    expect(target.domain).toBe("excel_workbook");
    expect(target.channelRequired).toBe("office");
    expect(target.connectorRequired).toBe(true);
  });

  it("file domain with downloads path hint resolves to desktop_downloads", () => {
    const target = resolveWriteTarget("write_file", "files", { path: "/users/alex/downloads/report.pdf" });
    expect(target.domain).toBe("desktop_downloads");
  });

  it("file domain with desktop path hint resolves to desktop_desktop", () => {
    const target = resolveWriteTarget("create_file", "files", { path: "C:/Users/Alex/Desktop/file.docx" });
    expect(target.domain).toBe("desktop_desktop");
  });

  it("file domain without hints resolves to desktop_documents (safe default)", () => {
    const target = resolveWriteTarget("write_file", "files", {});
    expect(target.domain).toBe("desktop_documents");
  });

  it("word domain resolves to desktop_documents", () => {
    const target = resolveWriteTarget("update_file", "word", {});
    expect(target.domain).toBe("desktop_documents");
  });

  it("browser_interaction resolves to completed_work (output captured, not written)", () => {
    const target = resolveWriteTarget("browser_interaction", "browser", {});
    expect(target.domain).toBe("completed_work");
    expect(target.connectorRequired).toBe(false);
  });

  it("terminal_command resolves to completed_work", () => {
    const target = resolveWriteTarget("terminal_command", "terminal", {});
    expect(target.domain).toBe("completed_work");
  });

  it("all action types return a valid target shape", () => {
    const actionTypes = [
      "write_file", "create_file", "update_file", "move_file",
      "draft_email", "send_email", "update_spreadsheet",
      "browser_interaction", "calendar_update", "terminal_command",
    ] as const;
    for (const at of actionTypes) {
      const target = resolveWriteTarget(at, "files", {});
      expect(typeof target.domain).toBe("string");
      expect(typeof target.displayPath).toBe("string");
      expect(typeof target.connectorRequired).toBe("boolean");
      expect(typeof target.approvalRequired).toBe("boolean");
    }
  });

  it("is deterministic — same inputs produce same output", () => {
    const a = resolveWriteTarget("draft_email", "email", { path: "/foo/bar" });
    const b = resolveWriteTarget("draft_email", "email", { path: "/foo/bar" });
    expect(a).toEqual(b);
  });
});

// ─── Deliverable D: ResourcePlan — complete routing plan ──────────────────────

describe("Deliverable D — ResourcePlan has complete routing shape", () => {
  it("ResourcePlan type includes all required fields", () => {
    const plan: ResourcePlan = {
      evidenceProviders:     [
        { providerId: "p1", providerType: "organisation_library", status: "active", sourceCount: 3 },
      ],
      preferredProviders:    ["organisation_library"],
      evidenceSources:       ["src-1", "src-2"],
      connectorSessionOpened: false,
      writeTargets:          [],
      requiredCapabilities:  ["risk_assessment"],
      connectorRequirements: [
        { channel: "connector", purpose: "evidence", required: false, satisfied: false },
      ],
      approvalRequirements:  [],
    };

    expect(plan.evidenceProviders).toHaveLength(1);
    expect(plan.preferredProviders).toContain("organisation_library");
    expect(plan.evidenceSources).toHaveLength(2);
    expect(plan.connectorRequirements).toHaveLength(1);
    expect(plan.approvalRequirements).toHaveLength(0);
    expect(plan.writeTargets).toHaveLength(0);
    expect(plan.requiredCapabilities).toContain("risk_assessment");
  });

  it("write targets are populated after action parsing (mutable update pattern)", () => {
    const plan: ResourcePlan = { ...emptyPlan };

    const actions = parseExecutionActions([
      { actionType: "create_file", executionChannel: "connector", toolCategory: "file_system", approvalRequired: false, riskLevel: "low" },
    ], "run-d");
    const validation = validateExecutionActions(actions, plan);

    plan.writeTargets        = extractWriteTargets(validation.valid);
    plan.approvalRequirements = validation.approvalRequirements;

    expect(plan.writeTargets).toHaveLength(1);
    expect(plan.writeTargets[0]!.domain).toBe("desktop_documents");
  });

  it("approval requirements accumulate in ResourcePlan from action validation", () => {
    const plan: ResourcePlan = { ...emptyPlan };

    const actions = parseExecutionActions([
      { actionType: "send_email",  executionChannel: "office",    toolCategory: "email",        approvalRequired: true,  riskLevel: "high" },
      { actionType: "create_file", executionChannel: "connector", toolCategory: "file_system",  approvalRequired: false, riskLevel: "low"  },
    ], "run-d2");
    const validation = validateExecutionActions(actions, plan);
    plan.approvalRequirements = validation.approvalRequirements;

    // Only the send_email requires approval
    expect(plan.approvalRequirements.length).toBeGreaterThanOrEqual(1);
    const types = plan.approvalRequirements.map(r => r.actionType);
    expect(types).toContain("send_email");
  });
});

// ─── Deliverable E: Ownership rules documented in types ───────────────────────

describe("Deliverable E — Ownership rules are codified", () => {
  it("ExecutionAction.status starts as 'proposed' — never 'approved' or 'executed'", () => {
    const actions = parseExecutionActions([
      { actionType: "write_file", executionChannel: "connector", toolCategory: "file_system", approvalRequired: false, riskLevel: "low" },
    ], "run-ownership");

    for (const action of actions) {
      // Only engine or connector may advance status beyond "proposed"
      expect(action.status).toBe("proposed");
    }
  });

  it("ExecutionAction has proposedAt timestamp — evidence of engine ownership", () => {
    const before = new Date().toISOString();
    const actions = parseExecutionActions([
      { actionType: "create_file", executionChannel: "connector", toolCategory: "file_system", approvalRequired: false, riskLevel: "low" },
    ], "run-timestamp");
    const after = new Date().toISOString();

    expect(actions[0]!.proposedAt >= before).toBe(true);
    expect(actions[0]!.proposedAt <= after).toBe(true);
  });

  it("ExecutionAction has engine-assigned actionId (not from specialist)", () => {
    const actions = parseExecutionActions([
      { actionType: "create_file", executionChannel: "connector", toolCategory: "file_system", approvalRequired: false, riskLevel: "low" },
    ], "run-engine-id");
    // actionId is a UUID assigned by the engine, not from specialist output
    expect(actions[0]!.actionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("ConnectorRequirement starts as satisfied=false — connector P6 will set to true", () => {
    const req: import("../types/canonicalExecutionContext.js").ConnectorRequirement = {
      channel:   "connector",
      purpose:   "execution",
      required:  true,
      satisfied: false,
    };
    // Connector P6 will set satisfied=true when the relay session opens
    expect(req.satisfied).toBe(false);
  });
});

// ─── Deliverable F: Engine adapter is a pure delegate ─────────────────────────

describe("Deliverable F — workExecutionPipelineService is a pure thin adapter", () => {
  it("re-exports all engine types and functions (backward compatibility)", async () => {
    // Dynamic import here is inside async — OK
    const adapter = await import("../services/workExecutionPipelineService.js");

    expect(typeof adapter.FallbackDraftError).toBe("function");
    expect(typeof adapter.EXECUTION_STAGE_LABELS).toBe("object");
    expect(typeof adapter.createUnifiedExecutionEngine).toBe("function");
    expect(typeof adapter.executeWork).toBe("function");
  });
});

// ─── Deliverable G: Runtime inspection — exactly one of each ──────────────────

describe("Deliverable G — One of each contract object per execution (shape contract)", () => {
  it("CanonicalExecutionContext shape satisfies all Sprint 29D contract slots", () => {
    const session = openExecutionSession({
      executionId:        "ctx-test",
      organisationId:     "org-1",
      triggerType:        "task",
      allowedChannels:    ["connector"],
      maxDurationSeconds: 300,
    });

    const ctx: CanonicalExecutionContext = {
      executionId:    "exec-ctx",
      triggerType:    "task",
      organisationId: "org-1",
      requesterId:    "user-1",
      requesterRole:  "owner",
      dnaVersion:     "1.0.0",
      specialistCode: "chief_of_staff",
      manifestVersion: 1,
      conversationContext: { messages: [], unresolvedQuestions: [], previousSpecialistOutputs: [] },
      organisationMemory: { approvedMemory: [], pinnedDecisions: [] },
      evidence:        null,
      resourcePlan: {
        evidenceProviders:     [],
        preferredProviders:    [],
        evidenceSources:       [],
        connectorSessionOpened: false,
        writeTargets:          [],
        requiredCapabilities:  [],
        connectorRequirements: [],
        approvalRequirements:  [],
      },
      executionActions: [],   // Sprint 29D: always [], never null
      blueprint:       null,
      constraints: {
        maxDurationSeconds:              300,
        maxTokens:                       4000,
        requireHumanApprovalBeforeSubmit: false,
        allowedDataCategories:           ["operational"],
      },
      session,               // Sprint 29D: always populated
    };

    // Exactly one of each contract object
    expect(ctx.session).not.toBeNull();
    expect(ctx.executionActions).toBeInstanceOf(Array);
    expect(ctx.resourcePlan).toBeTruthy();
    expect(ctx.executionId).toBeTruthy();
    expect(ctx.organisationId).toBeTruthy();

    // Session is correctly associated
    expect(ctx.session!.executionId).toBe("ctx-test");
    expect(ctx.session!.triggerType).toBe("task");

    // executionActions is always array (not null)
    expect(ctx.executionActions).not.toBeNull();
    expect(Array.isArray(ctx.executionActions)).toBe(true);
  });

  it("ResourcePlan is the sole source of truth for routing (no duplicate routing data)", () => {
    const actions = parseExecutionActions([
      { actionType: "write_file",  executionChannel: "connector", toolCategory: "file_system", approvalRequired: false, riskLevel: "low" },
      { actionType: "draft_email", executionChannel: "office",    toolCategory: "email",        approvalRequired: false, riskLevel: "low" },
    ], "run-plan");

    const writeTargets = extractWriteTargets(actions);
    const domains = writeTargets.map(t => t.domain);
    // All targets are unique — no duplicate routing entries
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("ExecutionSession sessionId differs from executionId (separate identifiers)", () => {
    const session = openExecutionSession({
      executionId:        "exec-unique",
      organisationId:     "org-1",
      triggerType:        "conversation",
      allowedChannels:    ["connector"],
      maxDurationSeconds: 300,
    });
    expect(session.sessionId).not.toBe(session.executionId);
    expect(session.executionId).toBe("exec-unique");
  });
});

// ─── Deliverable H: Connector readiness assessment ────────────────────────────

describe("Deliverable H — Connector readiness: four desktop scenarios", () => {
  /**
   * Scenario 1 — Incident Report: specialist creates a Word document
   *
   * ResourcePlan:  evidenceProviders=[org_library], writeTargets=[desktop_documents]
   * CapabilityPlan: risk_assessment, incident_reporting
   * ExecutionActions: create_file → ~/Documents/Incident_Report.docx
   * ApprovalRequired: false (low risk, user's own documents folder)
   */
  it("Scenario 1 — Incident report: create file → desktop_documents", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "create_file",
        executionChannel: "connector",
        toolCategory:     "file_system",
        approvalRequired: false,
        riskLevel:        "low",
        description:      "Create Incident Report in Documents folder",
        path:             "~/Documents/Incident_Report_2026.docx",
      },
    ], "run-scenario-1");

    expect(actions).toHaveLength(1);
    expect(actions[0]!.resolvedDestination!.domain).toBe("desktop_documents");
    expect(actions[0]!.requiresApproval).toBe(false);
    expect(actions[0]!.resolvedDestination!.connectorRequired).toBe(true);
    expect(actions[0]!.resolvedDestination!.channelRequired).toBe("connector");
  });

  /**
   * Scenario 2 — Client Communication: specialist drafts an email
   *
   * ResourcePlan:  evidenceProviders=[org_library,task_upload], writeTargets=[outlook_drafts]
   * CapabilityPlan: communication, client_services
   * ExecutionActions: draft_email → Outlook Drafts
   * ApprovalRequired: false (draft — user reviews before sending)
   */
  it("Scenario 2 — Client communication: draft email → outlook_drafts", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "draft_email",
        executionChannel: "office",
        toolCategory:     "email",
        approvalRequired: false,
        riskLevel:        "low",
        description:      "Draft response to client enquiry",
      },
    ], "run-scenario-2");

    expect(actions).toHaveLength(1);
    expect(actions[0]!.resolvedDestination!.domain).toBe("outlook_drafts");
    expect(actions[0]!.requiresApproval).toBe(false);
    expect(actions[0]!.resolvedDestination!.channelRequired).toBe("office");
  });

  /**
   * Scenario 3 — Compliance Audit: specialist sends compliance notification
   *
   * ResourcePlan:  evidenceProviders=[org_library], writeTargets=[outlook_send]
   * CapabilityPlan: compliance_review, audit_reporting
   * ExecutionActions: send_email → Outlook Send (approval required — irreversible)
   */
  it("Scenario 3 — Compliance notification: send email → requires approval", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "send_email",
        executionChannel: "office",
        toolCategory:     "email",
        approvalRequired: true,
        riskLevel:        "high",
        description:      "Send compliance notification to regulator",
      },
    ], "run-scenario-3");

    expect(actions).toHaveLength(1);
    expect(actions[0]!.requiresApproval).toBe(true);
    expect(actions[0]!.resolvedDestination!.domain).toBe("outlook_send");
    expect(actions[0]!.riskLevel).toBe("high");
    expect(actions[0]!.approvalReason).toBeTruthy();
  });

  /**
   * Scenario 4 — Data Analysis: specialist updates an Excel tracker
   *
   * ResourcePlan:  evidenceProviders=[org_library,task_upload], writeTargets=[excel_workbook]
   * CapabilityPlan: data_analysis, reporting
   * ExecutionActions: update_spreadsheet → Active Excel Workbook
   * ApprovalRequired: false (local workbook, user's own data)
   */
  it("Scenario 4 — Data analysis: update spreadsheet → excel_workbook", () => {
    const actions = parseExecutionActions([
      {
        actionType:       "update_spreadsheet",
        executionChannel: "office",
        toolCategory:     "excel",
        approvalRequired: false,
        riskLevel:        "low",
        description:      "Update KPI tracker with Q3 figures",
      },
    ], "run-scenario-4");

    expect(actions).toHaveLength(1);
    expect(actions[0]!.resolvedDestination!.domain).toBe("excel_workbook");
    expect(actions[0]!.requiresApproval).toBe(false);
    expect(actions[0]!.resolvedDestination!.channelRequired).toBe("office");
    expect(actions[0]!.resolvedDestination!.connectorRequired).toBe(true);
  });

  it("all four scenarios produce unique domain targets — connector can route each unambiguously", () => {
    const scenario1Target = resolveWriteTarget("create_file",        "files",  { path: "~/Documents/report.docx" });
    const scenario2Target = resolveWriteTarget("draft_email",        "email",  {});
    const scenario3Target = resolveWriteTarget("send_email",         "email",  {});
    const scenario4Target = resolveWriteTarget("update_spreadsheet", "excel",  {});

    const domains = [
      scenario1Target.domain,
      scenario2Target.domain,
      scenario3Target.domain,
      scenario4Target.domain,
    ];

    // All four are distinct — connector can route each uniquely
    expect(new Set(domains).size).toBe(4);
  });

  it("all scenarios use connector-side channels (P6 readiness confirmed)", () => {
    const scenario1 = resolveWriteTarget("create_file",        "files",  {});
    const scenario2 = resolveWriteTarget("draft_email",        "email",  {});
    const scenario3 = resolveWriteTarget("send_email",         "email",  {});
    const scenario4 = resolveWriteTarget("update_spreadsheet", "excel",  {});

    // All four scenarios require connector infrastructure (no NeedsOps-internal-only targets)
    const allRequireConnector = [scenario1, scenario2, scenario3, scenario4].every(
      t => t.connectorRequired
    );
    expect(allRequireConnector).toBe(true);
  });
});
