/**
 * Conversation Learning Service — Sprint 21 (Part 5)
 *
 * Detects candidate organisational knowledge during conversations and
 * proposes memory entries for human review.
 *
 * GOVERNANCE RULES:
 *   - Proposals only. Memory is NEVER activated automatically.
 *   - Only fires when confidence ≥ 0.65.
 *   - Called fire-and-forget after each CoS response (never blocks the conversation).
 *   - Duplicate suppression: same pattern + org within 24 h is skipped.
 *
 * Examples of detectable patterns:
 *   "We call them participants."                → terminology
 *   "Our approval limit is $5,000."             → approval_rule
 *   "We never email incident reports externally."→ operating_preference
 *   "Reports go to the Operations Manager."     → reporting_line
 */

import { randomUUID }            from "crypto";
import { db, withSystemTenantContext } from "@workspace/db";
import { organisationMemoryTable } from "@workspace/db";
import { eq, and, gte, like }    from "drizzle-orm";
import {
  proposeOrganisationMemory,
  type MemoryType,
}                                from "./organisationMemoryService.js";
import { logOrgEvent }           from "./auditService.js";

type DbClient = typeof db;

function withConversationLearningTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "conversation_learning_service", purpose },
    fn,
  );
}

// ─── Pattern registry ─────────────────────────────────────────────────────────

interface LearningPattern {
  regex:      RegExp;
  memoryType: MemoryType;
  confidence: number;
  importance: number;
  titleFn:    (match: RegExpMatchArray) => string;
  summaryFn:  (match: RegExpMatchArray) => string;
}

const LEARNING_PATTERNS: LearningPattern[] = [
  // Explicit terminology declarations
  {
    regex:      /(?:we|our organisation|the organisation)\s+call(?:s)?\s+(?:them|our|the|it)?\s*["']?([^"'.,\n]{3,60})["']?/gi,
    memoryType: "terminology",
    confidence: 0.80,
    importance: 6,
    titleFn:    m => `Terminology: ${m[1].trim().slice(0, 60)}`,
    summaryFn:  m => `The organisation uses the term: "${m[1].trim()}"`,
  },
  {
    regex:      /(?:we|our organisation)\s+(?:refer to|use the (?:term|word))\s+["']?([^"'.,\n]{3,60})["']?/gi,
    memoryType: "terminology",
    confidence: 0.78,
    importance: 6,
    titleFn:    m => `Terminology: ${m[1].trim().slice(0, 60)}`,
    summaryFn:  m => `Preferred term: "${m[1].trim()}"`,
  },
  // Approval limits
  {
    regex:      /our\s+(?:approval\s+)?limit\s+(?:is|of)\s+\$?([\d,]+(?:\.\d{2})?)/gi,
    memoryType: "approval_rule",
    confidence: 0.85,
    importance: 8,
    titleFn:    m => `Approval limit: $${m[1]}`,
    summaryFn:  m => `Financial approval limit is $${m[1]}`,
  },
  {
    regex:      /(?:anything|amounts?|purchases?)\s+(?:over|above|exceeding)\s+\$?([\d,]+(?:\.\d{2})?)\s+(?:requires?|needs?|must have)/gi,
    memoryType: "approval_rule",
    confidence: 0.82,
    importance: 8,
    titleFn:    m => `Approval threshold: $${m[1]}`,
    summaryFn:  m => `Amounts above $${m[1]} require approval`,
  },
  // Operating preferences ("we never/always")
  {
    regex:      /we\s+(?:never|don't|do not)\s+([^.,\n]{5,120})/gi,
    memoryType: "operating_preference",
    confidence: 0.75,
    importance: 7,
    titleFn:    m => `Policy: never ${m[1].trim().slice(0, 50)}`,
    summaryFn:  m => `The organisation never ${m[1].trim()}`,
  },
  {
    regex:      /we\s+always\s+([^.,\n]{5,120})/gi,
    memoryType: "operating_preference",
    confidence: 0.72,
    importance: 6,
    titleFn:    m => `Practice: always ${m[1].trim().slice(0, 50)}`,
    summaryFn:  m => `The organisation always ${m[1].trim()}`,
  },
  // Reporting lines / escalation
  {
    regex:      /(?:report(?:s)?|escalate(?:s)?)\s+(?:directly\s+)?to\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4})/g,
    memoryType: "reporting_line",
    confidence: 0.70,
    importance: 6,
    titleFn:    m => `Escalation path: ${m[1].trim()}`,
    summaryFn:  m => `Escalation/reporting goes to ${m[1].trim()}`,
  },
  // Policy statements
  {
    regex:      /our\s+(?:policy|procedure|requirement)\s+(?:is|requires?|states?)\s+(?:that\s+)?([^.,\n]{10,150})/gi,
    memoryType: "policy_reference",
    confidence: 0.78,
    importance: 7,
    titleFn:    m => `Policy: ${m[1].trim().slice(0, 60)}`,
    summaryFn:  m => `Organisational policy: ${m[1].trim()}`,
  },
];

