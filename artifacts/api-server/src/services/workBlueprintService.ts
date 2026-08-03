/**
 * Work Blueprint Service — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Manages Work Blueprints: the organisational SOPs that define how specialists
 * execute professional work. Blueprints contain the full execution contract —
 * objective, required knowledge, validation rules, quality checklist,
 * escalation rules, and success criteria.
 *
 * Built-in blueprints are seeded at startup (organizationId = NULL).
 * Organisations may create custom blueprints (organizationId set).
 *
 * Blueprint selection uses keyword + category matching against the user's
 * request to find the most appropriate blueprint automatically.
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { workBlueprintsTable } from "@workspace/db";
import { eq, and, or, isNull } from "drizzle-orm";
import { logOrgEvent } from "./auditService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkBlueprint {
  id: string;
  organizationId: string | null;
  code: string;
  title: string;
  version: string;
  objective: string;
  primarySpecialist: string;
  supportingSpecialists: string[];
  requiredLibraryKnowledge: string[];
  requiredEntityKnowledge: Record<string, unknown>;
  requiredMemories: string[];
  requiredApprovals: Record<string, unknown>;
  validationRules: Array<{ rule: string; required: boolean; description: string }>;
  qualityRules: Array<{ dimension: string; weight: number; description: string }>;
  successCriteria: string[];
  outputTypes: string[];
  escalationRules: Array<{ trigger: string; action: string }>;
  mandatoryCitations: string[];
  isBuiltIn: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBlueprintInput {
  code: string;
  title: string;
  version?: string;
  objective: string;
  primarySpecialist: string;
  supportingSpecialists?: string[];
  requiredLibraryKnowledge?: string[];
  requiredEntityKnowledge?: Record<string, unknown>;
  requiredMemories?: string[];
  requiredApprovals?: Record<string, unknown>;
  validationRules?: Array<{ rule: string; required: boolean; description: string }>;
  qualityRules?: Array<{ dimension: string; weight: number; description: string }>;
  successCriteria?: string[];
  outputTypes?: string[];
  escalationRules?: Array<{ trigger: string; action: string }>;
  mandatoryCitations?: string[];
}

export interface UpdateBlueprintInput {
  title?: string;
  version?: string;
  objective?: string;
  primarySpecialist?: string;
  supportingSpecialists?: string[];
  requiredLibraryKnowledge?: string[];
  requiredEntityKnowledge?: Record<string, unknown>;
  requiredMemories?: string[];
  validationRules?: Array<{ rule: string; required: boolean; description: string }>;
  qualityRules?: Array<{ dimension: string; weight: number; description: string }>;
  successCriteria?: string[];
  outputTypes?: string[];
  escalationRules?: Array<{ trigger: string; action: string }>;
  mandatoryCitations?: string[];
  isActive?: boolean;
}

export interface BlueprintSelectionResult {
  blueprint: WorkBlueprint | null;
  confidence: number;
  matchedKeywords: string[];
  fallbackUsed: boolean;
}

// ─── Built-in blueprint definitions ──────────────────────────────────────────

const BUILT_IN_BLUEPRINTS: Omit<CreateBlueprintInput, never>[] = [
  {
    code: "incident_investigation",
    title: "Incident Investigation",
    objective: "Investigate a reported incident, document findings, identify root causes, and produce a formal investigation report with corrective action recommendations.",
    primarySpecialist: "incident_safeguarding_specialist",
    supportingSpecialists: ["compliance_quality_manager", "chief_of_staff"],
    requiredLibraryKnowledge: ["policy", "procedure", "legislation", "standards"],
    requiredMemories: ["approval_rule", "operating_preference"],
    validationRules: [
      { rule: "incident_policy_present", required: true, description: "Organisation incident management policy must be retrieved" },
      { rule: "legislation_present", required: true, description: "Relevant legislation must be identified" },
    ],
    qualityRules: [
      { dimension: "policy_compliance", weight: 25, description: "Output complies with org incident policy" },
      { dimension: "completeness", weight: 25, description: "All required sections populated" },
      { dimension: "source_coverage", weight: 20, description: "All retrieved sources cited" },
      { dimension: "writing_style", weight: 15, description: "Matches org writing style" },
      { dimension: "consistency", weight: 15, description: "Internally consistent findings" },
    ],
    successCriteria: ["Root cause identified", "Corrective actions recommended", "Compliance obligations noted"],
    outputTypes: ["investigation_report"],
    escalationRules: [{ trigger: "missing_incident_policy", action: "flag_for_human_review" }],
    mandatoryCitations: ["legislation", "policy"],
  },
  {
    code: "risk_assessment",
    title: "Risk Assessment",
    objective: "Assess risks in a defined area, score likelihood and consequence, identify controls, and produce a structured risk assessment document.",
    primarySpecialist: "compliance_quality_manager",
    supportingSpecialists: ["operations_manager"],
    requiredLibraryKnowledge: ["risk_assessment", "policy", "legislation", "standards"],
    requiredMemories: ["operating_preference"],
    validationRules: [
      { rule: "risk_policy_present", required: true, description: "Risk management policy must be available" },
      { rule: "template_present", required: false, description: "Risk assessment template is preferred" },
    ],
    qualityRules: [
      { dimension: "completeness", weight: 30, description: "All risk fields completed" },
      { dimension: "policy_compliance", weight: 30, description: "Controls align with org policy" },
      { dimension: "source_coverage", weight: 20, description: "Evidence cited for each risk rating" },
      { dimension: "writing_style", weight: 20, description: "Professional, consistent language" },
    ],
    successCriteria: ["All identified risks scored", "Controls documented", "Residual risk assessed"],
    outputTypes: ["risk_assessment"],
    escalationRules: [{ trigger: "extreme_residual_risk", action: "require_human_approval" }],
    mandatoryCitations: ["policy", "standards"],
  },
  {
    code: "behaviour_support_plan",
    title: "Behaviour Support Plan",
    objective: "Draft a Behaviour Support Plan for a participant, incorporating strategies, triggers, de-escalation techniques, and team guidance.",
    primarySpecialist: "incident_safeguarding_specialist",
    supportingSpecialists: ["compliance_quality_manager"],
    requiredLibraryKnowledge: ["behaviour_support_plan", "policy", "legislation", "care_plan"],
    requiredMemories: ["operating_preference"],
    validationRules: [
      { rule: "legislation_present", required: true, description: "Relevant NDIS/state legislation must be identified" },
      { rule: "participant_context_present", required: true, description: "Participant-specific context or task upload must be present" },
    ],
    qualityRules: [
      { dimension: "policy_compliance", weight: 30, description: "Complies with NDIS and org policy" },
      { dimension: "completeness", weight: 30, description: "All BSP sections completed" },
      { dimension: "safety", weight: 25, description: "Safety considerations addressed" },
      { dimension: "writing_style", weight: 15, description: "Professional, participant-centred language" },
    ],
    successCriteria: ["Triggers documented", "Strategies evidence-based", "Team guidance clear"],
    outputTypes: ["behaviour_support_plan"],
    escalationRules: [{ trigger: "restrictive_practice_identified", action: "require_human_review" }],
    mandatoryCitations: ["legislation", "policy"],
  },
  {
    code: "care_plan",
    title: "Care Plan",
    objective: "Draft a care plan for a participant documenting goals, support strategies, and coordination requirements.",
    primarySpecialist: "operations_manager",
    supportingSpecialists: ["compliance_quality_manager"],
    requiredLibraryKnowledge: ["care_plan", "policy", "legislation"],
    requiredMemories: ["operating_preference"],
    validationRules: [
      { rule: "participant_context_present", required: true, description: "Participant information must be provided" },
    ],
    qualityRules: [
      { dimension: "completeness", weight: 35, description: "All care plan sections populated" },
      { dimension: "policy_compliance", weight: 30, description: "Complies with org care standards" },
      { dimension: "safety", weight: 20, description: "Risk and safety considerations included" },
      { dimension: "writing_style", weight: 15, description: "Person-centred language used" },
    ],
    successCriteria: ["Goals measurable", "Strategies documented", "Review schedule set"],
    outputTypes: ["care_plan"],
    escalationRules: [],
    mandatoryCitations: ["legislation"],
  },
  {
    code: "meeting_minutes",
    title: "Meeting Minutes",
    objective: "Produce structured meeting minutes capturing attendees, agenda items, decisions, and action items.",
    primarySpecialist: "executive_assistant",
    supportingSpecialists: [],
    requiredLibraryKnowledge: ["style_guide"],
    requiredMemories: ["terminology", "operating_preference"],
    validationRules: [],
    qualityRules: [
      { dimension: "completeness", weight: 40, description: "All agenda items covered" },
      { dimension: "writing_style", weight: 30, description: "Org style guide followed" },
      { dimension: "consistency", weight: 30, description: "Action items clearly assigned" },
    ],
    successCriteria: ["All decisions recorded", "Action items have owners and due dates"],
    outputTypes: ["meeting_minutes"],
    escalationRules: [],
    mandatoryCitations: [],
  },
  {
    code: "operational_procedure",
    title: "Operational Procedure",
    objective: "Draft a step-by-step operational procedure document for a defined process.",
    primarySpecialist: "knowledge_documentation_specialist",
    supportingSpecialists: ["operations_manager"],
    requiredLibraryKnowledge: ["procedure", "policy", "standards"],
    requiredMemories: ["operating_preference", "terminology"],
    validationRules: [
      { rule: "related_policy_present", required: false, description: "Related policy document preferred" },
    ],
    qualityRules: [
      { dimension: "completeness", weight: 35, description: "All steps documented" },
      { dimension: "policy_compliance", weight: 30, description: "Steps align with relevant policy" },
      { dimension: "writing_style", weight: 20, description: "Clear, actionable language" },
      { dimension: "consistency", weight: 15, description: "Consistent formatting and numbering" },
    ],
    successCriteria: ["Steps are executable", "Roles and responsibilities clear"],
    outputTypes: ["operational_procedure"],
    escalationRules: [],
    mandatoryCitations: ["policy"],
  },
  {
    code: "policy_draft",
    title: "Policy Draft",
    objective: "Draft a formal organisational policy document including purpose, scope, principles, responsibilities, and review schedule.",
    primarySpecialist: "policy_governance_specialist",
    supportingSpecialists: ["compliance_quality_manager", "chief_of_staff"],
    requiredLibraryKnowledge: ["legislation", "standards", "policy"],
    requiredMemories: ["approval_rule", "operating_preference", "terminology"],
    validationRules: [
      { rule: "legislation_present", required: true, description: "Relevant legislation must be identified" },
    ],
    qualityRules: [
      { dimension: "policy_compliance", weight: 30, description: "Compliant with legislation and standards" },
      { dimension: "completeness", weight: 25, description: "All policy sections present" },
      { dimension: "writing_style", weight: 25, description: "Formal policy language used" },
      { dimension: "consistency", weight: 20, description: "Internally consistent obligations" },
    ],
    successCriteria: ["Legal obligations met", "Responsibilities clear", "Review schedule included"],
    outputTypes: ["policy_draft"],
    escalationRules: [{ trigger: "conflicting_legislation", action: "flag_for_legal_review" }],
    mandatoryCitations: ["legislation", "standards"],
  },
  {
    code: "executive_brief",
    title: "Executive Brief",
    objective: "Produce a concise executive brief summarising a topic, issue, or decision for senior leadership consumption.",
    primarySpecialist: "chief_of_staff",
    supportingSpecialists: ["executive_assistant"],
    requiredLibraryKnowledge: ["policy"],
    requiredMemories: ["operating_preference", "terminology"],
    validationRules: [],
    qualityRules: [
      { dimension: "completeness", weight: 30, description: "Key points, context, and recommendation present" },
      { dimension: "writing_style", weight: 40, description: "Executive tone, concise, no jargon" },
      { dimension: "instruction_adherence", weight: 30, description: "Brief answers the stated question" },
    ],
    successCriteria: ["Decision context clear", "Recommendation actionable"],
    outputTypes: ["executive_brief"],
    escalationRules: [],
    mandatoryCitations: [],
  },
  {
    code: "investigation_report",
    title: "Investigation Report",
    objective: "Produce a formal investigation report documenting scope, methodology, findings, conclusions, and recommendations.",
    primarySpecialist: "incident_safeguarding_specialist",
    supportingSpecialists: ["compliance_quality_manager", "chief_of_staff"],
    requiredLibraryKnowledge: ["policy", "procedure", "legislation"],
    requiredMemories: ["approval_rule"],
    validationRules: [
      { rule: "investigation_scope_defined", required: true, description: "Investigation scope must be defined in request" },
      { rule: "policy_present", required: true, description: "Relevant policy must be available" },
    ],
    qualityRules: [
      { dimension: "completeness", weight: 30, description: "All report sections present" },
      { dimension: "policy_compliance", weight: 25, description: "Findings referenced against policy" },
      { dimension: "source_coverage", weight: 25, description: "Evidence cited throughout" },
      { dimension: "consistency", weight: 20, description: "Findings support conclusions" },
    ],
    successCriteria: ["Findings documented with evidence", "Conclusions supported by findings", "Recommendations actionable"],
    outputTypes: ["investigation_report"],
    escalationRules: [{ trigger: "serious_findings", action: "require_executive_review" }],
    mandatoryCitations: ["policy", "legislation"],
  },
  {
    code: "performance_review",
    title: "Performance Review",
    objective: "Prepare a structured performance review document for a staff member covering achievements, development areas, and goals.",
    primarySpecialist: "workforce_compliance_specialist",
    supportingSpecialists: ["executive_assistant"],
    requiredLibraryKnowledge: ["hr_manual", "policy"],
    requiredMemories: ["operating_preference"],
    validationRules: [
      { rule: "staff_context_present", required: true, description: "Staff member information must be provided" },
    ],
    qualityRules: [
      { dimension: "completeness", weight: 35, description: "All review sections completed" },
      { dimension: "writing_style", weight: 30, description: "Professional, constructive language" },
      { dimension: "policy_compliance", weight: 35, description: "Complies with HR policy" },
    ],
    successCriteria: ["Achievements and development areas balanced", "Goals are SMART"],
    outputTypes: ["performance_review"],
    escalationRules: [],
    mandatoryCitations: ["hr_manual"],
  },
  {
    code: "project_plan",
    title: "Project Plan",
    objective: "Draft a project plan covering objectives, deliverables, milestones, resources, risks, and timeline.",
    primarySpecialist: "operations_manager",
    supportingSpecialists: ["chief_of_staff"],
    requiredLibraryKnowledge: ["procedure"],
    requiredMemories: ["operating_preference"],
    validationRules: [],
    qualityRules: [
      { dimension: "completeness", weight: 40, description: "All plan sections present" },
      { dimension: "consistency", weight: 30, description: "Timeline and milestones consistent" },
      { dimension: "writing_style", weight: 30, description: "Clear, structured language" },
    ],
    successCriteria: ["Deliverables defined", "Milestones measurable", "Risks identified"],
    outputTypes: ["project_plan"],
    escalationRules: [],
    mandatoryCitations: [],
  },
  {
    code: "action_plan",
    title: "Action Plan",
    objective: "Produce a structured action plan with specific actions, owners, due dates, and success measures.",
    primarySpecialist: "chief_of_staff",
    supportingSpecialists: ["executive_assistant"],
    requiredLibraryKnowledge: [],
    requiredMemories: ["operating_preference"],
    validationRules: [],
    qualityRules: [
      { dimension: "completeness", weight: 40, description: "Each action has owner and due date" },
      { dimension: "instruction_adherence", weight: 35, description: "Actions address stated objectives" },
      { dimension: "writing_style", weight: 25, description: "Action-oriented, concise language" },
    ],
    successCriteria: ["Actions are specific and measurable", "Owners assigned to all actions"],
    outputTypes: ["action_plan"],
    escalationRules: [],
    mandatoryCitations: [],
  },
  {
    code: "customer_response",
    title: "Customer Response",
    objective: "Draft a professional response to a customer, participant, or stakeholder enquiry or complaint.",
    primarySpecialist: "executive_assistant",
    supportingSpecialists: ["chief_of_staff"],
    requiredLibraryKnowledge: ["communication_guide", "style_guide", "policy"],
    requiredMemories: ["terminology", "operating_preference"],
    validationRules: [],
    qualityRules: [
      { dimension: "writing_style", weight: 35, description: "Tone appropriate for recipient" },
      { dimension: "instruction_adherence", weight: 35, description: "All points in request addressed" },
      { dimension: "policy_compliance", weight: 30, description: "Response consistent with org policy" },
    ],
    successCriteria: ["Enquiry or complaint addressed", "Appropriate tone", "Clear next steps"],
    outputTypes: ["customer_response"],
    escalationRules: [{ trigger: "formal_complaint", action: "require_manager_review" }],
    mandatoryCitations: [],
  },
  {
    code: "business_proposal",
    title: "Business Proposal",
    objective: "Draft a business proposal or business case covering context, proposed solution, benefits, costs, and recommendation.",
    primarySpecialist: "chief_of_staff",
    supportingSpecialists: ["finance_officer", "operations_manager"],
    requiredLibraryKnowledge: ["policy"],
    requiredMemories: ["operating_preference", "terminology"],
    validationRules: [],
    qualityRules: [
      { dimension: "completeness", weight: 35, description: "All proposal sections present" },
      { dimension: "instruction_adherence", weight: 35, description: "Proposal addresses stated objectives" },
      { dimension: "writing_style", weight: 30, description: "Professional, persuasive language" },
    ],
    successCriteria: ["Business case compelling", "Costs and benefits quantified", "Recommendation clear"],
    outputTypes: ["business_proposal"],
    escalationRules: [],
    mandatoryCitations: [],
  },
];

// ─── Keyword index for blueprint selection ────────────────────────────────────

const BLUEPRINT_KEYWORDS: Record<string, string[]> = {
  incident_investigation: ["incident", "investigate", "investigation", "near miss", "reportable", "notifiable", "NDIS reportable", "abuse", "neglect", "unexplained injury"],
  risk_assessment: ["risk", "risk assessment", "hazard", "control", "likelihood", "consequence", "residual"],
  behaviour_support_plan: ["behaviour support", "bsp", "challenging behaviour", "restrictive practice", "de-escalation", "behaviour plan", "triggers"],
  care_plan: ["care plan", "support plan", "participant plan", "care coordination", "NDIS plan", "supports"],
  meeting_minutes: ["meeting", "minutes", "agenda", "action items", "attendees", "notes"],
  operational_procedure: ["procedure", "how to", "step by step", "process", "sop", "standard operating"],
  policy_draft: ["policy", "draft policy", "policy document", "governance", "compliance framework"],
  executive_brief: ["brief", "executive brief", "summary", "leadership", "board", "executive summary", "briefing"],
  investigation_report: ["investigation report", "formal investigation", "findings", "report", "inquiry"],
  performance_review: ["performance review", "appraisal", "performance appraisal", "staff review", "performance management"],
  project_plan: ["project plan", "project", "milestones", "deliverables", "project management"],
  action_plan: ["action plan", "actions", "corrective actions", "improvement plan"],
  customer_response: ["response", "reply", "complaint", "enquiry", "feedback", "customer", "participant complaint", "stakeholder"],
  business_proposal: ["proposal", "business case", "business proposal", "recommendation", "cost benefit"],
};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Select the most appropriate blueprint for a work request.
 * Uses keyword matching against the user's request text and org context.
 */
