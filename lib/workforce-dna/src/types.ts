/**
 * Professional DNA Framework — Sprint 10
 *
 * Defines the intellectual property schema for every NeedsOps AI specialist.
 * A DNA profile is the permanent professional identity of a workforce role.
 * It is immutable once published — editing creates a new version.
 *
 * The DNA layer sits between the Worker Profile (personnel) and the
 * Specialist Run (temporary execution) in the architecture:
 *
 *   Conversation → Chief of Staff → Professional DNA → Worker Profile
 *       → Specialist Run → Professional Reasoning → Work Package
 *       → Execution Queue → (OpenClaw later)
 */

// ─── Core DNA identity ────────────────────────────────────────────────────────

export interface DNAIdentity {
  /** Canonical workforce role code — matches workforceRegistry specialist codes */
  roleCode: string;
  /** Human-readable professional title */
  title: string;
  /** Short professional descriptor for UI display */
  descriptor: string;
  /** Organisation context — always NeedsOps */
  organisation: "NeedsOps AI+";
  /** Domain specialisation */
  domain: string;
}

// ─── Mission and philosophy ───────────────────────────────────────────────────

export interface DNAMission {
  /** One-sentence professional mission statement */
  primaryMission: string;
  /** 3-5 core professional objectives */
  objectives: string[];
  /** Non-negotiable professional values */
  values: string[];
}

export interface DNAPhilosophy {
  /** Guiding professional philosophy */
  statement: string;
  /** How this specialist approaches uncertainty */
  uncertaintyApproach: string;
  /** How this specialist treats evidence */
  evidencePhilosophy: string;
}

// ─── Competencies ─────────────────────────────────────────────────────────────

export interface DNACompetency {
  code: string;
  name: string;
  description: string;
  level: "foundational" | "practitioner" | "expert" | "authority";
}

// ─── Reasoning methodology ────────────────────────────────────────────────────

export type ReasoningStepType =
  | "scope_definition"
  | "legislation_identification"
  | "evidence_review"
  | "gap_analysis"
  | "risk_assessment"
  | "dependency_analysis"
  | "conflict_detection"
  | "recommendation_formation"
  | "escalation_check"
  | "output_validation";

export interface ReasoningStep {
  /** Unique step identifier within the methodology */
  stepId: string;
  /** Human-readable step name */
  name: string;
  /** What this step does */
  description: string;
  /** Step type from canonical taxonomy */
  type: ReasoningStepType;
  /** If true, specialist MUST complete this step before proceeding */
  mandatory: boolean;
  /** Steps that must complete before this one */
  dependsOn: string[];
  /** Prompt instruction for this reasoning step */
  instruction: string;
}

export interface DNAReasoningMethodology {
  /** Version of this methodology */
  version: string;
  /** Short name for display */
  name: string;
  /** Ordered reasoning steps the specialist MUST follow */
  steps: ReasoningStep[];
  /** Whether steps must be followed strictly in order */
  strictOrdering: boolean;
  /** Maximum depth of reasoning loops before escalating */
  maxIterations: number;
}

// ─── Decision framework ───────────────────────────────────────────────────────

export interface DecisionCriteria {
  /** What this specialist prioritises when making decisions */
  priorities: string[];
  /** How conflicting priorities are resolved */
  conflictResolution: string;
  /** Minimum evidence required before forming a finding */
  minimumEvidenceThreshold: string;
}

// ─── Evidence standards ────────────────────────────────────────────────────────

export interface EvidenceStandard {
  /** Evidence type */
  type: "documentary" | "testimonial" | "observational" | "analytical" | "regulatory";
  /** Weight given to this type in assessments */
  weight: "primary" | "secondary" | "supporting";
  /** Requirements for this evidence to be accepted */
  requirements: string[];
}

export interface DNAEvidenceStandards {
  /** Accepted evidence types and weights */
  standards: EvidenceStandard[];
  /** What makes evidence insufficient */
  insufficiencyIndicators: string[];
  /** How to handle contradictory evidence */
  contradictionPolicy: string;
  /** Whether invented evidence references are tolerated (always false) */
  allowInventedReferences: false;
}

// ─── Risk tolerance ───────────────────────────────────────────────────────────

export type RiskAppetite = "zero_tolerance" | "low" | "moderate" | "contextual";

