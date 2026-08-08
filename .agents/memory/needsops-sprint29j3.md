---
name: NeedsOps Sprint 29J.3 — Completed Work Human-Readable Export Quality
description: Single normalisation layer converts JSON/fenced-JSON to human-readable markdown before PDF/DOCX/Viewer rendering.
---

## Rule
All completed work content MUST pass through `normaliseCompletedWorkContent()` before rendering.
This applies to: PDF exporter, DOCX exporter, Markdown exporter, and the Viewer.

**Canonical pipeline:**
```
resolveApprovedVersion()
    ↓
normaliseCompletedWorkContent(contentMarkdown)
    ↓
Normalised Markdown string
    ↓
parseMarkdown() → DocumentNode[]   (server: completedWorkExportService.ts)
OR
MarkdownRenderer                   (web: CompletedWorkViewer.tsx)
```

## Implementation
- **Server normaliser:** `artifacts/api-server/src/services/completedWorkNormaliser.ts`
- **Web normaliser:** `artifacts/needsops-web/src/lib/completedWorkNormaliser.ts` (mirror — must stay in sync)
- Export service wired at: `completedWorkExportService.ts` — `normaliseCompletedWorkContent(markdown)` before `parseMarkdown()`
- Viewer wired at: `CompletedWorkViewer.tsx` line ~1118 — `normaliseCompletedWorkContent(approvedVersion?.contentMarkdown ?? "")`

## Content formats and their normalisation path
1. **Markdown/prose** → passed through unchanged
2. **Raw JSON object** `{...}` → SKIP_FIELDS removed, human-readable sections rendered
3. **Raw JSON array** `[...]` → numbered list with sub-fields
4. **Fenced ```json** → inner JSON extracted; goes through (2) or (3)
5. **Fenced non-JSON** → fences stripped, inner text returned as-is
6. **Malformed JSON-like** → passed through as plain text (never throws)
7. **Empty/null** → returned safely (no crash)

## SKIP_FIELDS (internal specialist routing metadata — never rendered)
`specialistRunId, workforceRoleCode, capabilityCode, id, taskId, executionId, orgId, organizationId, createdAt, updatedAt, version, _type, __type`

## Key ordering
KEY_PRIORITY list drives section order: executiveSummary → summary → findings → recommendations → citations, etc.

## Real DB content formats (as of Sprint 29J.3)
- markdown: 4 records (2140–4296 chars)
- fenced_json: 1 record (2429 chars) — operations_manager incident output
- json_object: 1 record (1493 chars) — chief_of_staff output

**Why:** Without normalisation, raw JSON content (specialist routing metadata + findings/recommendations) appeared literally in PDF/DOCX with braces, quoted property names, and internal field names like `specialistRunId`.

## No LLM calls during export
The normaliser is pure and deterministic — no LLM calls, no remote fetches. O24 test enforces this with a mock that would fail if the OpenAI SDK were called.

## Test counts
- 45 new tests in `sprint29j3-export-quality.test.ts` (N1–N10, O1–O24, REAL-1–REAL-8)
- All 45 pass
- Full suite: 4412 passing / 27 pre-existing failures (count unchanged)