export async function selectBlueprint(
  userRequest: string,
  organizationId: string,
): Promise<BlueprintSelectionResult> {
  const lower = userRequest.toLowerCase();
  const scores: Record<string, { score: number; keywords: string[] }> = {};

  for (const [code, keywords] of Object.entries(BLUEPRINT_KEYWORDS)) {
    const matched = keywords.filter(kw => lower.includes(kw.toLowerCase()));
    if (matched.length > 0) {
      scores[code] = { score: matched.length, keywords: matched };
    }
  }

  const top = Object.entries(scores).sort((a, b) => b[1].score - a[1].score)[0];
  if (!top) {
    return { blueprint: null, confidence: 0, matchedKeywords: [], fallbackUsed: true };
  }

  const [code, { score, keywords: matched }] = top;

  // Find the blueprint (built-in or org-custom)
  const rows = await db
    .select()
    .from(workBlueprintsTable)
    .where(
      and(
        eq(workBlueprintsTable.code, code),
        eq(workBlueprintsTable.isActive, true),
      )
    )
    .limit(1);

  const blueprint = rows[0] ?? null;
  if (!blueprint) {
    return { blueprint: null, confidence: 0, matchedKeywords: matched, fallbackUsed: true };
  }

  const confidence = Math.min(1.0, score / 3);
  return {
    blueprint: mapRow(blueprint),
    confidence,
    matchedKeywords: matched,
    fallbackUsed: false,
  };
}