const MIN_CONFIDENCE_THRESHOLD = 0.65;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * detectAndProposeConversationKnowledge
 *
 * Scans a user message for candidate organisational knowledge.
 * Creates proposed memory entries above the confidence threshold.
 * Safe to call fire-and-forget.
 */
export async function detectAndProposeConversationKnowledge(
  organizationId: string,
  userMessage:    string,
  userId:         string,
  conversationId?: string,
): Promise<{ proposed: number; skipped: number }> {
  const candidates = extractCandidates(userMessage);
  if (candidates.length === 0) return { proposed: 0, skipped: 0 };

  let proposed = 0;
  let skipped  = 0;

  for (const candidate of candidates) {
    if (candidate.confidence < MIN_CONFIDENCE_THRESHOLD) {
      skipped++;
      continue;
    }

    // Dedup: skip if a very similar proposal was made in the last 24 hours
    const isDuplicate = await checkRecentDuplicate(organizationId, candidate.title);
    if (isDuplicate) {
      skipped++;
      continue;
    }

    try {
      await proposeOrganisationMemory(organizationId, {
        memoryType:       candidate.memoryType,
        title:            candidate.title,
        content:          candidate.summary,
        structuredContent: {
          rationale:          "Detected in conversation",
          section:            "",
          pageReference:      "",
          affectedSpecialists: ["chief_of_staff"],
          suggestedAction:    "create",
          conversationId:     conversationId ?? null,
          detectedPattern:    candidate.pattern,
        },
        sourceType:       "ai_proposed",
        sourceId:         conversationId,
        confidence:       candidate.confidence,
        importance:       candidate.importance,
        createdBy:        userId,
      });
      proposed++;
    } catch (err) {
      console.warn("[ConversationLearning] Failed to propose memory:", err);
      skipped++;
    }
  }

  if (proposed > 0) {
    await logOrgEvent({
      organizationId,
      actorUserId:  userId,
      actorType:    "system",
      eventType:    "knowledge.conversation.candidate_detected",
      resourceType: "conversation",
      resourceId:   conversationId ?? "unknown",
      metadata:     { proposed, skipped, messageLength: userMessage.length },
    }).catch(() => {});
  }

  return { proposed, skipped };
}

// ─── Candidate extraction ─────────────────────────────────────────────────────

interface KnowledgeCandidate {
  memoryType: MemoryType;
  title:      string;
  summary:    string;
  confidence: number;
  importance: number;
  pattern:    string;
}

function extractCandidates(text: string): KnowledgeCandidate[] {
  const candidates: KnowledgeCandidate[] = [];
  const seen = new Set<string>();

  for (const pattern of LEARNING_PATTERNS) {
    const matches = Array.from(text.matchAll(pattern.regex));
    for (const match of matches.slice(0, 2)) { // max 2 matches per pattern
      const title = pattern.titleFn(match).slice(0, 200);
      const key   = `${pattern.memoryType}:${title.toLowerCase().slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        memoryType: pattern.memoryType,
        title,
        summary:    pattern.summaryFn(match).slice(0, 400),
        confidence: pattern.confidence,
        importance: pattern.importance,
        pattern:    pattern.regex.source.slice(0, 80),
      });
    }
  }

  return candidates;
}

// ─── Dedup check ──────────────────────────────────────────────────────────────

async function checkRecentDuplicate(
  organizationId: string,
  title:          string,
): Promise<boolean> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const titlePrefix = title.slice(0, 50);

    const rows = await withConversationLearningTenant(organizationId, "conversation_learning.memory_duplicate_check", async (client) => client.select({ id: organisationMemoryTable.id })
      .from(organisationMemoryTable)
      .where(and(
        eq(organisationMemoryTable.organizationId, organizationId),
        eq(organisationMemoryTable.sourceType, "ai_proposed"),
        gte(organisationMemoryTable.createdAt, oneDayAgo),
        like(organisationMemoryTable.title, `${titlePrefix}%`),
      ))
      .limit(1));

    return rows.length > 0;
  } catch {
    return false; // On error, allow the proposal
  }
}