export interface DNARiskTolerance {
  /** Default risk appetite */
  appetite: RiskAppetite;
  /** Factors that raise risk threshold */
  escalationFactors: string[];
  /** When to automatically escalate to human review */
  autoEscalateWhen: string[];
  /** Risk categories this specialist tracks */
  riskCategories: string[];
}

// ─── Escalation rules ─────────────────────────────────────────────────────────

export interface EscalationRule {
  trigger: string;
  action: "pause_and_ask" | "create_conflict" | "flag_for_human" | "refuse_and_explain";
  priority: "immediate" | "high" | "normal";
  message: string;
}

export interface DNAEscalationFramework {
  /** Conditions that trigger escalation */
  rules: EscalationRule[];
  /** When the specialist must stop and refuse to continue */
  hardStops: string[];
  /** Default escalation path */
  defaultPath: string;
}

// ─── Professional boundaries ──────────────────────────────────────────────────

export interface DNAProfessionalBoundaries {
  /** What the specialist is authorised to do */
  canDo: string[];
  /** What the specialist is explicitly prohibited from doing */
  cannotDo: string[];
  /** Actions that require explicit human approval */
  requiresApproval: string[];
  /** Areas outside professional scope */
  outOfScope: string[];
  /** Critical security constraints */
  securityConstraints: string[];
}

// ─── Communication style ──────────────────────────────────────────────────────

export type ToneOfVoice =
  | "authoritative_professional"
  | "collaborative_advisor"
  | "executive_strategic"
  | "technical_precise"
  | "supportive_informational";

export interface DNACommunicationStyle {
  toneOfVoice: ToneOfVoice;
  /** How findings are framed */
  findingsFraming: string;
  /** Language register */
  languageRegister: "formal" | "semi_formal" | "plain_english";
  /** Whether the specialist asks clarifying questions unprompted */
  proactiveClarification: boolean;
  /** How the specialist labels itself in conversation */
  conversationLabel: string;
  /** Sentence structure guidance */
  structureGuidance: string;
}

// ─── Preferred outputs ────────────────────────────────────────────────────────

export type OutputType =
  | "structured_findings"
  | "risk_register"
  | "compliance_report"
  | "work_package"
  | "draft_document"
  | "executive_summary"
  | "action_plan"
  | "recommendation_matrix"
  | "execution_intent"
  | "escalation_notice"
  | "conflict_report";

export interface PreferredOutput {
  type: OutputType;
  description: string;
  /** Whether this output is always produced regardless of task type */
  alwaysIncluded: boolean;
}

// ─── Memory and learning policy ────────────────────────────────────────────────

export interface DNAMemoryPolicy {
  /** Maximum conversation messages to retrieve */
  maxRelevantMessages: number;
  /** Whether to use organisation memory */
  useOrganisationMemory: boolean;
  /** Whether to use previous Work Package outputs from dependencies */
  usePreviousWorkPackages: boolean;
  /** Whether to store findings in organisation memory after completion */
  persistFindings: boolean;
  /** Memory categories this specialist reads */
  readCategories: string[];
  /** Memory categories this specialist writes */
  writeCategories: string[];
}

export interface DNALearningPolicy {
  /** Whether the specialist updates its assumptions between runs */
  adaptiveLearning: boolean;
  /** How feedback from conflicts is incorporated */
  conflictLearning: string;
  /** Whether it considers previous task outcomes */
  usePreviousTaskOutcomes: boolean;
}

// ─── Capability and tool configuration ────────────────────────────────────────

export interface DNACapabilityConfig {
  /** Capability codes this specialist handles */
  requiredCapabilities: string[];
  /** Execution channels this specialist can request */
  supportedExecutionChannels: string[];
  /** Tool categories this specialist can request (for OpenClaw) */
  allowedToolCategories: string[];
  /** Connector categories this specialist can use */
  allowedConnectorCategories: string[];
  /** Explicitly prohibited tools */
  prohibitedTools: string[];
}

// ─── Confidence model ─────────────────────────────────────────────────────────

export interface DNAConfidenceModel {
  /** Minimum confidence to produce an affirmative finding */
  minimumFindingConfidence: number;
  /** Minimum overall confidence to mark run as completed */
  minimumRunConfidence: number;
  /** When to mark a run as "blocked" instead of completing */
  blockThreshold: number;
  /** Factors that increase confidence */
  confidenceBoosts: string[];
  /** Factors that reduce confidence */
  confidenceReducers: string[];
}

// ─── Conflict resolution rules ─────────────────────────────────────────────────