/**
 * Get a specific blueprint by ID. Returns null if not found or wrong org.
 */
export async function getBlueprintById(
  id: string,
  organizationId: string,
): Promise<WorkBlueprint | null> {
  const rows = await db
    .select()
    .from(workBlueprintsTable)
    .where(eq(workBlueprintsTable.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.organizationId !== null && row.organizationId !== organizationId) return null;
  return mapRow(row);
}

/**
 * List blueprints available to an organisation (built-ins + org custom).
 */
export async function listBlueprints(organizationId: string): Promise<WorkBlueprint[]> {
  const rows = await db
    .select()
    .from(workBlueprintsTable)
    .where(
      and(
        eq(workBlueprintsTable.isActive, true),
        or(
          isNull(workBlueprintsTable.organizationId),
          eq(workBlueprintsTable.organizationId, organizationId),
        ),
      )
    );

  return rows.map(mapRow);
}

/**
 * Create a custom blueprint for an organisation.
 */
export async function createCustomBlueprint(
  input: CreateBlueprintInput,
  organizationId: string,
  actorUserId: string,
): Promise<WorkBlueprint> {
  const id = randomUUID();
  const now = new Date();

  await db.insert(workBlueprintsTable).values({
    id,
    organizationId,
    code: input.code,
    title: input.title,
    version: input.version ?? "1.0.0",
    objective: input.objective,
    primarySpecialist: input.primarySpecialist,
    supportingSpecialists: input.supportingSpecialists ?? [],
    requiredLibraryKnowledge: input.requiredLibraryKnowledge ?? [],
    requiredEntityKnowledge: input.requiredEntityKnowledge ?? {},
    requiredMemories: input.requiredMemories ?? [],
    requiredApprovals: input.requiredApprovals ?? {},
    validationRules: input.validationRules ?? [],
    qualityRules: input.qualityRules ?? [],
    successCriteria: input.successCriteria ?? [],
    outputTypes: input.outputTypes ?? [],
    escalationRules: input.escalationRules ?? [],
    mandatoryCitations: input.mandatoryCitations ?? [],
    isBuiltIn: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await logOrgEvent({
    organizationId,
    actorUserId,
    eventType: "work_blueprint_created",
    resourceType: "work_blueprint",
    resourceId: id,
    metadata: { code: input.code, title: input.title },
  });

  const created = await getBlueprintById(id, organizationId);
  if (!created) throw new Error("Blueprint not found after creation");
  return created;
}

/**
 * Update a custom blueprint. Built-in blueprints cannot be updated.
 */
export async function updateCustomBlueprint(
  id: string,
  input: UpdateBlueprintInput,
  organizationId: string,
  actorUserId: string,
): Promise<WorkBlueprint> {
  const existing = await getBlueprintById(id, organizationId);
  if (!existing) throw Object.assign(new Error("Blueprint not found"), { statusCode: 404 });
  if (existing.isBuiltIn) throw Object.assign(new Error("Built-in blueprints cannot be modified"), { statusCode: 403 });
  if (existing.organizationId !== organizationId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) updates.title = input.title;
  if (input.version !== undefined) updates.version = input.version;
  if (input.objective !== undefined) updates.objective = input.objective;
  if (input.primarySpecialist !== undefined) updates.primarySpecialist = input.primarySpecialist;
  if (input.supportingSpecialists !== undefined) updates.supportingSpecialists = input.supportingSpecialists;
  if (input.requiredLibraryKnowledge !== undefined) updates.requiredLibraryKnowledge = input.requiredLibraryKnowledge;
  if (input.requiredEntityKnowledge !== undefined) updates.requiredEntityKnowledge = input.requiredEntityKnowledge;
  if (input.requiredMemories !== undefined) updates.requiredMemories = input.requiredMemories;
  if (input.validationRules !== undefined) updates.validationRules = input.validationRules;
  if (input.qualityRules !== undefined) updates.qualityRules = input.qualityRules;
  if (input.successCriteria !== undefined) updates.successCriteria = input.successCriteria;
  if (input.outputTypes !== undefined) updates.outputTypes = input.outputTypes;
  if (input.escalationRules !== undefined) updates.escalationRules = input.escalationRules;
  if (input.mandatoryCitations !== undefined) updates.mandatoryCitations = input.mandatoryCitations;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  await db.update(workBlueprintsTable).set(updates).where(eq(workBlueprintsTable.id, id));

  await logOrgEvent({
    organizationId,
    actorUserId,
    eventType: "work_blueprint_updated",
    resourceType: "work_blueprint",
    resourceId: id,
    metadata: { fieldsUpdated: Object.keys(input) },
  });

  const updated = await getBlueprintById(id, organizationId);
  if (!updated) throw new Error("Blueprint not found after update");
  return updated;
}

/**
 * Seed all built-in blueprints into the database (idempotent).
 * Called at server startup.
 */
export async function seedBuiltInBlueprints(): Promise<void> {
  for (const def of BUILT_IN_BLUEPRINTS) {
    // Check if already seeded
    const existing = await db
      .select({ id: workBlueprintsTable.id })
      .from(workBlueprintsTable)
      .where(
        and(
          eq(workBlueprintsTable.code, def.code),
          isNull(workBlueprintsTable.organizationId),
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    const id = randomUUID();
    await db.insert(workBlueprintsTable).values({
      id,
      organizationId: null,
      code: def.code,
      title: def.title,
      version: "1.0.0",
      objective: def.objective,
      primarySpecialist: def.primarySpecialist,
      supportingSpecialists: def.supportingSpecialists ?? [],
      requiredLibraryKnowledge: def.requiredLibraryKnowledge ?? [],
      requiredEntityKnowledge: def.requiredEntityKnowledge ?? {},
      requiredMemories: def.requiredMemories ?? [],
      requiredApprovals: {},
      validationRules: def.validationRules ?? [],
      qualityRules: def.qualityRules ?? [],
      successCriteria: def.successCriteria ?? [],
      outputTypes: def.outputTypes ?? [],
      escalationRules: def.escalationRules ?? [],
      mandatoryCitations: def.mandatoryCitations ?? [],
      isBuiltIn: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

// ─── Internal mapper ──────────────────────────────────────────────────────────

function mapRow(row: typeof workBlueprintsTable.$inferSelect): WorkBlueprint {
  return {
    id: row.id,
    organizationId: row.organizationId ?? null,
    code: row.code,
    title: row.title,
    version: row.version,
    objective: row.objective,
    primarySpecialist: row.primarySpecialist,
    supportingSpecialists: (row.supportingSpecialists as string[]) ?? [],
    requiredLibraryKnowledge: (row.requiredLibraryKnowledge as string[]) ?? [],
    requiredEntityKnowledge: (row.requiredEntityKnowledge as Record<string, unknown>) ?? {},
    requiredMemories: (row.requiredMemories as string[]) ?? [],
    requiredApprovals: (row.requiredApprovals as Record<string, unknown>) ?? {},
    validationRules: (row.validationRules as Array<{ rule: string; required: boolean; description: string }>) ?? [],
    qualityRules: (row.qualityRules as Array<{ dimension: string; weight: number; description: string }>) ?? [],
    successCriteria: (row.successCriteria as string[]) ?? [],
    outputTypes: (row.outputTypes as string[]) ?? [],
    escalationRules: (row.escalationRules as Array<{ trigger: string; action: string }>) ?? [],
    mandatoryCitations: (row.mandatoryCitations as string[]) ?? [],
    isBuiltIn: row.isBuiltIn,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
