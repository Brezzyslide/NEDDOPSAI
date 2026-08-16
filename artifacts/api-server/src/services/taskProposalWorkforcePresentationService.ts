import type {
  ConversationUnderstanding,
  StructuredContent,
} from "./conversationIntelligenceService.js";
import { buildTaskProposalCard } from "./conversationIntelligenceService.js";
import { planTask, type TaskPlan } from "./chiefOfStaffService.js";
import { SPECIALISTS } from "../lib/workforceRegistry.js";

export interface AuthoritativeProposalWorkforce {
  source: "chief_of_staff_plan_task";
  authoritative: true;
  intent: string;
  coordinator: string | null;
  coordinatorName: string | null;
  primaryProfessionalOwner: string;
  primaryProfessionalOwnerName: string;
  supportingSpecialists: string[];
  supportingSpecialistNames: string[];
  assignedSpecialists: string[];
  assignedSpecialistNames: string[];
}

export interface AuthoritativeTaskProposalPresentation {
  plan: TaskPlan;
  workforce: AuthoritativeProposalWorkforce;
  response: string;
  structuredContent: StructuredContent | null;
}

function displayRoleName(roleCode: string): string {
  return SPECIALISTS.find(s => s.code === roleCode)?.displayName
    ?? roleCode.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function uniqueRoleCodes(roles: string[]): string[] {
  const seen = new Set<string>();
  return roles.filter(role => {
    if (!role || seen.has(role)) return false;
    seen.add(role);
    return true;
  });
}

function buildTaskDescription(proposedTask: NonNullable<ConversationUnderstanding["proposedTask"]>): string {
  return [
    proposedTask.summary,
    proposedTask.requestedOutcome ? `Requested outcome: ${proposedTask.requestedOutcome}` : "",
    proposedTask.knownConstraints.length > 0
      ? `Known constraints: ${proposedTask.knownConstraints.join("; ")}`
      : "",
  ].filter(Boolean).join("\n\n");
}

function buildWorkforceFromPlan(plan: TaskPlan): AuthoritativeProposalWorkforce {
  const assignedSpecialists = uniqueRoleCodes(plan.assignedSpecialists);
  const coordinator = assignedSpecialists.includes("chief_of_staff") ? "chief_of_staff" : null;
  const primaryProfessionalOwner = plan.primarySpecialist === "chief_of_staff"
    ? assignedSpecialists.find(role => role !== "chief_of_staff") ?? "chief_of_staff"
    : plan.primarySpecialist;
  const supportingSpecialists = assignedSpecialists.filter(role =>
    role !== "chief_of_staff" && role !== primaryProfessionalOwner
  );

  return {
    source: "chief_of_staff_plan_task",
    authoritative: true,
    intent: plan.intent,
    coordinator,
    coordinatorName: coordinator ? displayRoleName(coordinator) : null,
    primaryProfessionalOwner,
    primaryProfessionalOwnerName: displayRoleName(primaryProfessionalOwner),
    supportingSpecialists,
    supportingSpecialistNames: supportingSpecialists.map(displayRoleName),
    assignedSpecialists,
    assignedSpecialistNames: assignedSpecialists.map(displayRoleName),
  };
}

function buildAuthoritativeResponse(input: {
  title: string;
  workforce: AuthoritativeProposalWorkforce;
}): string {
  const { workforce } = input;
  const supporting = workforce.supportingSpecialistNames.length > 0
    ? `, supported by ${workforce.supportingSpecialistNames.join(", ")}`
    : "";
  const primaryLine = workforce.primaryProfessionalOwner === "chief_of_staff"
    ? "I'll coordinate this through the Chief of Staff."
    : `I'll prepare this with ${workforce.primaryProfessionalOwnerName} as the primary specialist${supporting}.`;

  return `This looks like a formal task request.\n\nProposed task:\n${input.title}\n\n${primaryLine}\n\nWould you like me to create the task and prepare the work plan?`;
}

export function buildAuthoritativeTaskProposalPresentation(
  understanding: ConversationUnderstanding,
): AuthoritativeTaskProposalPresentation | null {
  if (!understanding.proposedTask) return null;

  const plan = planTask(
    understanding.proposedTask.title,
    buildTaskDescription(understanding.proposedTask),
  );
  const workforce = buildWorkforceFromPlan(plan);
  const roles = workforce.assignedSpecialists.length > 0
    ? workforce.assignedSpecialists
    : understanding.relatedWorkforceRoles;

  const card = buildTaskProposalCard({
    ...understanding,
    relatedWorkforceRoles: roles,
  });

  if (card) {
    card.data = {
      ...card.data,
      suggestedRoles: roles,
      authoritativeWorkforce: workforce,
      primaryProfessionalOwner: workforce.primaryProfessionalOwner,
      primaryProfessionalOwnerName: workforce.primaryProfessionalOwnerName,
      supportingSpecialists: workforce.supportingSpecialists,
      supportingSpecialistNames: workforce.supportingSpecialistNames,
      coordinator: workforce.coordinator,
      coordinatorName: workforce.coordinatorName,
      assignedSpecialists: workforce.assignedSpecialists,
      assignedSpecialistNames: workforce.assignedSpecialistNames,
      workforceSource: workforce.source,
    };
  }

  return {
    plan,
    workforce,
    response: buildAuthoritativeResponse({
      title: understanding.proposedTask.title,
      workforce,
    }),
    structuredContent: card,
  };
}