export interface DNAConflictPolicy {
  /** How this specialist behaves when it receives outputs that conflict with its own */
  onConflict: "flag_and_continue" | "pause_and_escalate" | "defer_to_higher_authority";
  /** Which roles this specialist defers to */
  defersTo: string[];
  /** Which roles this specialist overrides */
  overrides: string[];
  /** Whether it can resolve conflicts autonomously */
  autonomousResolution: boolean;
}

// ─── Output schema ────────────────────────────────────────────────────────────

export interface DNAOutputSchema {
  /** Version of the output schema — incrementing this breaks result parsing */
  version: string;
  /** Whether the specialist is expected to produce execution intents */
  producesExecutionIntents: boolean;
  /** The required result structure keys */
  requiredKeys: string[];
  /** Validation rules for the output */
  validationRules: string[];
}

// ─── Worker Profile requirement ────────────────────────────────────────────────

export interface RequiredWorkerProfile {
  /** The worker profile code that must be assigned to use this DNA */
  profileCode: string;
  /** Minimum experience level required */
  minimumExperienceLevel: "junior" | "intermediate" | "senior" | "principal";
  /** Whether a dedicated worker profile is required or defaults are acceptable */
  dedicatedProfileRequired: boolean;
}

// ─── Version management ───────────────────────────────────────────────────────

export interface DNAVersion {
  /** Semantic version string */
  version: string;
  /** ISO 8601 publication date */
  publishedAt: string;
  /** Who published this version */
  publishedBy: string;
  /** Change summary */
  changeDescription: string;
  /** Whether this version is currently active */
  isActive: boolean;
  /** Previous version, if any */
  previousVersion: string | null;
}

// ─── Full DNA Profile ─────────────────────────────────────────────────────────

/**
 * Complete Professional DNA Profile.
 *
 * Immutable once published — editing creates a new version.
 * This is the intellectual property of NeedsOps.
 */
export interface DNAProfile {
  /** Profile identity */
  identity: DNAIdentity;
  /** Version information */
  currentVersion: DNAVersion;
  /** Version history (most recent first) */
  versionHistory: DNAVersion[];
  /** Professional mission */
  mission: DNAMission;
  /** Professional philosophy */
  philosophy: DNAPhilosophy;
  /** Core competencies */
  competencies: DNACompetency[];
  /** Structured reasoning methodology */
  reasoningMethodology: DNAReasoningMethodology;
  /** Decision framework */
  decisionFramework: DecisionCriteria;
  /** Evidence standards */
  evidenceStandards: DNAEvidenceStandards;
  /** Risk tolerance */
  riskTolerance: DNARiskTolerance;
  /** Escalation framework */
  escalationFramework: DNAEscalationFramework;
  /** Professional boundaries */
  professionalBoundaries: DNAProfessionalBoundaries;
  /** Communication style */
  communicationStyle: DNACommunicationStyle;
  /** Preferred output types */
  preferredOutputs: PreferredOutput[];
  /** Memory policy */
  memoryPolicy: DNAMemoryPolicy;
  /** Learning policy */
  learningPolicy: DNALearningPolicy;
  /** Capability configuration */
  capabilityConfig: DNACapabilityConfig;
  /** Confidence model */
  confidenceModel: DNAConfidenceModel;
  /** Conflict resolution policy */
  conflictPolicy: DNAConflictPolicy;
  /** Output schema definition */
  outputSchema: DNAOutputSchema;
  /** Required worker profile */
  requiredWorkerProfile: RequiredWorkerProfile;
}

// ─── Run version record ────────────────────────────────────────────────────────

/**
 * Version snapshot recorded at the start of every Specialist Run.
 * Guarantees full reproducibility of any run.
 */
export interface RunVersionRecord {
  dnaVersion: string;
  workerProfileVersion: string;
  capabilityVersion: string;
  reasoningVersion: string;
  outputSchemaVersion: string;
  modelVersion: string;
  recordedAt: string;
}

export function captureRunVersions(
  profile: DNAProfile,
  modelVersion: string,
  capabilityVersion = "1.0.0",
  workerProfileVersion = "1.0.0",
): RunVersionRecord {
  return {
    dnaVersion: profile.currentVersion.version,
    workerProfileVersion,
    capabilityVersion,
    reasoningVersion: profile.reasoningMethodology.version,
    outputSchemaVersion: profile.outputSchema.version,
    modelVersion,
    recordedAt: new Date().toISOString(),
  };
}
