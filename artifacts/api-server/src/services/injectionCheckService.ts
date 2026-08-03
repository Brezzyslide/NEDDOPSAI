/**
 * Knowledge Hub — Injection Check Service
 *
 * Ingestion-time analysis for prompt-injection and document-poisoning patterns.
 *
 * This is a DETECTION-ONLY service:
 *   - Flags suspicious content; never silently rewrites it
 *   - Flags are stored on the ingestion job and require human review
 *   - Flagged sources CANNOT auto-approve (checked by ingestion pipeline)
 *   - Does not claim detection is perfect (heuristic patterns only)
 *
 * Task #17 will add runtime retrieval protections.
 *
 * Security:
 *   - Never logs the matched text content
 *   - Log messages contain only flag count and severity, no document content
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type InjectionSeverity = "low" | "medium" | "high";

export interface InjectionFlag {
  /** Machine-readable pattern identifier */
  patternId: string;
  /** Short description (no raw document content) */
  description: string;
  /** Severity — high flags block auto-approval */
  severity: InjectionSeverity;
  /** Zero-based chunk index where the match occurred */
  chunkIndex: number;
  /** Approximate position in the chunk text (character offset) */
  matchOffset: number;
}

export interface InjectionCheckResult {
  /** True if any high-severity flags were detected */
  requiresHumanReview: boolean;
  flags: InjectionFlag[];
  /** Number of high-severity flags */
  highCount: number;
  /** Number of medium-severity flags */
  mediumCount: number;
  /** Number of low-severity flags */
  lowCount: number;
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

interface Pattern {
  id: string;
  description: string;
  severity: InjectionSeverity;
  pattern: RegExp;
}

const INJECTION_PATTERNS: Pattern[] = [
  // Direct instruction override attempts
  {
    id: "IGNORE_PREVIOUS",
    description: "Document instructs the model to ignore previous instructions.",
    severity: "high",
    pattern: /ignore\s+(previous|prior|all|the\s+above)\s+instructions?/i,
  },
  {
    id: "DISREGARD_SYSTEM",
    description: "Document attempts to disregard system prompt or context.",
    severity: "high",
    pattern: /disregard\s+(the\s+)?system\s*(prompt|instructions?|context|message)?/i,
  },
  {
    id: "NEW_INSTRUCTIONS",
    description: "Document contains instruction-like override attempt.",
    severity: "high",
    pattern: /new\s+instructions?:?\s*you\s+(are|must|should|will)\s+(now|always|never)/i,
  },
  // Data exfiltration attempts
  {
    id: "SEND_DATA_TO",
    description: "Document instructs model to send data to an external destination.",
    severity: "high",
    pattern: /send\s+(this|the|all|your|my)\s+(data|information|content|text|conversation)\s+to/i,
  },
  {
    id: "REVEAL_SECRETS",
    description: "Document attempts to reveal secrets, API keys, or credentials.",
    severity: "high",
    pattern: /reveal\s+(your\s+)?(api\s+key|secret|password|token|credentials?|system\s+prompt)/i,
  },
  {
    id: "EXFILTRATE",
    description: "Document contains data exfiltration language.",
    severity: "high",
    pattern: /exfiltrat(e|ing|ion)|leak\s+(all|the|this)\s+(data|context|prompt)/i,
  },
  // System prompt probing
  {
    id: "PRINT_SYSTEM_PROMPT",
    description: "Document asks model to print or output its system prompt.",
    severity: "high",
    pattern: /print\s+(your\s+)?(full\s+)?(system|initial|base)\s+prompt/i,
  },
  {
    id: "WHAT_ARE_YOUR_INSTRUCTIONS",
    description: "Document probes the model for its instructions.",
    severity: "medium",
    pattern: /what\s+(are|were)\s+(your|the)\s+(original\s+)?(instructions?|rules?|directives?)/i,
  },
  // Hidden text / unusual encoding
  {
    id: "ZERO_WIDTH_CHARS",
    description: "Document contains zero-width or invisible characters that may hide content.",
    severity: "medium",
    pattern: /[\u200B-\u200D\uFEFF\u00AD]/,
  },
  // Role manipulation
  {
    id: "YOU_ARE_NOW",
    description: "Document attempts to redefine the AI's role or persona.",
    severity: "high",
    pattern: /you\s+are\s+now\s+(a\s+)?(new\s+)?(ai|assistant|gpt|claude|model|bot|persona)/i,
  },
  {
    id: "ROLE_PLAY_JAILBREAK",
    description: "Document uses role-play framing to bypass restrictions.",
    severity: "medium",
    pattern: /pretend\s+(you\s+are|to\s+be)\s+(an?\s+)?(ai|assistant|model|bot)\s+without\s+(restrictions?|limits?|filters?)/i,
  },
  // Suspicious URL/callback patterns
  {
    id: "WEBHOOK_CALLBACK",
    description: "Document contains a suspicious webhook or callback URL pattern.",
    severity: "medium",
    pattern: /https?:\/\/[^\s]{10,}\/(webhook|callback|collect|steal|exfil|receive)/i,
  },
];

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Scan an array of chunk texts for prompt injection and document poisoning patterns.
 *
 * @param chunks Array of { text: string } objects (zero-based index by position)
 * @returns InjectionCheckResult with flags and review requirement
 */
export function scanForInjection(
  chunks: Array<{ text: string }>,
): InjectionCheckResult {
  const flags: InjectionFlag[] = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunkText = chunks[chunkIndex].text;

    for (const p of INJECTION_PATTERNS) {
      p.pattern.lastIndex = 0; // reset global regex state
      const match = p.pattern.exec(chunkText);
      if (match) {
        flags.push({
          patternId: p.id,
          description: p.description,
          severity: p.severity,
          chunkIndex,
          matchOffset: match.index,
        });
      }
    }
  }

  const highCount   = flags.filter((f) => f.severity === "high").length;
  const mediumCount = flags.filter((f) => f.severity === "medium").length;
  const lowCount    = flags.filter((f) => f.severity === "low").length;

  return {
    requiresHumanReview: highCount > 0,
    flags,
    highCount,
    mediumCount,
    lowCount,
  };
}

/** Returns true if a source with these flags may auto-approve (no high flags). */
export function canAutoApprove(result: InjectionCheckResult): boolean {
  return !result.requiresHumanReview;
}
