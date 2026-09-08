/**
 * Side-effect-free RLS table lists.
 *
 * Keep these constants out of rlsVerifier.ts so tests and schema checks can
 * import them without initialising the platform database connection.
 */

/**
 * All tables in the public schema that must have RLS enabled.
 * Update this list whenever a new tenant-scoped table is added.
 */
export const REQUIRED_RLS_TABLES = [
  "tasks",
  "task_specialists",
  "task_execution_plans",
  "approvals",
  "approval_rules",
  "approval_history",
  "memberships",
  "invitations",
  "tenant_subscriptions",
  "tenant_entitlements",
  "tenant_overrides",
  "tenant_settings",
  "tenant_addons",
  "tenant_usage_allowances",
  "tenant_workforce_packs",
  "usage_events",
  "usage_period_summaries",
  "org_audit_log",
  "audit_log",
  // Sprint 8 - Execution Runtime
  "execution_sessions",
  "execution_events",
  // Sprint 9 - Conversational Task Workroom
  "conversations",
  "conversation_messages",
  "conversation_participants",
  "message_attachments",
  "message_reads",
  // Sprint 9.2 - Tenant-Aware Chief of Staff Memory
  "organisation_memory",
  "conversation_memory",
  // Sprint 9.4 - Capability decisions
  "capability_decisions",
  // Sprint 9.5 - Specialist Runtime
  "specialist_runs",
  "specialist_queue",
  "specialist_run_memory",
  "specialist_conflicts",
  // Sprint 9.6 - Pack Commerce access requests (org-scoped)
  "workforce_pack_access_requests",
  // Sprint 14 - NeedsOps AI+ Installer, Device Management, Business Discovery
  "devices",
  "device_credentials",
  "device_activation_tokens",
  "device_runtime_status",
  "onboarding_sessions",
  "org_company_profile",
  "org_connected_systems",
  "device_approved_resources",
  "org_approval_rules_discovery",
  "org_discovery_answers",
  "org_discovery_status",
  "agent_configurations",
  // Sprint 15 - Production Transport, Auth, WS Relay
  "device_auth_challenges",
  "device_access_tokens",
  "device_refresh_tokens",
  "device_ws_sessions",
  "device_task_dispatch",
  // Sprint SRM Hardening - Organisation Specialist Configuration
  "organisation_specialist_configuration",
  // Sprint Knowledge Bridge (Task #14) - Specialist Language Profiles
  "specialist_language_profiles",
  // Task #15 - Knowledge Schema, Scopes & Secure Upload (Organisation Library)
  "knowledge_sources",
  "knowledge_source_scopes",
  "knowledge_source_versions",
  "knowledge_chunks",
  "specialist_training_status",
  "retrieval_audit_events",
  // Task #16 - Document Ingestion & Embedding Pipeline
  "ingestion_jobs",
  // Sprint 21 - Knowledge Curation Jobs
  "knowledge_curation_jobs",
  // Sprint 22 - Work Execution Engine & Completed Work
  "work_blueprints",
  "work_package_manifests",
  "completed_work",
  "completed_work_versions",
  "completed_work_comments",
  "completed_work_assets",
  // Task #36 - Server-side notification state
  "notification_reads",
  // Sprint 28 - Blueprint Studio versioning
  "blueprint_versions",
  // Sprint 27.2 - Durable Execution Checkpoints
  "execution_checkpoints",
  // Sprint 29F.1 - Persisted Connector Write Action Lifecycle
  "execution_actions",
  // Sprint 29K.2 - Durable Evidence Foundation (Hybrid EvidencePack persistence)
  "completed_work_evidence_snapshots",
  "completed_work_evidence_links",
  // Sprint 29K.3 - Claim Emission & Claim-to-Evidence Binding
  "completed_work_claims",
  "completed_work_claim_evidence",
] as const;

export type RequiredRLSTable = typeof REQUIRED_RLS_TABLES[number];

/**
 * Tables that must be READ-ONLY for needsops_app from Sprint 7.1 onward.
 * Write access to these tables is a security boundary violation.
 */
export const LEGACY_WRITE_RESTRICTED_TABLES = [
  "audit_log",
  "org_audit_log",
  "tasks",
  "approvals",
  "approval_history",
  "task_execution_plans",
  "task_specialists",
] as const;

export type LegacyWriteRestrictedTable = typeof LEGACY_WRITE_RESTRICTED_TABLES[number];
