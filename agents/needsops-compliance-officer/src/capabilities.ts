/**
 * NeedsOps Compliance Officer — Capability definitions
 *
 * The first specialist agent. Targets Australian NDIS providers.
 * Sprint 0: capabilities defined. Sprint 1+: backed by OpenAI + document processing.
 */

import type { AgentCapability } from "@workspace/agent-runtime";

export const COMPLIANCE_OFFICER_CAPABILITIES: AgentCapability[] = [
  {
    id: "audit-preparation",
    label: "Audit Preparation",
    requiresApproval: false,
  },
  {
    id: "incident-reporting",
    label: "Incident Report Drafting",
    requiresApproval: true, // Reports submitted to NDIS Commission need human sign-off
  },
  {
    id: "compliance-monitoring",
    label: "NDIS Compliance Monitoring",
    requiresApproval: false,
  },
  {
    id: "risk-assessment",
    label: "Risk Assessment",
    requiresApproval: false,
  },
  {
    id: "policy-review",
    label: "Policy Review & Gap Analysis",
    requiresApproval: false,
  },
  {
    id: "reportable-incident-classification",
    label: "Reportable Incident Classification",
    requiresApproval: true, // Classification determines mandatory reporting obligations
  },
  {
    id: "practice-standards-check",
    label: "NDIS Practice Standards Check",
    requiresApproval: false,
  },
  {
    id: "quality-indicator-review",
    label: "Quality Indicator Review",
    requiresApproval: false,
  },
];
