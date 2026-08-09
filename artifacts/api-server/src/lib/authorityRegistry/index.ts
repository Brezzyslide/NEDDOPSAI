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

/**
 * A single entry in the Authority Registry.
 * Each entry represents a trusted publisher/domain with specific scope.
 */
export interface AuthorityRegistryEntry {
  /** Stable identifier for this entry — never changes once published */
  id: string;
  /** Human-readable name of the authority */
  name: string;
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
  status: "active" | "rejected" | "requires_review";
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
