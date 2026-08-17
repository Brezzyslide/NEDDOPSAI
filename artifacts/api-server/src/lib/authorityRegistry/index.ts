/**
 * Sprint 29N.6 — Part F: NeedsOps Authority Registry
 *
 * A bounded, extensible registry of external sources that NeedsOps considers
 * authoritative for evidence discovery purposes.
 *
 * Design rules (from Part F brief):
 *   - Start narrow and extensible — NOT a giant manually maintained internet directory
 *   - Unknown external sources may be returned as candidates but must not
 *     automatically become AcceptedEvidence
 *   - Authority is determined by domain + type + jurisdiction combination
 *   - A registered source being "known" does NOT mean it is automatically accepted —
 *     each candidate still goes through the Authority Gate
 *
 * Extending the registry:
 *   - Add entries to AUTHORITY_REGISTRY_ENTRIES below
 *   - In a future sprint, move entries to DB table (platform_authority_registry)
 *     so they can be managed without a code deployment
 */

// ─── Registry types ───────────────────────────────────────────────────────────

/**
 * Category of authority — maps to the external evidence signals in
 * evidenceSufficiencyService.ts EXTERNAL_AUTHORITY_KEYWORDS.
 */
export type AuthorityCategory =
  | "legislation"         // statute, act, statutory instrument
  | "regulation"          // regulatory body rules
  | "government_guidance" // government-published guidance
  | "standard"            // ISO, BSI, PCI-DSS, NIST or similar
  | "case_law";           // court or tribunal decision

/**
 * Whether this source has primary (definitive) or secondary (interpretive)
 * authority on its subject matter.
 */
export type AuthorityStrength = "primary" | "secondary";

export type AuthoritySourceClass =
  | "primary_law"
  | "legislative_instrument"
  | "regulator"
  | "state_regulator"
  | "government_agency"
  | "official_industrial_instrument"
  | "official_government_guidance"
  | "accredited_professional_standard"
  | "government_api_discovery"
  | "organisation_approved_internal_source"
  | "secondary_professional_source"
  | "general_web_source"
  | "user_provided_source"
  | "memory"
  | "sample_example";

export type AuthorityCurrentnessStatus = "current" | "superseded" | "inactive" | "requires_review";
export type AuthorityJurisdiction =
  | "AU_COMMONWEALTH"
  | "AU_NATIONAL"
  | "AU"
  | "AU-Federal"
  | "AU-model"
  | "VIC"
  | "NSW"
  | "QLD"
  | "SA"
  | "WA"
  | "TAS"
  | "ACT"
  | "NT"
  | "MULTI_JURISDICTION"
  | "GLOBAL"
  | string;

export type ProfessionalDomain =
  | "NDIS_REGULATION"
  | "LEGISLATION"
  | "RESTRICTIVE_PRACTICE"
  | "BEHAVIOUR_SUPPORT"
  | "INCIDENT_MANAGEMENT"
  | "SAFEGUARDING"
  | "SERVICE_DELIVERY"
  | "WORKFORCE"
  | "ROSTERING"
  | "PAYROLL"
  | "INDUSTRIAL_RELATIONS"
  | "TAX"
  | "SUPERANNUATION"
  | "PRIVACY"
  | "DATA_GOVERNANCE"
  | "WORK_HEALTH_SAFETY"
  | "CORPORATE_GOVERNANCE"
  | "HUMAN_RIGHTS"
  | "LONG_SERVICE_LEAVE"
  | "FINANCE"
  | "AGED_CARE"
  | "CLINICAL"
  | string;

export type AuthorityTransport =
  | "API_PUBLIC"
  | "API_AUTHENTICATED"
  | "API_RESTRICTED"
  | "OAUTH_CONNECTOR"
  | "BULK_DATA"
  | "OFFICIAL_DOCUMENT"
  | "GOVERNED_WEB"
  | "INTERNAL_KRS"
  | "NOT_CONFIGURED"
  | "NOT_AVAILABLE";

export type ApiStatus = "AVAILABLE" | "RESTRICTED" | "NOT_CONFIGURED" | "NOT_AVAILABLE" | "UNKNOWN";
export type CredentialStatus = "NOT_REQUIRED" | "NOT_CONFIGURED" | "CONFIGURED" | "RESTRICTED" | "UNKNOWN";
export type SourceVerificationStatus = "VERIFIED" | "REQUIRES_REVIEW" | "REJECTED";

/**
 * A single entry in the Authority Registry.
 * Each entry represents a trusted publisher/domain with specific scope.
 */
