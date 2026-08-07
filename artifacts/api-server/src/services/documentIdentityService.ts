/**
 * Document Identity Service — Sprint 29G.1
 *
 * Derives and stores canonical document identity so documents can be found
 * by what they ARE, not merely by what the uploaded file was named.
 *
 * Three concerns:
 *   1. cleanFilenameTitle()          — strips filename artefacts from machine-style names
 *   2. deriveCanonicalTitle()        — priority-ordered extraction (explicit > chunks > filename)
 *   3. deriveSearchAliases()         — generates searchable variant names
 *   4. isSourceEligible()            — shared retrieval eligibility predicate (KRS + presence)
 *   5. scoreMultiSignal()            — scores a source across all identity fields
 *
 * The shared eligibility predicate resolves the historical KRS / presence service
 * divergence where:
 *   - KRS filtered: ks.status = 'approved' AND ks.is_current = true
 *   - Presence filtered: status === "approved" && approvedByUserId !== null
 *
 * approved_by_user_id is NOT a retrieval requirement. System-approved sources
 * (automated workflows, platform ingestion, task uploads) are valid evidence sources.
 * Only `status`, `isCurrent`, and `deletedAt` gate eligibility.
 */

// ─── Filename cleaning ─────────────────────────────────────────────────────────

const SKIP_WORDS = new Set(["and", "or", "of", "in", "on", "at", "to", "for", "a", "an", "the", "by", "with"]);

function toTitleCase(str: string): string {
  return str
    .split(" ")
    .filter(w => w.length > 0)
    .map((word, i) => {
      // Preserve org-name/brand identifiers containing & (e.g. "MH&R", "S&P")
      if (/^[A-Z][A-Z&]+[A-Z]$/.test(word) && word.includes("&")) return word;
      // Preserve short acronyms (2–4 chars, all-caps) that aren't common words
      // Capped at 4 so regular words typed in all-caps (POLICY, MANUAL) get title-cased.
      const lower = word.toLowerCase();
      if (/^[A-Z]{2,4}$/.test(word) && !SKIP_WORDS.has(lower)) return word;
      return (i === 0 || !SKIP_WORDS.has(lower))
        ? lower[0].toUpperCase() + lower.slice(1)
        : lower;
    })
    .join(" ");
}

/**
 * Clean a filename-style string into a human-readable title.
 *
 * MH&R_Policy_current_2026.docx  →  "MH&R Policy"
 * Incident_Management_SOP_v2.pdf →  "Incident Management SOP"
 */
export function cleanFilenameTitle(raw: string): string {
  // Remove file extension
  const withoutExt = raw.replace(/\.[a-zA-Z0-9]{1,10}$/, "");
  // Replace underscores and hyphens with spaces
  const spaced = withoutExt.replace(/[_-]+/g, " ");
  // Remove common context words and date patterns that add noise
  const withoutNoise = spaced
    .replace(/\b(19|20)\d{2}\b/g, "")          // years
    .replace(/\bQ[1-4]\b/gi, "")               // Q1-Q4
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/gi, "")
    .replace(/\bv\d+(\.\d+)*\b/gi, "")         // version tags
    .replace(/\b(current|latest|final|draft|rev\d*|updated|approved|new)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return toTitleCase(withoutNoise);
}

/**
 * Returns true if the string looks like a machine-generated filename
 * (underscores, year patterns, no spaces, file extension).
 */
export function isFilenameLike(title: string): boolean {
  if (!title) return false;
  if (/[_]/.test(title))               return true;  // underscores as word separators
  if (/\b(19|20)\d{2}\b/.test(title))  return true;  // year suffix
  if (/\.[a-zA-Z]{2,5}$/.test(title))  return true;  // file extension
  if (/^[A-Za-z0-9&]+$/.test(title) && title.length > 8) return true; // no spaces, camelCase-ish
  return false;
}

// ─── Canonical title extraction from chunks ───────────────────────────────────

/**
 * Extract a canonical document title from the first few chunks.
 *
 * Looks for:
 *   1. Non-null sectionTitle on the first chunks (short, looks like a title)
 *   2. __BOLD__ pattern in the first chunk text (from DOCX extraction)
 *   3. # Markdown heading in the first chunk text
 */
