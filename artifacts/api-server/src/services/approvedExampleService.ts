/**
 * Approved Example Service — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Retrieves Approved Example documents from the Organisation Library and
 * extracts style/tone/terminology guidance to influence specialist generation.
 *
 * CRITICAL: Approved examples are never copied or reproduced.
 * They teach: writing style, level of detail, preferred terminology,
 * formatting conventions, section ordering, and professional tone.
 *
 * The extracted guidance is injected into the Work Package as style signals
 * only — the specialist uses them to calibrate output, not to replicate.
 */

import { db } from "@workspace/db";
import { knowledgeSourcesTable, knowledgeChunksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApprovedExample {
  sourceId: string;
  title: string;
  sourceType: string;
  authorityLevel: string | null;
}

export interface ExampleStyleSignal {
  category: string;
  signal: string;
}

export interface StyleGuidance {
  writingStyle: string[];
  terminology: string[];
  formattingConventions: string[];
  toneDescriptors: string[];
  avoidPatterns: string[];
  /** Human-readable guidance block for injection into prompts */
  guidanceBlock: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Retrieve approved example documents for a given output type.
 * Falls back to generic approved_example sources if no type-specific ones exist.
 */
export async function retrieveApprovedExamples(
  organizationId: string,
  outputType: string,
  limit = 3,
): Promise<ApprovedExample[]> {
  const rows = await db
    .select({
      id: knowledgeSourcesTable.id,
      title: knowledgeSourcesTable.title,
      sourceType: knowledgeSourcesTable.sourceType,
      authorityLevel: knowledgeSourcesTable.authorityLevel,
    })
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.organizationId, organizationId),
        eq(knowledgeSourcesTable.status, "approved"),
        eq(knowledgeSourcesTable.sourceType, "approved_example"),
        eq(knowledgeSourcesTable.sourceScope, "library"),
      )
    )
    .limit(limit);

  return rows.map(r => ({
    sourceId: r.id,
    title: r.title,
    sourceType: r.sourceType,
    authorityLevel: r.authorityLevel ?? null,
  }));
}

/**
 * Build style guidance from approved examples.
 *
 * Extracts style signals from chunk content WITHOUT reproducing the content.
 * Returns structured guidance safe to inject into prompts.
 */
export async function buildStyleGuidance(
  examples: ApprovedExample[],
  organizationId: string,
): Promise<StyleGuidance> {
  if (examples.length === 0) {
    return {
      writingStyle: [],
      terminology: [],
      formattingConventions: [],
      toneDescriptors: [],
      avoidPatterns: [],
      guidanceBlock: "",
    };
  }

  const sourceIds = examples.map(e => e.sourceId);

  // Retrieve a sample of content from each example (first 2 chunks each)
  const allSignals: ExampleStyleSignal[] = [];

  for (const sourceId of sourceIds) {
    const chunks = await db
      .select({
        content: knowledgeChunksTable.content,
        chunkIndex: knowledgeChunksTable.chunkIndex,
      })
      .from(knowledgeChunksTable)
      .where(
        and(
          eq(knowledgeChunksTable.organizationId, organizationId),
          eq(knowledgeChunksTable.knowledgeSourceId, sourceId),
        )
      )
      .limit(2);

    for (const chunk of chunks) {
      if (!chunk.content) continue;
      const signals = extractStyleSignals(chunk.content);
      allSignals.push(...signals);
    }
  }

  return compileGuidance(allSignals);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractStyleSignals(content: string): ExampleStyleSignal[] {
  const signals: ExampleStyleSignal[] = [];
  const text = content.slice(0, 2000); // cap for analysis

  // Detect formality level
  const formalIndicators = ["pursuant to", "in accordance with", "as per", "herein", "aforementioned"];
  const informalIndicators = ["let's", "you'll", "we're", "can't", "don't"];
  const formalCount = formalIndicators.filter(f => text.toLowerCase().includes(f)).length;
  const informalCount = informalIndicators.filter(f => text.toLowerCase().includes(f)).length;
  if (formalCount > informalCount) {
    signals.push({ category: "writingStyle", signal: "Formal, professional register" });
  } else if (informalCount > formalCount) {
    signals.push({ category: "writingStyle", signal: "Conversational, accessible language" });
  }

  // Detect person-centred language
  if (/\bparticipant\b/i.test(text) && !/\bclient\b/i.test(text)) {
    signals.push({ category: "terminology", signal: "Uses 'participant' (not 'client' or 'service user')" });
  } else if (/\bclient\b/i.test(text) && !/\bparticipant\b/i.test(text)) {
    signals.push({ category: "terminology", signal: "Uses 'client' (not 'participant')" });
  }

  // Detect active vs passive voice preference
  const passivePatterns = /\b(was|were|been|being)\s+\w+ed\b/gi;
  const passiveMatches = (text.match(passivePatterns) ?? []).length;
  if (passiveMatches > 3) {
    signals.push({ category: "writingStyle", signal: "Passive voice used for formal distance" });
  } else {
    signals.push({ category: "writingStyle", signal: "Active voice preferred" });
  }

  // Detect numbered vs bulleted structure
  if (/^\d+\./m.test(text)) {
    signals.push({ category: "formattingConventions", signal: "Numbered lists for sequential content" });
  }
  if (/^[-•]/m.test(text)) {
    signals.push({ category: "formattingConventions", signal: "Bullet points for non-sequential items" });
  }

  // Detect heading style
  if (/^#{1,3}\s/m.test(text)) {
    signals.push({ category: "formattingConventions", signal: "Markdown headings for section structure" });
  } else if (/^[A-Z][A-Z\s]{3,}:/.m?.test?.(text)) {
    signals.push({ category: "formattingConventions", signal: "Uppercase section headings" });
  }

  return signals;
}

function compileGuidance(signals: ExampleStyleSignal[]): StyleGuidance {
  const writingStyle: string[] = [];
  const terminology: string[] = [];
  const formattingConventions: string[] = [];
  const toneDescriptors: string[] = [];
  const avoidPatterns: string[] = [];
  const seen = new Set<string>();

  for (const s of signals) {
    if (seen.has(s.signal)) continue;
    seen.add(s.signal);
    switch (s.category) {
      case "writingStyle": writingStyle.push(s.signal); break;
      case "terminology": terminology.push(s.signal); break;
      case "formattingConventions": formattingConventions.push(s.signal); break;
      case "tone": toneDescriptors.push(s.signal); break;
      case "avoid": avoidPatterns.push(s.signal); break;
    }
  }

  const parts: string[] = [];
  if (writingStyle.length)         parts.push(`Writing style: ${writingStyle.join("; ")}`);
  if (terminology.length)          parts.push(`Terminology: ${terminology.join("; ")}`);
  if (formattingConventions.length) parts.push(`Formatting: ${formattingConventions.join("; ")}`);
  if (toneDescriptors.length)      parts.push(`Tone: ${toneDescriptors.join("; ")}`);
  if (avoidPatterns.length)        parts.push(`Avoid: ${avoidPatterns.join("; ")}`);

  const guidanceBlock = parts.length > 0
    ? `=== APPROVED EXAMPLE STYLE GUIDANCE (influence only — never reproduce examples) ===\n${parts.join("\n")}`
    : "";

  return { writingStyle, terminology, formattingConventions, toneDescriptors, avoidPatterns, guidanceBlock };
}