export interface AuthorityRegistryEntry {
  /** Stable identifier for this entry — never changes once published */
  id: string;
  /** Human-readable name of the authority */
  name: string;
  /** Authority organisation/publisher. */
  organisation?: string;
  /** Canonical official domain for display and provenance. */
  officialDomain?: string;
  /**
   * Approved domains for this authority.
   * Candidate URLs must have one of these as their registered domain.
   * Examples: ["legislation.gov.uk", "fca.org.uk"]
   */
  approvedDomains: string[];
  /** Category of authority content */
  category: AuthorityCategory;
  /**
   * Jurisdictions this authority covers.
   * Use "GLOBAL" when jurisdiction is not limited.
   */
  jurisdictions: string[];
  /**
   * Subject areas this authority is authoritative for.
   * Empty = applies to all subject areas.
   */
  subjectAreas: string[];
  /**
   * How authoritative this source is:
   *   primary   — definitive source (e.g. legislation.gov.uk for UK law)
   *   secondary — interpretive or summarising (e.g. a guidance body)
   */
  strength: AuthorityStrength;
  /**
   * Registry entry status.
   * "active"   — may accept candidates from this source
   * "rejected" — may never accept candidates from this source
   * "requires_review" — candidates are flagged for manual review before acceptance
   */
  status: "active" | "rejected" | "requires_review" | "inactive" | "superseded";
  /**
   * Maps to evidence authority class when accepted.
   * primary legislation → "mandatory"
   * primary regulation  → "primary"
   * guidance            → "supporting"
   * standards           → "supporting"
   */
  evidenceAuthorityClass: "mandatory" | "primary" | "supporting" | "reference";
  /** Any governance note to attach to accepted candidates from this source */
  governanceNote?: string;
  /** Professional evidence classification. Search result ranking never sets this. */
  sourceClass?: AuthoritySourceClass;
  /** Controlled professional domains supported by this source. */
  professionalDomains?: ProfessionalDomain[];
  /** Current governance status of the source definition. */
  sourceStatus?: "ACTIVE" | "INACTIVE" | "SUPERSEDED" | "REQUIRES_REVIEW";
  /** Whether the source definition has been verified from official material. */
  verificationStatus?: SourceVerificationStatus;
  /** Workforce domains where this source may be treated as relevant authority. */
  applicableWorkforceDomains?: string[];
  currentTransport?: AuthorityTransport;
  preferredTransport?: AuthorityTransport;
  fallbackTransport?: AuthorityTransport;
  apiStatus?: ApiStatus;
  apiBaseUrl?: string;
  developerPortal?: string;
  authenticationType?: "NONE" | "API_KEY" | "OAUTH2" | "ACCOUNT" | "UNKNOWN";
  credentialStatus?: CredentialStatus;
  approvedDocumentSources?: string[];
  versionSupport?: "SUPPORTED" | "PARTIAL" | "NOT_AVAILABLE" | "UNKNOWN";
  effectiveDateSupport?: "SUPPORTED" | "PARTIAL" | "NOT_AVAILABLE" | "UNKNOWN";
  historicalSupport?: "SUPPORTED" | "PARTIAL" | "NOT_AVAILABLE" | "UNKNOWN";
  freshnessStrategy?: "API_CURRENTNESS" | "VERSIONED_PUBLICATION" | "LAST_MODIFIED" | "RETRIEVED_AT_ONLY" | "UNKNOWN";
  connectorId?: string;
  futureConnectorId?: string;
  /** Domain-specific retrieval governance for this source. */
  retrievalPolicy?: {
    mode: "official_domain_allowlist" | "api_preferred" | "manual_review_required";
    preferredAccess?: "html" | "api" | "pdf" | "download" | "portal";
    freshnessCheck?: "retrieved_at_only" | "last_modified" | "versioned_publication" | "effective_date_required";
    notes?: string;
  };
  /** Currentness metadata. retrievedAt is not the same as effective/current law. */
  currentness?: {
    status: AuthorityCurrentnessStatus;
    verifiedAt?: string;
    effectiveFrom?: string;
    versionLabel?: string;
    notes?: string;
  };
  /** Stable upstream metadata for downstream provenance projection. */
  provenance?: {
    officialSourceUrl: string;
    verifiedBy: "source_registry_bootstrap" | "platform_governance";
    verifiedAt: string;
    notes?: string;
  };
}

// ─── Registry entries (bounded, extensible) ────────────────────────────────────
// v1.0 — UK-focused, general compliance coverage. Add entries to extend.