export function extractCanonicalTitleFromChunks(
  chunks: Array<{ sectionTitle?: string | null; text: string; chunkIndex: number }>,
): string | null {
  const first5 = chunks.slice(0, 5);

  // Priority 1: first non-null sectionTitle that looks like a document title
  for (const chunk of first5) {
    if (!chunk.sectionTitle) continue;
    const cleaned = chunk.sectionTitle.replace(/^\d+\.?\s*/, "").trim();
    if (cleaned.length >= 4 && cleaned.split(" ").length <= 12 && !cleaned.startsWith("#")) {
      return toTitleCase(cleaned);
    }
  }

  // Priority 2: scan first chunk for __HEADING__ bold pattern (DOCX)
  if (chunks.length > 0) {
    const text = chunks[0].text;

    // Collect all __text__ patterns, find the best title candidate
    const boldMatches = [...text.matchAll(/__([^_\n]{4,80})__/g)];
    for (const m of boldMatches) {
      const candidate = m[1].trim();
      // Skip org-identifier lines: contains ABN, ACN, Pty Ltd, Holdings, T/A, or pure digits
      if (/ABN|ACN|T\/A|PTY\s+LTD|HOLDINGS|INCORPORATED|INC\.|[0-9]{6,}/i.test(candidate)) continue;
      // Skip very short or suspiciously long candidates
      if (candidate.length < 4 || candidate.length > 100) continue;
      // Looks like a document heading
      return toTitleCase(candidate);
    }

    // Priority 3: Markdown # heading
    const headingMatch = text.match(/^#{1,3}\s+(.{4,80})/m);
    if (headingMatch) return toTitleCase(headingMatch[1].trim());
  }

  return null;
}

/**
 * Determine canonical title from all available signals.
 *
 * Priority:
 *   1. Explicit human title (if it doesn't look like a filename)
 *   2. Content extraction from chunks (document headings)
 *   3. Cleaned filename (strip noise from originalFileName)
 *   4. Cleaned title (when title is filename-style)
 */
export function deriveCanonicalTitle(input: {
  explicitTitle?: string | null;
  originalFileName?: string | null;
  chunks?: Array<{ sectionTitle?: string | null; text: string; chunkIndex: number }>;
}): string | null {
  const { explicitTitle, originalFileName, chunks } = input;

  // 1. Explicit title that reads as a real title (not a filename)
  if (explicitTitle && !isFilenameLike(explicitTitle)) {
    return explicitTitle;
  }

  // 2. Extract from content (first headings from indexed chunks)
  if (chunks && chunks.length > 0) {
    const fromChunks = extractCanonicalTitleFromChunks(chunks);
    if (fromChunks) return fromChunks;
  }

  // 3. Clean the original filename
  if (originalFileName) {
    const cleaned = cleanFilenameTitle(originalFileName);
    if (cleaned && cleaned.length > 2) return cleaned;
  }

  // 4. Clean the title itself (it may be filename-style)
  if (explicitTitle) {
    const cleaned = cleanFilenameTitle(explicitTitle);
    if (cleaned && cleaned.length > 2) return cleaned;
  }

  return null;
}

// ─── Alias derivation ─────────────────────────────────────────────────────────

const DOC_TYPE_SYNONYMS: Record<string, string[]> = {
  policy:    ["Procedure", "Guideline", "Standard", "Protocol"],
  procedure: ["Policy", "Guideline", "Process", "SOP"],
  manual:    ["Policy", "Guideline", "Handbook", "Guide"],
  guideline: ["Policy", "Procedure", "Standard"],
  standard:  ["Policy", "Procedure", "Framework"],
  framework: ["Policy", "Standard", "Guideline"],
  handbook:  ["Manual", "Guide"],
  guide:     ["Manual", "Handbook"],
  sop:       ["Policy", "Procedure", "Protocol"],
  plan:      ["Policy", "Strategy", "Framework"],
};

/**
 * Derive searchable alias names for a document.
 *
 * Returns up to ~6 alternative names that presence queries can search against.
 * Aliases bridge: type synonyms, shortened names, cleaned filename variants.
 */
export function deriveSearchAliases(input: {
  canonicalTitle: string | null;
  originalFileName?: string | null;
  sourceType: string;
}): string[] {
  const aliases = new Set<string>();
  const { canonicalTitle, originalFileName, sourceType } = input;

  if (canonicalTitle) {
    const words = canonicalTitle.trim().split(/\s+/);
    const lastWord = words.at(-1)?.toLowerCase() ?? "";

    // Type-word synonym variants (e.g. "Policy" → "Procedure", "Guidelines")
    const synonyms = DOC_TYPE_SYNONYMS[lastWord] ?? [];
    for (const syn of synonyms) {
      const variant = [...words.slice(0, -1), syn].join(" ");
      if (variant !== canonicalTitle && variant.length > 3) aliases.add(variant);
    }

    // Shortened alias: first 3 words for longer titles
    if (words.length > 3) {
      aliases.add(words.slice(0, 3).join(" "));
    }

    // Two-word lead alias
    if (words.length > 2) {
      aliases.add(words.slice(0, 2).join(" "));
    }
  }

  // Cleaned filename as alias when different from canonical
  if (originalFileName) {
    const cleaned = cleanFilenameTitle(originalFileName);
    if (cleaned && cleaned !== canonicalTitle && cleaned.length > 3) {
      aliases.add(cleaned);
    }
  }

  return Array.from(aliases)
    .filter(a => a.length > 3)
    .slice(0, 8);
}

// ─── Shared eligibility predicate ─────────────────────────────────────────────

/**
 * Shared source eligibility predicate.
 *
 * A source is retrievable by specialists when:
 *   - status === "approved"     (KRS: ks.status = 'approved')
 *   - isCurrent === true        (KRS: ks.is_current = true)
 *   - deletedAt is null         (KRS: kc.deleted_at IS NULL)
 *
 * NOTE: approved_by_user_id is intentionally NOT required.
 *   - System-approved sources (automated workflows, task uploads) have NULL actor.
 *   - KRS does not check approved_by_user_id and has always retrieved these.
 *   - The previous presence-service-only restriction caused the KRS / presence divergence
 *     reported in the Sprint 29G forensic investigation.
 *
 * This predicate is the single source of truth for retrieval eligibility.
 * Both presence service and KRS must use it (or its equivalent SQL).
 */
export function isSourceEligible(source: {
  status: string;
  isCurrent: boolean;
  deletedAt?: Date | null;
}): boolean {
  return source.status === "approved"
    && source.isCurrent === true
    && !source.deletedAt;
}

// ─── Multi-signal confidence scoring ──────────────────────────────────────────

/** Which field produced the best match */
export type MatchSignal = "canonical_title" | "alias" | "title" | "original_file_name" | "type_only";

export interface MultiSignalScore {
  confidence: number;
  signal: MatchSignal;
}

/**
 * Score a document against search terms across ALL identity fields.
 *
 * Fields checked in priority order:
 *   canonical_title > aliases > title > original_file_name
 *
 * Returns the best (highest) score across all signals.
 */
export function scoreMultiSignal(
  source: {
    title: string;
    canonicalTitle?: string | null;
    searchAliases?: string[] | null;
    originalFileName?: string | null;
    sourceType?: string | null;
  },
  originalTerms: string[],
): MultiSignalScore {
  const candidates: Array<{ text: string; signal: MatchSignal }> = [];

  if (source.canonicalTitle) {
    candidates.push({ text: source.canonicalTitle, signal: "canonical_title" });
  }
  if (source.searchAliases && source.searchAliases.length > 0) {
    for (const alias of source.searchAliases) {
      candidates.push({ text: alias, signal: "alias" });
    }
  }
  candidates.push({ text: source.title, signal: "title" });
  if (source.originalFileName) {
    candidates.push({ text: source.originalFileName, signal: "original_file_name" });
  }

  let best: MultiSignalScore = { confidence: 0, signal: "title" };

  for (const { text, signal } of candidates) {
    const score = scoreOneTitleVsTerms(text, originalTerms);
    if (score > best.confidence) {
      best = { confidence: score, signal };
    }
  }

  return best;
}

/**
 * Score a single title string against a list of search terms.
 * Same scoring logic as the legacy scoreMatch function.
 */
function scoreOneTitleVsTerms(sourceTitle: string, originalTerms: string[]): number {
  const titleLower = sourceTitle.toLowerCase().trim();
  let best = 0;

  for (const term of originalTerms) {
    const termLower = term.toLowerCase().trim();

    if (titleLower === termLower) return 1.0;

    if (titleLower.includes(termLower)) {
      best = Math.max(best, 0.90);
      continue;
    }

    const termWords = termLower.split(/\s+/).filter(w => w.length > 2);
    if (termWords.length === 0) continue;

    const titleTokens = new Set(
      titleLower.split(/[\s\-_/,.()+[\]]+/).filter(w => w.length > 0),
    );

    const matchedCount = termWords.filter(
      w => titleTokens.has(w) || titleLower.includes(w),
    ).length;

    const ratio = matchedCount / termWords.length;

    if      (ratio >= 1.0) best = Math.max(best, 0.85);
    else if (ratio >= 0.6) best = Math.max(best, 0.65);
    else if (ratio >= 0.3) best = Math.max(best, 0.45);
  }

  return best;
}

/**
 * Extract document type words from search terms.
 * Used to find type-matched possible candidates when direct search returns nothing.
 */
export function extractTypeWordsFromTerms(terms: string[]): string[] {
  const TYPE_WORDS = new Set([
    "policy", "policies", "procedure", "procedures", "sop", "manual", "manuals",
    "guideline", "guidelines", "standard", "standards", "framework", "frameworks",
    "protocol", "protocols", "handbook", "handbooks", "guide", "guides",
    "plan", "plans", "charter", "contract", "contracts", "playbook", "playbooks",
    "procedure", "form", "forms", "template", "templates",
  ]);

  const found = new Set<string>();
  for (const term of terms) {
    for (const word of term.toLowerCase().split(/\s+/)) {
      if (TYPE_WORDS.has(word)) found.add(word);
    }
  }
  return Array.from(found);
}