const AUTHORITY_REGISTRY_ENTRIES: AuthorityRegistryEntry[] = [
  // ── UK Legislation ─────────────────────────────────────────────────────────
  {
    id: "ar-001",
    name: "UK Legislation (legislation.gov.uk)",
    approvedDomains: ["legislation.gov.uk"],
    category: "legislation",
    jurisdictions: ["UK", "England_and_Wales", "Scotland", "Northern_Ireland"],
    subjectAreas: [],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "mandatory",
    governanceNote: "Primary source for UK statute and statutory instruments",
  },
  // ── Financial Regulation ────────────────────────────────────────────────────
  {
    id: "ar-002",
    name: "Financial Conduct Authority (FCA)",
    approvedDomains: ["fca.org.uk"],
    category: "regulation",
    jurisdictions: ["UK"],
    subjectAreas: ["financial_services", "consumer_credit", "insurance", "investment"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "mandatory",
    governanceNote: "FCA rules and guidance have direct regulatory force for UK-authorised firms",
  },
  {
    id: "ar-003",
    name: "Prudential Regulation Authority (PRA)",
    approvedDomains: ["bankofengland.co.uk"],
    category: "regulation",
    jurisdictions: ["UK"],
    subjectAreas: ["banking", "insurance", "prudential_regulation"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "mandatory",
  },
  // ── Data Protection ────────────────────────────────────────────────────────
  {
    id: "ar-004",
    name: "Information Commissioner's Office (ICO)",
    approvedDomains: ["ico.org.uk"],
    category: "government_guidance",
    jurisdictions: ["UK"],
    subjectAreas: ["data_protection", "privacy", "gdpr", "freedom_of_information"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    governanceNote: "ICO guidance is authoritative for UK GDPR and data protection interpretation",
  },
  {
    id: "ar-005",
    name: "GDPR Official Text (EUR-Lex)",
    approvedDomains: ["eur-lex.europa.eu"],
    category: "legislation",
    jurisdictions: ["EU", "UK"],
    subjectAreas: ["data_protection", "gdpr", "privacy"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "mandatory",
  },
  // ── Health & Safety ────────────────────────────────────────────────────────
  {
    id: "ar-006",
    name: "Health and Safety Executive (HSE)",
    approvedDomains: ["hse.gov.uk"],
    category: "government_guidance",
    jurisdictions: ["UK"],
    subjectAreas: ["health_and_safety", "workplace_safety", "risk_assessment"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
  },
  // ── UK Government Guidance ─────────────────────────────────────────────────
  {
    id: "ar-007",
    name: "UK Government (GOV.UK)",
    approvedDomains: ["gov.uk", "www.gov.uk"],
    category: "government_guidance",
    jurisdictions: ["UK", "England_and_Wales"],
    subjectAreas: [],
    strength: "secondary",
    status: "active",
    evidenceAuthorityClass: "supporting",
    governanceNote: "GOV.UK guidance is authoritative for government policy but not always a primary legal source. Prefer legislation.gov.uk for statute.",
  },
  // ── Employment & Equality ───────────────────────────────────────────────────
  {
    id: "ar-008",
    name: "Advisory, Conciliation and Arbitration Service (ACAS)",
    approvedDomains: ["acas.org.uk"],
    category: "government_guidance",
    jurisdictions: ["UK"],
    subjectAreas: ["employment", "workplace_relations", "disciplinary", "grievance"],
    strength: "secondary",
    status: "active",
    evidenceAuthorityClass: "supporting",
  },
  // ── International Standards ────────────────────────────────────────────────
  {
    id: "ar-009",
    name: "International Organisation for Standardisation (ISO)",
    approvedDomains: ["iso.org"],
    category: "standard",
    jurisdictions: ["GLOBAL"],
    subjectAreas: ["quality_management", "information_security", "environmental", "business_continuity"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "supporting",
    governanceNote: "ISO standards are globally recognised but adoption is voluntary unless mandated by contract or regulation",
  },
  {
    id: "ar-010",
    name: "Payment Card Industry Security Standards Council (PCI SSC)",
    approvedDomains: ["pcisecuritystandards.org"],
    category: "standard",
    jurisdictions: ["GLOBAL"],
    subjectAreas: ["payment_card_security", "data_security"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "mandatory",
    governanceNote: "PCI-DSS is contractually mandatory for entities handling card payments",
  },
  {
    id: "ar-011",
    name: "National Institute of Standards and Technology (NIST)",
    approvedDomains: ["nist.gov"],
    category: "standard",
    jurisdictions: ["US-Federal", "GLOBAL"],
    subjectAreas: ["cybersecurity", "information_security", "risk_management"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "supporting",
  },
  // ── Financial Reporting ────────────────────────────────────────────────────
  {
    id: "ar-012",
    name: "Financial Reporting Council (FRC)",
    approvedDomains: ["frc.org.uk"],
    category: "regulation",
    jurisdictions: ["UK"],
    subjectAreas: ["corporate_governance", "auditing", "accounting", "actuarial"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "mandatory",
  },
  // ── Australian primary and professional authorities ───────────────────────
  {
    id: "ar-au-001",
    name: "Federal Register of Legislation",
    organisation: "Office of Parliamentary Counsel",
    officialDomain: "legislation.gov.au",
    approvedDomains: ["legislation.gov.au"],
    category: "legislation",
    jurisdictions: ["AU", "AU-Federal", "AU_COMMONWEALTH", "AU_NATIONAL"],
    subjectAreas: ["commonwealth_legislation", "federal_law", "regulatory_obligations", "privacy", "tax", "employment", "ndis"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "mandatory",
    sourceClass: "primary_law",
    professionalDomains: ["LEGISLATION", "NDIS_REGULATION", "PRIVACY", "TAX", "INDUSTRIAL_RELATIONS", "CORPORATE_GOVERNANCE"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "API_PUBLIC",
    preferredTransport: "API_PUBLIC",
    fallbackTransport: "GOVERNED_WEB",
    apiStatus: "AVAILABLE",
    apiBaseUrl: "https://api.prod.legislation.gov.au/v1",
    authenticationType: "NONE",
    credentialStatus: "NOT_REQUIRED",
    approvedDocumentSources: ["https://www.legislation.gov.au/"],
    versionSupport: "SUPPORTED",
    effectiveDateSupport: "SUPPORTED",
    historicalSupport: "SUPPORTED",
    freshnessStrategy: "API_CURRENTNESS",
    applicableWorkforceDomains: ["policy_governance", "compliance_quality", "workforce_compliance", "payroll_workforce_cost", "privacy", "ndis"],
    retrievalPolicy: {
      mode: "official_domain_allowlist",
      preferredAccess: "api",
      freshnessCheck: "versioned_publication",
      notes: "Prefer the official Act/instrument/latest compilation record over secondary summaries.",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14", notes: "Registry entry identifies the official Commonwealth legislation publisher; individual instruments still require current/in-force status checks." },
    provenance: { officialSourceUrl: "https://www.legislation.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Primary source for Commonwealth Acts, legislative instruments, compilations and official law publication.",
  },
  {
    id: "ar-au-002",
    name: "NDIS Quality and Safeguards Commission",
    organisation: "NDIS Quality and Safeguards Commission",
    officialDomain: "ndiscommission.gov.au",
    approvedDomains: ["ndiscommission.gov.au"],
    category: "regulation",
    jurisdictions: ["AU"],
    subjectAreas: ["ndis_quality_safeguards", "restrictive_practice", "behaviour_support", "provider_registration", "incident_management", "practice_standards"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "regulator",
    professionalDomains: ["NDIS_REGULATION", "RESTRICTIVE_PRACTICE", "BEHAVIOUR_SUPPORT", "INCIDENT_MANAGEMENT", "SAFEGUARDING", "SERVICE_DELIVERY", "WORKFORCE"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "GOVERNED_WEB",
    preferredTransport: "GOVERNED_WEB",
    fallbackTransport: "OFFICIAL_DOCUMENT",
    apiStatus: "NOT_AVAILABLE",
    authenticationType: "NONE",
    credentialStatus: "NOT_REQUIRED",
    approvedDocumentSources: ["https://www.ndiscommission.gov.au/"],
    versionSupport: "PARTIAL",
    effectiveDateSupport: "PARTIAL",
    historicalSupport: "PARTIAL",
    freshnessStrategy: "LAST_MODIFIED",
    applicableWorkforceDomains: ["compliance_quality", "restrictive_practice_governance", "behaviour_support_implementation", "incident_safeguarding", "policy_governance", "talent_learning"],
    retrievalPolicy: {
      mode: "official_domain_allowlist",
      preferredAccess: "html",
      freshnessCheck: "last_modified",
      notes: "Use official Commission pages and downloads; authenticated provider-portal content is outside generic web retrieval.",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.ndiscommission.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Regulator source for NDIS quality, safeguards, provider obligations, behaviour support and restrictive-practice guidance.",
  },
  {
    id: "ar-au-003",
    name: "National Disability Insurance Agency / NDIS",
    approvedDomains: ["ndis.gov.au", "dataresearch.ndis.gov.au"],
    category: "government_guidance",
    jurisdictions: ["AU"],
    subjectAreas: ["ndis_scheme", "provider_operations", "participant_funding", "plan_management", "ndis_pricing", "support_catalogue"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "government_agency",
    applicableWorkforceDomains: ["service_delivery", "operations", "finance", "policy_governance", "compliance_quality"],
    retrievalPolicy: {
      mode: "official_domain_allowlist",
      preferredAccess: "download",
      freshnessCheck: "versioned_publication",
      notes: "For pricing/support catalogues, preserve the source file, effective date and archive link.",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.ndis.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Official NDIA/NDIS source for Scheme, provider, participant, pricing and support-catalogue information.",
  },
  {
    id: "ar-au-004",
    name: "Fair Work Ombudsman",
    approvedDomains: ["fairwork.gov.au"],
    category: "government_guidance",
    jurisdictions: ["AU"],
    subjectAreas: ["employment", "workplace_relations", "pay_entitlements", "leave", "minimum_wages", "workplace_rights"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "regulator",
    applicableWorkforceDomains: ["payroll_workforce_cost", "people_culture", "workforce_compliance", "policy_governance", "talent_learning"],
    retrievalPolicy: {
      mode: "official_domain_allowlist",
      preferredAccess: "html",
      freshnessCheck: "last_modified",
      notes: "Use for official explanatory workplace guidance; do not treat as a substitute for award/Act text where primary law or awards are required.",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.fairwork.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Official workplace relations regulator guidance for Australian employers and workers.",
  },
  {
    id: "ar-au-005",
    name: "Fair Work Commission and Modern Awards Pay Database",
    organisation: "Fair Work Commission",
    officialDomain: "fwc.gov.au",
    approvedDomains: ["fwc.gov.au", "developer.fwc.gov.au"],
    category: "regulation",
    jurisdictions: ["AU"],
    subjectAreas: ["modern_awards", "award_rates", "allowances", "overtime", "penalty_rates", "enterprise_agreements", "industrial_instruments"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "mandatory",
    sourceClass: "official_industrial_instrument",
    professionalDomains: ["INDUSTRIAL_RELATIONS", "PAYROLL", "WORKFORCE"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "GOVERNED_WEB",
    preferredTransport: "API_AUTHENTICATED",
    fallbackTransport: "GOVERNED_WEB",
    apiStatus: "AVAILABLE",
    developerPortal: "https://developer.fwc.gov.au/",
    authenticationType: "ACCOUNT",
    credentialStatus: "NOT_CONFIGURED",
    approvedDocumentSources: ["https://www.fwc.gov.au/", "https://developer.fwc.gov.au/"],
    versionSupport: "SUPPORTED",
    effectiveDateSupport: "SUPPORTED",
    historicalSupport: "PARTIAL",
    freshnessStrategy: "API_CURRENTNESS",
    applicableWorkforceDomains: ["payroll_workforce_cost", "workforce_compliance", "people_culture", "policy_governance", "talent_learning"],
    retrievalPolicy: {
      mode: "api_preferred",
      preferredAccess: "api",
      freshnessCheck: "effective_date_required",
      notes: "MAPD values must be read with the relevant modern award; the award prevails over API data if inconsistent.",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://developer.fwc.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Official industrial tribunal and MAPD source for modern award instruments and pay-rate data; award coverage decisions still require professional/legal interpretation.",
  },
  {
    id: "ar-au-006",
    name: "Australian Taxation Office",
    approvedDomains: ["ato.gov.au"],
    category: "government_guidance",
    jurisdictions: ["AU"],
    subjectAreas: ["tax", "superannuation", "payg", "business_tax", "not_for_profit_tax", "fringe_benefits_tax"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "government_agency",
    applicableWorkforceDomains: ["finance", "payroll_workforce_cost", "policy_governance"],
    retrievalPolicy: {
      mode: "official_domain_allowlist",
      preferredAccess: "html",
      freshnessCheck: "last_modified",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.ato.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Official Australian tax and superannuation administration source.",
  },
  {
    id: "ar-au-007",
    name: "Office of the Australian Information Commissioner",
    approvedDomains: ["oaic.gov.au"],
    category: "government_guidance",
    jurisdictions: ["AU"],
    subjectAreas: ["privacy", "freedom_of_information", "consumer_data_right", "notifiable_data_breaches", "australian_privacy_principles"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "regulator",
    applicableWorkforceDomains: ["policy_governance", "compliance_quality", "knowledge_documentation", "operations"],
    retrievalPolicy: {
      mode: "official_domain_allowlist",
      preferredAccess: "html",
      freshnessCheck: "last_modified",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.oaic.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "National privacy, FOI and Consumer Data Right regulator source.",
  },
  {
    id: "ar-au-008",
    name: "Safe Work Australia",
    approvedDomains: ["safeworkaustralia.gov.au"],
    category: "government_guidance",
    jurisdictions: ["AU", "AU-model"],
    subjectAreas: ["work_health_safety", "model_whs_laws", "model_codes_of_practice", "workplace_safety"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "government_agency",
    applicableWorkforceDomains: ["operations", "people_culture", "workforce_compliance", "policy_governance", "compliance_quality", "talent_learning"],
    retrievalPolicy: {
      mode: "official_domain_allowlist",
      preferredAccess: "download",
      freshnessCheck: "versioned_publication",
      notes: "Model WHS material is not automatically current law in every state/territory; state regulator checks may be required.",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.safeworkaustralia.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "National policy source for model WHS laws, codes and guidance; jurisdiction implementation must be checked separately.",
  },
  {
    id: "ar-au-009",
    name: "Australian Securities and Investments Commission",
    approvedDomains: ["asic.gov.au"],
    category: "regulation",
    jurisdictions: ["AU"],
    subjectAreas: ["corporations", "companies", "business_names", "financial_services", "credit", "markets", "asic_registers"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "regulator",
    applicableWorkforceDomains: ["finance", "policy_governance", "business_operations", "compliance_quality"],
    retrievalPolicy: {
      mode: "official_domain_allowlist",
      preferredAccess: "html",
      freshnessCheck: "last_modified",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://asic.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Corporate, markets, financial services, consumer credit and registry regulator source.",
  },
  {
    id: "ar-au-010",
    name: "Australian Business Register / ABN Lookup",
    approvedDomains: ["abr.business.gov.au"],
    category: "government_guidance",
    jurisdictions: ["AU"],
    subjectAreas: ["abn", "business_register", "organisation_identity", "entity_status"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "government_agency",
    applicableWorkforceDomains: ["business_operations", "finance", "policy_governance"],
    retrievalPolicy: {
      mode: "api_preferred",
      preferredAccess: "api",
      freshnessCheck: "retrieved_at_only",
      notes: "ABN/entity status must be checked at retrieval time; retrieval date is not a substitute for business/legal advice.",
    },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://abr.business.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Official ABN/entity lookup source for organisation identity and registration status.",
  },
  {
    id: "ar-au-011",
    name: "Australian Human Rights Commission",
    organisation: "Australian Human Rights Commission",
    officialDomain: "humanrights.gov.au",
    approvedDomains: ["humanrights.gov.au"],
    category: "government_guidance",
    jurisdictions: ["AU", "AU_NATIONAL"],
    subjectAreas: ["human_rights", "discrimination", "disability_rights", "equal_opportunity"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "regulator",
    professionalDomains: ["HUMAN_RIGHTS", "WORKFORCE", "SERVICE_DELIVERY"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "GOVERNED_WEB",
    preferredTransport: "GOVERNED_WEB",
    fallbackTransport: "OFFICIAL_DOCUMENT",
    apiStatus: "NOT_AVAILABLE",
    authenticationType: "NONE",
    credentialStatus: "NOT_REQUIRED",
    approvedDocumentSources: ["https://humanrights.gov.au/"],
    versionSupport: "PARTIAL",
    effectiveDateSupport: "PARTIAL",
    historicalSupport: "PARTIAL",
    freshnessStrategy: "LAST_MODIFIED",
    applicableWorkforceDomains: ["policy_governance", "people_culture", "service_delivery", "compliance_quality", "talent_learning"],
    retrievalPolicy: { mode: "official_domain_allowlist", preferredAccess: "html", freshnessCheck: "last_modified" },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://humanrights.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "National human-rights and anti-discrimination authority source.",
  },
  {
    id: "ar-au-012",
    name: "api.gov.au",
    organisation: "Digital Transformation Agency",
    officialDomain: "api.gov.au",
    approvedDomains: ["api.gov.au"],
    category: "government_guidance",
    jurisdictions: ["AU", "AU_NATIONAL"],
    subjectAreas: ["api_discovery", "government_api_design", "technical_integration"],
    strength: "secondary",
    status: "active",
    evidenceAuthorityClass: "reference",
    sourceClass: "government_api_discovery",
    professionalDomains: ["DATA_GOVERNANCE"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "GOVERNED_WEB",
    preferredTransport: "GOVERNED_WEB",
    fallbackTransport: "NOT_AVAILABLE",
    apiStatus: "NOT_AVAILABLE",
    authenticationType: "NONE",
    credentialStatus: "NOT_REQUIRED",
    approvedDocumentSources: ["https://api.gov.au/"],
    versionSupport: "NOT_AVAILABLE",
    effectiveDateSupport: "NOT_AVAILABLE",
    historicalSupport: "NOT_AVAILABLE",
    freshnessStrategy: "RETRIEVED_AT_ONLY",
    applicableWorkforceDomains: ["technical_integration", "data_governance"],
    retrievalPolicy: { mode: "official_domain_allowlist", preferredAccess: "html", freshnessCheck: "retrieved_at_only" },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://api.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "API discovery and technical design source only; not substantive regulatory or legal authority.",
  },
  {
    id: "ar-vic-001",
    name: "Victorian Legislation",
    organisation: "Victorian Government",
    officialDomain: "legislation.vic.gov.au",
    approvedDomains: ["legislation.vic.gov.au"],
    category: "legislation",
    jurisdictions: ["VIC"],
    subjectAreas: ["victorian_legislation", "state_law", "workplace_safety", "long_service_leave", "human_rights"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "mandatory",
    sourceClass: "primary_law",
    professionalDomains: ["LEGISLATION", "WORK_HEALTH_SAFETY", "LONG_SERVICE_LEAVE", "HUMAN_RIGHTS", "WORKFORCE"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "GOVERNED_WEB",
    preferredTransport: "GOVERNED_WEB",
    fallbackTransport: "OFFICIAL_DOCUMENT",
    apiStatus: "NOT_AVAILABLE",
    authenticationType: "NONE",
    credentialStatus: "NOT_REQUIRED",
    approvedDocumentSources: ["https://www.legislation.vic.gov.au/"],
    versionSupport: "SUPPORTED",
    effectiveDateSupport: "SUPPORTED",
    historicalSupport: "SUPPORTED",
    freshnessStrategy: "VERSIONED_PUBLICATION",
    applicableWorkforceDomains: ["policy_governance", "workforce_compliance", "people_culture", "operations"],
    retrievalPolicy: { mode: "official_domain_allowlist", preferredAccess: "html", freshnessCheck: "versioned_publication" },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.legislation.vic.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Primary source for Victorian Acts, statutory rules and legislative instruments.",
  },
  {
    id: "ar-vic-002",
    name: "Victorian Senior Practitioner / DFFH",
    organisation: "Department of Families, Fairness and Housing Victoria",
    officialDomain: "dffh.vic.gov.au",
    approvedDomains: ["dffh.vic.gov.au", "providers.dffh.vic.gov.au"],
    category: "government_guidance",
    jurisdictions: ["VIC"],
    subjectAreas: ["restrictive_practice", "behaviour_support", "authorised_program_officer", "disability_services"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "state_regulator",
    professionalDomains: ["RESTRICTIVE_PRACTICE", "BEHAVIOUR_SUPPORT", "SERVICE_DELIVERY", "LEGISLATION"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "GOVERNED_WEB",
    preferredTransport: "GOVERNED_WEB",
    fallbackTransport: "OFFICIAL_DOCUMENT",
    apiStatus: "NOT_AVAILABLE",
    authenticationType: "NONE",
    credentialStatus: "NOT_REQUIRED",
    approvedDocumentSources: ["https://www.dffh.vic.gov.au/", "https://providers.dffh.vic.gov.au/"],
    versionSupport: "PARTIAL",
    effectiveDateSupport: "PARTIAL",
    historicalSupport: "PARTIAL",
    freshnessStrategy: "LAST_MODIFIED",
    applicableWorkforceDomains: ["restrictive_practice_governance", "behaviour_support_implementation", "people_culture", "policy_governance", "service_delivery"],
    retrievalPolicy: { mode: "official_domain_allowlist", preferredAccess: "html", freshnessCheck: "last_modified" },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.dffh.vic.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Victorian authority source for Senior Practitioner, restrictive-practice and behaviour-support material where applicable.",
  },
  {
    id: "ar-vic-003",
    name: "WorkSafe Victoria",
    organisation: "WorkSafe Victoria",
    officialDomain: "worksafe.vic.gov.au",
    approvedDomains: ["worksafe.vic.gov.au"],
    category: "regulation",
    jurisdictions: ["VIC"],
    subjectAreas: ["occupational_health_safety", "workplace_safety", "work_health_safety", "workers_compensation"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "state_regulator",
    professionalDomains: ["WORK_HEALTH_SAFETY", "WORKFORCE", "SERVICE_DELIVERY"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "GOVERNED_WEB",
    preferredTransport: "GOVERNED_WEB",
    fallbackTransport: "OFFICIAL_DOCUMENT",
    apiStatus: "NOT_AVAILABLE",
    authenticationType: "NONE",
    credentialStatus: "NOT_REQUIRED",
    approvedDocumentSources: ["https://www.worksafe.vic.gov.au/"],
    versionSupport: "PARTIAL",
    effectiveDateSupport: "PARTIAL",
    historicalSupport: "PARTIAL",
    freshnessStrategy: "LAST_MODIFIED",
    applicableWorkforceDomains: ["operations", "people_culture", "workforce_compliance", "policy_governance", "compliance_quality"],
    retrievalPolicy: { mode: "official_domain_allowlist", preferredAccess: "html", freshnessCheck: "last_modified" },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.worksafe.vic.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Victorian operative OHS and workplace safety regulator source.",
  },
  {
    id: "ar-vic-004",
    name: "Portable Long Service Authority Victoria",
    organisation: "Portable Long Service Authority Victoria",
    officialDomain: "plsa.vic.gov.au",
    approvedDomains: ["plsa.vic.gov.au"],
    category: "government_guidance",
    jurisdictions: ["VIC"],
    subjectAreas: ["portable_long_service_leave", "long_service_leave", "community_services"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "state_regulator",
    professionalDomains: ["LONG_SERVICE_LEAVE", "PAYROLL", "WORKFORCE", "INDUSTRIAL_RELATIONS"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "GOVERNED_WEB",
    preferredTransport: "GOVERNED_WEB",
    fallbackTransport: "OFFICIAL_DOCUMENT",
    apiStatus: "NOT_AVAILABLE",
    authenticationType: "NONE",
    credentialStatus: "NOT_REQUIRED",
    approvedDocumentSources: ["https://www.plsa.vic.gov.au/"],
    versionSupport: "PARTIAL",
    effectiveDateSupport: "PARTIAL",
    historicalSupport: "PARTIAL",
    freshnessStrategy: "LAST_MODIFIED",
    applicableWorkforceDomains: ["payroll_workforce_cost", "workforce_compliance", "people_culture"],
    retrievalPolicy: { mode: "official_domain_allowlist", preferredAccess: "html", freshnessCheck: "last_modified" },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.plsa.vic.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Victorian portable long-service-leave authority source.",
  },
  {
    id: "ar-vic-005",
    name: "Wage Inspectorate Victoria",
    organisation: "Wage Inspectorate Victoria",
    officialDomain: "wageinspectorate.vic.gov.au",
    approvedDomains: ["wageinspectorate.vic.gov.au"],
    category: "regulation",
    jurisdictions: ["VIC"],
    subjectAreas: ["wage_theft", "child_employment", "long_service_leave", "employment_obligations"],
    strength: "primary",
    status: "active",
    evidenceAuthorityClass: "primary",
    sourceClass: "state_regulator",
    professionalDomains: ["INDUSTRIAL_RELATIONS", "WORKFORCE", "PAYROLL", "LONG_SERVICE_LEAVE"],
    sourceStatus: "ACTIVE",
    verificationStatus: "VERIFIED",
    currentTransport: "GOVERNED_WEB",
    preferredTransport: "GOVERNED_WEB",
    fallbackTransport: "OFFICIAL_DOCUMENT",
    apiStatus: "NOT_AVAILABLE",
    authenticationType: "NONE",
    credentialStatus: "NOT_REQUIRED",
    approvedDocumentSources: ["https://www.wageinspectorate.vic.gov.au/"],
    versionSupport: "PARTIAL",
    effectiveDateSupport: "PARTIAL",
    historicalSupport: "PARTIAL",
    freshnessStrategy: "LAST_MODIFIED",
    applicableWorkforceDomains: ["payroll_workforce_cost", "workforce_compliance", "people_culture"],
    retrievalPolicy: { mode: "official_domain_allowlist", preferredAccess: "html", freshnessCheck: "last_modified" },
    currentness: { status: "current", verifiedAt: "2026-08-14" },
    provenance: { officialSourceUrl: "https://www.wageinspectorate.vic.gov.au/", verifiedBy: "source_registry_bootstrap", verifiedAt: "2026-08-14" },
    governanceNote: "Victorian employment enforcement authority source where state employment obligations are in scope.",
  },
];

// ─── Lookup interface ─────────────────────────────────────────────────────────

/**
 * Result of a domain lookup against the Authority Registry.
 */
export interface RegistryLookupResult {
  found: boolean;
  entry?: AuthorityRegistryEntry;
  /** Reason why this domain is rejected (when found=true but entry.status="rejected") */
  rejectionReason?: string;
}

/**
 * Look up an external source domain against the Authority Registry.
 *
 * Normalises the URL to its registered domain before matching.
 * Returns the most specific matching entry when multiple match.
 */
export function lookupAuthorityByDomain(domain: string): RegistryLookupResult {
  const normalisedDomain = normaliseDomain(domain);

  // Find all entries that approve this domain
  const matches = AUTHORITY_REGISTRY_ENTRIES.filter(e =>
    e.approvedDomains.some(d => normalisedDomain === d || normalisedDomain.endsWith(`.${d}`)),
  );

  if (matches.length === 0) {
    return { found: false };
  }

  // Prefer entries with rejected status (fail closed)
  const rejected = matches.find(e => e.status === "rejected");
  if (rejected) {
    return {
      found: true,
      entry: rejected,
      rejectionReason: `Domain "${domain}" is on the Authority Registry rejected list`,
    };
  }

  // Among active entries, prefer more specific domains
  const active = matches.filter(e => e.status === "active" || e.status === "requires_review");
  if (active.length === 0) {
    return { found: false };
  }

  // Most specific match = longest matching domain string
  active.sort((a, b) => {
    const aLen = Math.max(...a.approvedDomains.map(d => d.length));
    const bLen = Math.max(...b.approvedDomains.map(d => d.length));
    return bLen - aLen;
  });

  return { found: true, entry: active[0] };
}

/**
 * Look up an authority registry entry by its stable ID.
 */
export function lookupAuthorityById(id: string): AuthorityRegistryEntry | null {
  return AUTHORITY_REGISTRY_ENTRIES.find(e => e.id === id) ?? null;
}

/**
 * Returns all active registry entries for a given authority category.
 */
export function getEntriesByCategory(category: AuthorityCategory): AuthorityRegistryEntry[] {
  return AUTHORITY_REGISTRY_ENTRIES.filter(e => e.category === category && e.status === "active");
}

/**
 * Returns all active entries that cover a given jurisdiction.
 * Includes entries with jurisdiction "GLOBAL".
 */
export function getEntriesByJurisdiction(jurisdiction: string): AuthorityRegistryEntry[] {
  return AUTHORITY_REGISTRY_ENTRIES.filter(
    e =>
      e.status === "active" &&
      (e.jurisdictions.includes("GLOBAL") || e.jurisdictions.includes(jurisdiction)),
  );
}

export interface AuthorityRankingContext {
  jurisdiction?: string;
  subjectArea?: string;
  workforceDomain?: string;
  professionalDomain?: ProfessionalDomain;
  requiredAuthorityClass?: AuthoritySourceClass;
  preferredAuthorityClass?: AuthoritySourceClass;
  requireCurrent?: boolean;
  allowHistorical?: boolean;
  internalEvidenceRequired?: boolean;
  externalEvidenceRequired?: boolean;
}

const AUTHORITY_CLASS_RANK: Record<AuthoritySourceClass, number> = {
  primary_law: 100,
  legislative_instrument: 98,
  official_industrial_instrument: 95,
  regulator: 90,
  state_regulator: 90,
  government_agency: 80,
  official_government_guidance: 75,
  accredited_professional_standard: 65,
  government_api_discovery: 15,
  organisation_approved_internal_source: 60,
  secondary_professional_source: 40,
  general_web_source: 10,
  user_provided_source: 5,
  memory: 3,
  sample_example: 1,
};

const EVIDENCE_CLASS_RANK: Record<AuthorityRegistryEntry["evidenceAuthorityClass"], number> = {
  mandatory: 40,
  primary: 30,
  supporting: 15,
  reference: 5,
};

function matchesJurisdiction(entry: AuthorityRegistryEntry, jurisdiction?: string): boolean {
  if (!jurisdiction) return true;
  const stateJurisdictions = ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "ACT", "NT"];
  return entry.jurisdictions.includes("GLOBAL") ||
    entry.jurisdictions.includes(jurisdiction) ||
    (["AU_NATIONAL", "AU_COMMONWEALTH"].includes(jurisdiction) && (entry.jurisdictions.includes("AU") || entry.jurisdictions.includes("AU-Federal"))) ||
    (stateJurisdictions.includes(jurisdiction) && (entry.jurisdictions.includes("AU") || entry.jurisdictions.includes("AU_NATIONAL"))) ||
    (jurisdiction.startsWith("AU-") && entry.jurisdictions.includes("AU"));
}

function matchesSubjectArea(entry: AuthorityRegistryEntry, subjectArea?: string): boolean {
  if (!subjectArea) return true;
  return entry.subjectAreas.includes(subjectArea);
}

function matchesWorkforceDomain(entry: AuthorityRegistryEntry, workforceDomain?: string): boolean {
  if (!workforceDomain) return true;
  const domains = entry.applicableWorkforceDomains ?? [];
  return domains.length === 0 || domains.includes(workforceDomain);
}

function matchesProfessionalDomain(entry: AuthorityRegistryEntry, professionalDomain?: ProfessionalDomain): boolean {
  if (!professionalDomain) return true;
  const domains = entry.professionalDomains ?? [];
  return domains.includes(professionalDomain);
}

/**
 * Domain-specific authority score. This deliberately separates evidence
 * authority from execution authority and never promotes a generic web result.
 */
export function scoreAuthorityForContext(
  entry: AuthorityRegistryEntry,
  context: AuthorityRankingContext = {},
): number {
  if (entry.status !== "active") return 0;

  const sourceClass = entry.sourceClass ?? (
    entry.category === "legislation" ? "primary_law" :
    entry.category === "standard" ? "accredited_professional_standard" :
    entry.category === "government_guidance" ? "official_government_guidance" :
    "regulator"
  );

  let score = (AUTHORITY_CLASS_RANK[sourceClass] ?? 0) +
    (EVIDENCE_CLASS_RANK[entry.evidenceAuthorityClass] ?? 0);

  if (entry.strength === "primary") score += 10;
  if (matchesJurisdiction(entry, context.jurisdiction)) score += 20;
  else score -= 50;

  if (matchesSubjectArea(entry, context.subjectArea)) score += 20;
  else score -= 60;

  if (matchesWorkforceDomain(entry, context.workforceDomain)) score += 10;
  else score -= 30;

  if (matchesProfessionalDomain(entry, context.professionalDomain)) score += 25;
  else score -= 70;

  if (context.requiredAuthorityClass && sourceClass !== context.requiredAuthorityClass) score -= 100;
  if (context.preferredAuthorityClass && sourceClass === context.preferredAuthorityClass) score += 25;
  if (
    context.professionalDomain &&
    context.professionalDomain !== "LEGISLATION" &&
    ["regulator", "state_regulator", "official_government_guidance"].includes(sourceClass)
  ) {
    score += 25;
  }

  if (entry.currentness?.status && entry.currentness.status !== "current") score -= 100;
  if (context.requireCurrent && entry.currentness?.status !== "current") score -= 100;

  return Math.max(score, 0);
}

export function findAuthoritiesForContext(
  context: AuthorityRankingContext = {},
): AuthorityRegistryEntry[] {
  return AUTHORITY_REGISTRY_ENTRIES
    .filter(entry => entry.status === "active")
    .map(entry => ({ entry, score: scoreAuthorityForContext(entry, context) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .map(({ entry }) => entry);
}

export function getAuthorityRegistryEntries(): AuthorityRegistryEntry[] {
  return [...AUTHORITY_REGISTRY_ENTRIES];
}

export interface EvidenceRequirement {
  domain?: ProfessionalDomain;
  subject?: string;
  jurisdiction?: AuthorityJurisdiction;
  requiredAuthorityClass?: AuthoritySourceClass;
  preferredAuthorityClass?: AuthoritySourceClass;
  currentnessRequirement?: "CURRENT_REQUIRED" | "CURRENT_PREFERRED" | "UNKNOWN_ALLOWED";
  historicalEvidenceAllowed?: boolean;
  internalEvidenceRequired?: boolean;
  externalEvidenceRequired?: boolean;
}

export interface AuthorityResolution {
  source: AuthorityRegistryEntry;
  score: number;
  selectedTransport: AuthorityTransport;
  fallbackTransport?: AuthorityTransport;
  currentness: AuthorityCurrentnessStatus | "unknown";
  reason: string;
}

export function resolveAuthoritiesForRequirement(
  requirement: EvidenceRequirement,
  limit = 5,
): AuthorityResolution[] {
  const requireCurrent = requirement.currentnessRequirement === "CURRENT_REQUIRED";
  return AUTHORITY_REGISTRY_ENTRIES
    .filter(entry => entry.status === "active")
    .filter(entry => !requirement.externalEvidenceRequired || entry.currentTransport !== "INTERNAL_KRS")
    .filter(entry => matchesJurisdiction(entry, requirement.jurisdiction))
    .filter(entry => matchesProfessionalDomain(entry, requirement.domain))
    .filter(entry => matchesSubjectArea(entry, requirement.subject))
    .map(source => {
      const score = scoreAuthorityForContext(source, {
        jurisdiction:             requirement.jurisdiction,
        subjectArea:              requirement.subject,
        professionalDomain:       requirement.domain,
        requiredAuthorityClass:   requirement.requiredAuthorityClass,
        preferredAuthorityClass:  requirement.preferredAuthorityClass,
        requireCurrent,
        allowHistorical:          requirement.historicalEvidenceAllowed,
        internalEvidenceRequired: requirement.internalEvidenceRequired,
        externalEvidenceRequired: requirement.externalEvidenceRequired,
      });
      const selectedTransport = selectTransport(source);
      const reason = [
        requirement.domain ? `domain:${requirement.domain}` : null,
        requirement.subject ? `subject:${requirement.subject}` : null,
        requirement.jurisdiction ? `jurisdiction:${requirement.jurisdiction}` : null,
        `transport:${selectedTransport}`,
      ].filter(Boolean).join(" ");
      const currentness: AuthorityCurrentnessStatus | "unknown" = source.currentness?.status ?? "unknown";
      return {
        source,
        score,
        selectedTransport,
        fallbackTransport: source.fallbackTransport,
        currentness,
        reason,
      };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
    .slice(0, limit);
}

function selectTransport(entry: AuthorityRegistryEntry): AuthorityTransport {
  if (
    entry.preferredTransport?.startsWith("API_") &&
    entry.credentialStatus &&
    !["NOT_REQUIRED", "CONFIGURED"].includes(entry.credentialStatus)
  ) {
    return entry.fallbackTransport ?? "NOT_CONFIGURED";
  }
  return entry.preferredTransport ?? entry.currentTransport ?? "GOVERNED_WEB";
}

export interface GovernedWebValidationResult {
  ok: boolean;
  authority?: AuthorityRegistryEntry;
  reason?: string;
}

export function validateGovernedWebUrl(url: string, authorityId?: string): GovernedWebValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }

  if (parsed.protocol !== "https:") return { ok: false, reason: "HTTPS_REQUIRED" };
  if (isPrivateOrLocalHostname(parsed.hostname)) return { ok: false, reason: "PRIVATE_NETWORK_BLOCKED" };

  const authority = authorityId ? lookupAuthorityById(authorityId) : isApprovedExternalSource(url);
  if (!authority) return { ok: false, reason: "AUTHORITY_UNKNOWN" };
  if (authority.currentTransport !== "GOVERNED_WEB" && authority.fallbackTransport !== "GOVERNED_WEB") {
    return { ok: false, authority, reason: "GOVERNED_WEB_NOT_APPROVED_FOR_AUTHORITY" };
  }

  const normalisedDomain = normaliseDomain(parsed.hostname);
  const approved = authority.approvedDomains.some(d => normalisedDomain === d || normalisedDomain.endsWith(`.${d}`));
  if (!approved) return { ok: false, authority, reason: "DOMAIN_NOT_APPROVED_FOR_AUTHORITY" };
  return { ok: true, authority };
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === "::1" || host === "[::1]") return true;
  return false;
}

/**
 * Extract and normalise the registered domain from a URL or raw domain string.
 * Strips protocol, www prefix, trailing slashes, and path components.
 */
export function normaliseDomain(input: string): string {
  try {
    let url = input.trim();
    if (!url.includes("://")) url = "https://" + url;
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return input.toLowerCase().replace(/^www\./, "").split("/")[0] ?? input.toLowerCase();
  }
}

/**
 * Check whether a URL belongs to an active, trusted external authority.
 * Returns the registry entry if found and active, null otherwise.
 */
export function isApprovedExternalSource(url: string): AuthorityRegistryEntry | null {
  let domain: string;
  try {
    domain = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const result = lookupAuthorityByDomain(domain);
  if (!result.found || !result.entry) return null;
  if (result.entry.status !== "active") return null;
  return result.entry;
}

/**
 * Total number of entries in the registry (useful for tests and diagnostics).
 */
export function getRegistryEntryCount(): number {
  return AUTHORITY_REGISTRY_ENTRIES.length;
}
