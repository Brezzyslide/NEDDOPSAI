
'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

fs.mkdirSync('docs/architecture', { recursive: true });

const outPath = path.resolve('docs/architecture/KnowledgeExecutionFlow.pdf');
const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

const C = {
  bg:       '#F8F9FC', brand:    '#1A2744', accent:   '#2563EB',
  accentLt: '#DBEAFE', stage:    '#1E3A5F', stageBg:  '#EFF6FF',
  arrow:    '#64748B', tableHead:'#1A2744', tableAlt: '#F1F5F9',
  border:   '#CBD5E1', text:     '#1E293B', muted:    '#64748B',
  white:    '#FFFFFF', green:    '#166534', greenBg:  '#DCFCE7',
  mono:     '#0F172A', monoBg:   '#F1F5F9',
};

const W = doc.page.width - 96;

function fill(hex) { doc.fillColor(hex); }

function tableRow(cols, y, bg, textColor, bold) {
  textColor = textColor || C.text;
  bold = bold || false;
  const colW = [W * 0.28, W * 0.14, W * 0.58];
  let x = 48;
  cols.forEach((c, i) => {
    doc.rect(x, y, colW[i], 18).fill(bg);
    fill(textColor);
    doc.fontSize(7.5)
       .font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .text(c, x + 4, y + 4, { width: colW[i] - 8, ellipsis: true });
    x += colW[i];
  });
}

function sectionHeader(label, number) {
  doc.addPage();
  doc.rect(48, 48, W, 36).fill(C.brand);
  fill(C.white);
  doc.fontSize(13).font('Helvetica-Bold')
     .text('Stage ' + number + '  \u2014  ' + label, 60, 57, { width: W - 24 });
}

// ── COVER ──────────────────────────────────────────────────────────────────
doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.brand);
doc.rect(0, doc.page.height - 80, doc.page.width, 80).fill(C.accent);

fill(C.white);
doc.fontSize(32).font('Helvetica-Bold')
   .text('Knowledge Execution', 64, 190, { width: doc.page.width - 128, align: 'center' });
doc.fontSize(32).font('Helvetica-Bold')
   .text('Architecture', 64, 232, { width: doc.page.width - 128, align: 'center' });

fill('#93C5FD');
doc.fontSize(11).font('Helvetica')
   .text('Upload \u2192 Approval \u2192 Ingestion \u2192 Chunking \u2192 Embedding \u2192 Hybrid Retrieval', 64, 290,
         { width: doc.page.width - 128, align: 'center' });
doc.fontSize(11).font('Helvetica')
   .text('\u2192 Evidence Pack \u2192 Runtime Manifest \u2192 Specialist \u2192 Completed Work \u2192 Audit Trail', 64, 310,
         { width: doc.page.width - 128, align: 'center' });

fill('#CBD5E1');
doc.fontSize(9).font('Helvetica')
   .text('NeedsOps AI+  \u00B7  Sprint 27.3  \u00B7  Internal Architecture Reference', 64, 380,
         { width: doc.page.width - 128, align: 'center' });

// ── PAGE 2: PIPELINE OVERVIEW ───────────────────────────────────────────────
doc.addPage();
doc.rect(48, 48, W, 32).fill(C.brand);
fill(C.white);
doc.fontSize(13).font('Helvetica-Bold').text('Pipeline Overview', 60, 57);

const stages = [
  ['1',  'Upload',           'knowledgeSourceService.ts',              '#2563EB'],
  ['2',  'Approval',         'knowledgeSourceService.ts',              '#7C3AED'],
  ['3',  'Ingestion',        'DatabaseIngestionQueue.ts',              '#0891B2'],
  ['4',  'Chunking',         'knowledgeOrchestrationEngine.ts',        '#059669'],
  ['5',  'Embedding',        'knowledgeOrchestrationEngine.ts',        '#D97706'],
  ['6',  'Hybrid Retrieval', 'hybridRetrievalService.ts',              '#DC2626'],
  ['7',  'Evidence Pack',    'knowledgeResolutionService.ts',          '#BE185D'],
  ['8',  'Runtime Manifest', 'workPackageService.ts',                  '#7C3AED'],
  ['9',  'Specialist',       'workExecutionPipelineService.ts',        '#1D4ED8'],
  ['10', 'Completed Work',   'completedWorkService.ts',                '#065F46'],
  ['11', 'Audit Trail',      'auditService.ts',                        '#92400E'],
];

const boxH = 38, boxGap = 12, startY = 96, boxW = W;

stages.forEach(function(s, i) {
  const num = s[0], label = s[1], file = s[2], color = s[3];
  const y = startY + i * (boxH + boxGap);
  doc.rect(50, y + 2, boxW, boxH).fill('#E2E8F0');
  doc.rect(48, y, boxW, boxH).fill(color);
  doc.circle(72, y + boxH / 2, 13).fill(C.white);

  // number in badge — parse color for text
  const r = parseInt(color.slice(1,3),16);
  const g = parseInt(color.slice(3,5),16);
  const b = parseInt(color.slice(5,7),16);
  doc.fillColor('rgb(' + r + ',' + g + ',' + b + ')');
  doc.fontSize(8).font('Helvetica-Bold').text(num, 65, y + boxH/2 - 5, { width: 16, align: 'center' });

  fill(C.white);
  doc.fontSize(11).font('Helvetica-Bold').text(label, 94, y + 8, { width: 200 });
  doc.fontSize(7.5).font('Courier').text(file, 94, y + 23, { width: W - 100 });

  if (i < stages.length - 1) {
    const ay = y + boxH + 2;
    doc.strokeColor(C.arrow).lineWidth(1.5)
       .moveTo(48 + boxW/2, ay).lineTo(48 + boxW/2, ay + boxGap - 2).stroke();
    doc.polygon(
      [48 + boxW/2,     ay + boxGap],
      [48 + boxW/2 - 5, ay + boxGap - 7],
      [48 + boxW/2 + 5, ay + boxGap - 7]
    ).fill(C.arrow);
  }
});

// ── PAGE 3: DATA LINEAGE + INVARIANTS ──────────────────────────────────────
doc.addPage();
doc.rect(48, 48, W, 32).fill(C.brand);
fill(C.white);
doc.fontSize(13).font('Helvetica-Bold').text('End-to-End Data Lineage', 60, 57);

let y = 96;
fill(C.text);
doc.fontSize(9).font('Helvetica')
   .text('Tracing a single Medication Administration Policy through every database table:', 48, y);
y += 18;

const lineage = [
  ['knowledge_sources',            'id="src-medpol-001"',              'Parent record; status\u2192approved'],
  ['  knowledge_source_versions',  'id="ver-medpol-v3"',               'isCurrent=true; ingestionStatus\u2192complete'],
  ['    ingestion_jobs',           'id="job-abc123"',                   'status: queued\u2192processing\u2192complete'],
  ['      knowledge_chunks',       'chunk-001 \u2026 chunk-047',        'chunkIndex, sectionTitle, pageNumber, embedding'],
  ['        retrieval_audit_events','executionId="exec-xyz"',           'scores, chunkIds, selectionReasons'],
  ['          work_package_manifests','id="wpm-456"',                   'Immutable; specialist + blueprintId + sourceRefs'],
  ['            completed_work',   'id="cw-789"',                       'status: draft\u2192awaiting_approval\u2192approved'],
  ['              completed_work_assets','citationRef="Policy,v3,\u00A74"','Permanent citation trail per source chunk'],
  ['                org_audit_log','event=completed_work.approved',     'Actor, timestamp; never aborts business op'],
];

lineage.forEach(function(row, i) {
  const table = row[0], value = row[1], note = row[2];
  const bg = i % 2 === 0 ? C.white : C.tableAlt;
  const indent = (table.match(/^ */)[0].length) * 3;
  doc.rect(48, y, W, 22).fill(bg);
  fill(C.accent);
  doc.fontSize(7.5).font('Courier').text(table.trim(), 52 + indent, y + 5, { width: 185 - indent });
  fill(C.text);
  doc.fontSize(7.5).font('Helvetica-Bold').text(value, 244, y + 5, { width: 165 });
  fill(C.muted);
  doc.fontSize(7).font('Helvetica').text(note, 414, y + 5, { width: W - 372 });
  y += 22;
});

y += 14;
doc.rect(48, y, W, 22).fill(C.brand);
fill(C.white);
doc.fontSize(10).font('Helvetica-Bold').text('Key Invariants', 56, y + 6);
y += 22;

const invariants = [
  ['Only approved, current sources appear in retrieval',     'hybridRetrievalService SQL hard filter'],
  ['Approval status preserved across version replacements',  'replaceSourceVersion \u2014 status excluded from UPDATE SET'],
  ['Each manifest is immutable',                             'work_package_manifests is append-only; no UPDATE path'],
  ['Chunks below 0.05 confidence discarded',                 'resolveEvidence confidence gate'],
  ['Audit writes never abort business operations',            'logOrgEvent wraps every write in .catch(()=>{})'],
  ['Tenant isolation enforced at every DB query',             'organizationId in all predicates + Postgres RLS (70 tables)'],
  ['LLM blueprint classification only when keyword conf=0',  'selectBlueprint two-stage gate in workBlueprintService.ts'],
];

invariants.forEach(function(row, i) {
  const inv = row[0], where = row[1];
  const bg = i % 2 === 0 ? C.white : C.tableAlt;
  doc.rect(48, y, W, 20).fill(bg);
  doc.circle(60, y + 10, 6).fill(C.greenBg);
  fill(C.green);
  doc.fontSize(8).font('Helvetica-Bold').text('\u2713', 57, y + 5);
  fill(C.text);
  doc.fontSize(7.5).font('Helvetica').text(inv, 72, y + 5, { width: W * 0.52 });
  fill(C.muted);
  doc.fontSize(7).font('Helvetica-Oblique').text(where, 72 + W * 0.52 + 6, y + 5, { width: W * 0.42 });
  y += 20;
});

// ── STAGE DETAIL PAGES ─────────────────────────────────────────────────────
const stageDetails = [
  {
    num: 1, title: 'Upload',
    subtitle: 'Admin submits file \u2192 source row created with status=uploaded',
    service: 'knowledgeSourceService.ts',
    entry: 'POST /v1/organisations/:orgSlug/library/sources',
    fns: ['completeUpload(input)', 'findDuplicateChecksum(checksum, orgId)'],
    tables: [
      ['knowledge_sources', 'INSERT', 'id, organizationId, title, sourceType, authorityLevel, sensitivityClassification, status="uploaded"'],
      ['knowledge_source_versions', 'INSERT', 'id, knowledgeSourceId, versionLabel, storageKey, checksum, fileSize, mimeType, ingestionStatus="pending"'],
    ],
    guards: [
      'Actor must hold library:write permission on the organisation',
      'sourceType must be a member of the allowed enum (policy, procedure, legislation \u2026)',
      'Duplicate checksum within same org \u2192 409 idempotent (existing version returned)',
      'Empty or whitespace-only title rejected before insert',
    ],
    emits: 'knowledge.source.uploaded \u2192 logOrgEvent (best-effort, non-blocking)',
    note: 'GCS signed URLs cannot be issued from the Replit sidecar. All uploads are proxied through the API server using file.save(buffer) with service-account credentials. Never call GCS directly from client code.',
  },
  {
    num: 2, title: 'Approval',
    subtitle: 'Reviewer approves \u2192 source becomes visible to every specialist',
    service: 'knowledgeSourceService.ts',
    entry: 'POST /v1/organisations/:orgSlug/library/sources/:sourceId/approve',
    fns: ['approveKnowledgeSource(sourceId, orgId, actorUserId)', 'revokeKnowledgeSource(\u2026)', 'supersedeKnowledgeSource(\u2026)', 'replaceSourceVersion(\u2026)'],
    tables: [
      ['knowledge_sources', 'UPDATE', 'status = "approved"'],
      ['knowledge_source_versions', 'UPDATE', 'status = "approved" on active version'],
      ['knowledge_source_scopes', 'INSERT', 'scope assignment if provided with approval'],
    ],
    guards: [
      'hybridRetrievalService hard-filters: status="approved" AND is_current=true AND deleted_at IS NULL',
      'replaceSourceVersion \u2014 status field intentionally absent from UPDATE SET',
      'Superseded sources set status="superseded"; history preserved in retrieval_audit_events',
      'Revoked sources: revokedAt timestamp set; immediate removal from retrieval',
    ],
    emits: 'knowledge.source.approved / revoked / superseded \u2192 logOrgEvent',
    note: 'Approval is the single most critical gate. An uploaded-but-unapproved document is completely invisible to specialists regardless of ingestion state. The only way to make a document searchable is explicit approval by an authorised actor.',
  },
  {
    num: 3, title: 'Ingestion',
    subtitle: 'Background worker claims job atomically \u2192 extracts text from file',
    service: 'DatabaseIngestionQueue.ts + knowledgeOrchestrationEngine.ts',
    entry: 'Internal queue worker; auto-enqueued by completeUpload and replaceSourceVersion',
    fns: ['DatabaseIngestionQueue.claimNext()', 'DatabaseIngestionQueue.heartbeat(jobId)', 'knowledgeOrchestrationEngine.process(job)'],
    tables: [
      ['ingestion_jobs', 'UPDATE', 'status: queued\u2192processing\u2192complete (or failed/dead_lettered); attemptCount++'],
      ['knowledge_source_versions', 'UPDATE', 'ingestionStatus, ingestionMetadata (page count, error message)'],
    ],
    guards: [
      'SELECT \u2026 FOR UPDATE SKIP LOCKED \u2014 atomic claim; multiple workers cannot double-process the same job',
      'Heartbeat updates prevent stale leases from blocking the queue indefinitely',
      'attemptCount \u2265 maxAttempts \u2192 dead_lettered; operator intervention required',
      'Zero chunks produced (corrupt/empty file) \u2192 failed with error in ingestionMetadata',
    ],
    emits: 'n/a (internal state machine transitions only)',
    note: 'replaceSourceVersion uses the pre-computed newVersionId UUID (assigned at function entry with randomUUID()) in the fire-and-forget enqueue call \u2014 not newVersion!.id \u2014 to avoid a race between the post-transaction SELECT and the enqueue call.',
  },
  {
    num: 4, title: 'Chunking',
    subtitle: 'Extracted text split into token-bounded, position-annotated chunks',
    service: 'knowledgeOrchestrationEngine.ts (inside ingestion worker)',
    entry: 'Internal \u2014 called by orchestration engine immediately after text extraction',
    fns: ['chunkText(extractedText, options)', 'insertChunks(chunks, versionId, orgId)'],
    tables: [
      ['knowledge_chunks', 'INSERT', 'id, organizationId, knowledgeSourceId, sourceVersionId, chunkIndex, sectionTitle, headingPath, pageNumber, text, tokenCount, contentHash'],
    ],
    guards: [
      'Token budget per chunk ~512 tokens (configurable per blueprint)',
      'contentHash (SHA-256 of chunk text) enables deduplication on re-ingestion',
      'PDF parser preserves section headings + page numbers as chunk metadata',
      'Zero chunks produced \u2192 job transitions to failed status',
    ],
    emits: 'n/a',
    note: 'Chunk metadata (sectionTitle, headingPath, pageNumber) is the source of citation strings like "Section 4, p.\u202012" shown in the evidence pack and stored permanently in completed_work_assets.citationRef. Without this metadata citations would be opaque byte offsets.',
  },
  {
    num: 5, title: 'Embedding',
    subtitle: 'Each chunk receives a 1536-dim pgvector + implicit tsvector for full-text search',
    service: 'knowledgeOrchestrationEngine.ts + knowledgeStorageService.ts',
    entry: 'Internal \u2014 called immediately after chunking within the same ingestion job',
    fns: ['embedChunks(chunks)', 'updateChunkEmbeddings(chunkIds, embeddings)'],
    tables: [
      ['knowledge_chunks', 'UPDATE', 'embedding vector(1536), embeddingModel, tsvector GIN-indexed (implicit)'],
    ],
    guards: [
      'AI_PROVIDER=openai \u2192 OpenAI text-embedding-3-small via AI gateway proxy',
      'Provider unavailable \u2192 job fails and retries; partial chunk states are never committed',
      'Chunks without embeddings receive semanticScore=0.0 at retrieval time (not excluded)',
      'Current pipeline passes queryEmbedding:null \u2014 lexical-only mode; semantic activates when provided',
    ],
    emits: 'n/a',
    note: 'The pipeline currently runs in lexical-only mode because queryEmbedding is passed as null in resolveEvidence. Semantic scoring (cosine similarity) is fully wired in hybridRetrievalService and activates automatically the moment a query embedding is supplied.',
  },
  {
    num: 6, title: 'Hybrid Retrieval',
    subtitle: 'Semantic cosine + BM25-style lexical scores combined; freshness + authority bonuses applied',
    service: 'hybridRetrievalService.ts',
    entry: 'retrieveChunks(input) \u2014 called from knowledgeResolutionService.resolveEvidence',
    fns: ['retrieveChunks(input)', 'computeFreshnessBonus(effectiveFrom)', 'computeAuthorityBonus(authorityLevel)'],
    tables: [
      ['knowledge_chunks (kc)', 'SELECT JOIN', 'text, embedding, chunkIndex, sectionTitle, pageNumber, tokenCount'],
      ['knowledge_sources (ks)', 'JOIN', 'status, is_current, authorityLevel, sensitivityClassification, effectiveDates'],
      ['retrieval_audit_events', 'INSERT', 'executionId, queryText, chunkIds[], scores{}, selectionReasons, metrics'],
    ],
    guards: [
      'ks.organization_id = $orgId \u2014 tenant isolation; never crosses org boundary',
      'ks.status = "approved" \u2014 unapproved sources are invisible to this query',
      'ks.is_current = true \u2014 superseded versions are excluded from results',
      'kc.deleted_at IS NULL \u2014 soft-deleted chunks excluded',
      'Effective date range: effective_from \u2264 today \u2264 effective_to (when set on source)',
      'sensitivity_classification matched against specialist clearance level',
    ],
    emits: 'retrieval_audit_events row written per retrieveChunks call (permanent forensic record)',
    note: 'Scoring formula: baseScore = (semanticScore \u00D7 0.6) + (lexicalScore \u00D7 0.4) + freshnessBonus + authorityBonus. Weights are configurable per blueprint. The retrieval_audit_events row records every score component per chunk, enabling full reproducibility.',
  },
  {
    num: 7, title: 'Evidence Pack',
    subtitle: 'Chunks assembled, confidence-filtered, enriched, cached, and formatted as prompt section',
    service: 'knowledgeResolutionService.ts',
    entry: 'resolveEvidence(input) \u2192 buildEvidenceSection(pack) \u2192 buildCitationSummary(pack)',
    fns: ['resolveEvidence(input)', 'buildEvidenceSection(pack)', 'buildCitationSummary(pack)', 'invalidateEvidenceCache(executionId)'],
    tables: [
      ['knowledge_chunks', 'SELECT', 'Direct sourceId query for task-upload path (not via hybrid retrieval)'],
      ['knowledge_source_versions', 'SELECT .limit(500)', 'Batch version-label enrichment'],
      ['knowledge_sources', 'SELECT .limit(200)', 'Batch source-type lookup for citationsByType grouping'],
    ],
    guards: [
      'Confidence gate: chunks with baseScore < 0.05 are discarded before packing',
      'In-process cache keyed on executionId \u2014 second call for same execution returns instantly',
      'Task-upload chunks fetched via direct sourceId query (no hybrid retrieval path)',
      'All batch enrichment queries use .limit() safety caps (500 / 200 / 100)',
    ],
    emits: 'EvidencePack (in-memory); buildCitationSummary \u2192 JSON array for completed_work_assets',
    note: 'buildEvidenceSection produces the "=== AUTHORITATIVE EVIDENCE ===" block injected into the specialist prompt, grouped by source type (Legislation / Policy / Procedure \u2026). buildCitationSummary produces the JSON stored in completed_work_assets so the citation trail survives outside the system.',
  },
  {
    num: 8, title: 'Runtime Manifest',
    subtitle: 'Immutable snapshot of all inputs bound to this execution \u2014 written once, never updated',
    service: 'workPackageService.ts + workBlueprintService.ts',
    entry: 'assembleWorkPackage(input) \u2014 called by workExecutionPipelineService before LLM call',
    fns: ['assembleWorkPackage(input)', 'selectBlueprint(userRequest, orgId)', 'classifyBlueprintWithLLM(userRequest, orgId)', 'validateWorkPackage(pkg)'],
    tables: [
      ['work_package_manifests', 'INSERT', 'id, executionId, orgId, primarySpecialist, blueprintId/Version, librarySources, taskUploads, cosMemories, specialistMemories, entityKnowledge, assembledAt'],
    ],
    guards: [
      'Blueprint selection: keyword fast path first; LLM fallback only when keyword confidence = 0',
      'LLM classification requires confidence \u2265 0.6 \u2014 weak matches are rejected (no guess routing)',
      'Org-published blueprints override built-in blueprints for the same code',
      'validateWorkPackage: missing required inputs \u2192 awaiting_clarification (not a degraded run)',
      'Manifest is append-only \u2014 no UPDATE path exists anywhere in the codebase',
    ],
    emits: 'n/a (written synchronously before the LLM call begins)',
    note: 'The manifest is the source of truth for audit, reproducibility, and cost attribution. Every evidence citation, memory entry, and blueprint version used is recorded here. The LLM call cannot begin until the manifest row is committed.',
  },
  {
    num: 9, title: 'Specialist',
    subtitle: 'LLM called with Employee File constitution + evidence section; self-review scores draft',
    service: 'workExecutionPipelineService.ts + specialistContextService.ts',
    entry: 'executeWork(input) \u2192 generateDraft(pkg, evidence) \u2192 reviewDraft(draft)',
    fns: ['executeWork(input)', 'generateDraft(workPackage, evidencePack)', 'reviewDraft(draft, criteria)', 'loadSpecialistContext(specialistId, orgId)', 'buildSpecialistContext(context)'],
    tables: [
      ['completed_work', 'INSERT via createDraft', 'id, organizationId, specialistId, executionId, status="draft"'],
    ],
    guards: [
      'Evidence retrieval failure is non-fatal \u2014 metadata-only fallback + warning label in prompt',
      'Token budget overrun \u2192 memory entries truncated oldest-first (most-recent preserved)',
      'Draft generation failure \u2192 execution_failed status + SSE notification to connected client',
      'Self-review: 10 quality dimensions, each scored 0\u201310; stored alongside draft',
    ],
    emits: 'SSE events: task_auto_created (if CoS confidence \u2265 0.85 + shouldCreateTask), done / error',
    note: 'The specialist system prompt comes entirely from its Employee File (constitution, personality, prohibited phrases, output format). The evidence pack is injected as the "=== AUTHORITATIVE EVIDENCE ===" section. Self-review runs immediately after generation before the record is stored.',
  },
  {
    num: 10, title: 'Completed Work',
    subtitle: 'Draft stored; approval lifecycle managed; permanent citation trail written',
    service: 'completedWorkService.ts',
    entry: 'createDraft(input) / submitForApproval(id) / approveWork(id) / rejectWork(id)',
    fns: ['createDraft(input)', 'submitForApproval(id, actorId)', 'approveWork(id, actorId)', 'rejectWork(id, actorId, reason)', 'exportAsPdf(id)', 'exportAsDocx(id)'],
    tables: [
      ['completed_work', 'INSERT/UPDATE', 'id, status machine (draft\u2192awaiting_approval\u2192approved/rejected), specialistId, manifestRef'],
      ['completed_work_versions', 'INSERT', 'Immutable content snapshot per approval cycle'],
      ['completed_work_assets', 'INSERT', 'One row per source citation; citationRef = "Policy, v3, \u00A74, p.12"'],
      ['completed_work_comments', 'INSERT', 'Reviewer comments threaded per version'],
    ],
    guards: [
      'Status machine enforced: only valid transitions accepted (no arbitrary status jumps)',
      'rejected \u2192 draft (rework) path re-enters the pipeline for revision',
      'approved \u2192 archived preserves all version + asset + citation history',
      'citationRef persists the human-readable citation outside the source document',
    ],
    emits: 'completed_work.submitted / approved / rejected \u2192 logOrgEvent',
    note: 'completed_work_assets is the permanent citation trail. Every unique sourceId from the EvidencePack produces one row with a citationRef string. This survives export to PDF/DOCX, ensuring evidence attribution is preserved when work leaves the system.',
  },
  {
    num: 11, title: 'Audit Trail',
    subtitle: 'Every transition recorded; retrieval query persisted with full per-chunk scoring detail',
    service: 'auditService.ts + knowledgeOrchestrationEngine.ts',
    entry: 'logOrgEvent(event) \u2014 called at every significant transition across all 10 prior stages',
    fns: ['logOrgEvent(event)', 'writeAuditEvent(event)', 'log(event)'],
    tables: [
      ['org_audit_log', 'INSERT', 'Per-org events: upload, approve, revoke, execute, complete, approve \u2014 actor + timestamp'],
      ['platform_audit_log', 'INSERT', 'Platform-scoped: org provisioning, plan changes, staff actions'],
      ['retrieval_audit_events', 'INSERT', 'Per-execution: queryText, chunkIds[], scores{semantic,lexical,base,fresh,auth}, selectionReasons, metrics'],
    ],
    guards: [
      'logOrgEvent wraps every insert in .catch(()=>{}) \u2014 audit NEVER aborts a business operation',
      'Falls back to public org_audit_log schema if tenant schema not yet provisioned',
      'retrieval_audit_events: one row per retrieveChunks call (not per individual chunk)',
      'RLS: REQUIRED_RLS_TABLES=70 verified at every server startup; startup fails if count drops',
    ],
    emits: 'n/a (terminal stage)',
    note: 'The retrieval_audit_events row is the forensic record for explaining any specialist output. It contains the exact query, which chunks were shown, and every score component \u2014 enabling full reproducibility and compliance review of any piece of completed work.',
  },
];

stageDetails.forEach(function(s) {
  sectionHeader(s.title, s.num);
  let sy = 100;

  // Subtitle bar
  doc.rect(48, sy, W, 22).fill(C.stageBg);
  fill(C.stage);
  doc.fontSize(8.5).font('Helvetica-Bold').text(s.subtitle, 56, sy + 6, { width: W - 16 });
  sy += 30;

  // Entry
  doc.rect(48, sy, W, 16).fill(C.accentLt);
  fill(C.accent);
  doc.fontSize(7).font('Helvetica-Bold').text('ENTRY POINT', 54, sy + 4, { width: 76 });
  fill(C.text);
  doc.fontSize(7).font('Courier').text(s.entry, 134, sy + 4, { width: W - 90 });
  sy += 22;

  // Service
  fill(C.muted);
  doc.fontSize(7).font('Helvetica-Bold').text('SERVICE', 48, sy);
  fill(C.mono);
  doc.fontSize(7).font('Courier').text(s.service, 134, sy, { width: W - 90 });
  sy += 16;

  // Functions
  fill(C.muted);
  doc.fontSize(7).font('Helvetica-Bold').text('KEY FUNCTIONS', 48, sy);
  sy += 10;
  s.fns.forEach(function(fn) {
    doc.rect(54, sy, W - 6, 13).fill(C.monoBg);
    fill(C.mono);
    doc.fontSize(6.5).font('Courier').text(fn, 58, sy + 3, { width: W - 18 });
    sy += 14;
  });
  sy += 6;

  // Tables
  fill(C.muted);
  doc.fontSize(7).font('Helvetica-Bold').text('DATABASE TABLES', 48, sy);
  sy += 10;
  tableRow(['TABLE', 'OP', 'KEY COLUMNS / DETAILS'], sy, C.tableHead, C.white, true);
  sy += 18;
  s.tables.forEach(function(row, i) {
    tableRow(row, sy, i % 2 === 0 ? C.white : C.tableAlt);
    sy += 18;
  });
  sy += 8;

  // Guards
  fill(C.muted);
  doc.fontSize(7).font('Helvetica-Bold').text('GUARDS & VALIDATION', 48, sy);
  sy += 10;
  s.guards.forEach(function(g, i) {
    const bg = i % 2 === 0 ? C.greenBg : C.white;
    doc.rect(48, sy, W, 14).fill(bg);
    fill(C.green);
    doc.fontSize(7).font('Helvetica-Bold').text('\u25B8', 54, sy + 3);
    fill(C.text);
    doc.fontSize(7).font('Helvetica').text(g, 64, sy + 3, { width: W - 22 });
    sy += 14;
  });
  sy += 8;

  // Emits
  fill(C.muted);
  doc.fontSize(7).font('Helvetica-Bold').text('EMITS', 48, sy);
  fill(C.text);
  doc.fontSize(7).font('Helvetica').text(s.emits, 134, sy, { width: W - 90 });
  sy += 16;

  // Note
  if (s.note) {
    doc.rect(48, sy, 3, 34).fill(C.accent);
    doc.rect(51, sy, W - 3, 34).fill(C.accentLt);
    fill(C.accent);
    doc.fontSize(7).font('Helvetica-Bold').text('NOTE', 58, sy + 4);
    fill(C.stage);
    doc.fontSize(7).font('Helvetica').text(s.note, 58, sy + 15, { width: W - 18 });
  }
});

// ── FILE INDEX PAGE ─────────────────────────────────────────────────────────
doc.addPage();
doc.rect(48, 48, W, 32).fill(C.brand);
fill(C.white);
doc.fontSize(13).font('Helvetica-Bold').text('Service & Schema File Index', 60, 57);

let fy = 96;

const fileIndex = [
  ['Upload',           'artifacts/api-server/src/services/knowledgeSourceService.ts'],
  ['Approval',         'artifacts/api-server/src/services/knowledgeSourceService.ts'],
  ['Ingestion',        'artifacts/api-server/src/lib/ingestionQueue/DatabaseIngestionQueue.ts'],
  ['Chunking',         'artifacts/api-server/src/lib/knowledgeOrchestrationEngine.ts'],
  ['Embedding',        'artifacts/api-server/src/lib/knowledgeOrchestrationEngine.ts'],
  ['Hybrid Retrieval', 'artifacts/api-server/src/services/hybridRetrievalService.ts'],
  ['Evidence Pack',    'artifacts/api-server/src/services/knowledgeResolutionService.ts'],
  ['Runtime Manifest', 'artifacts/api-server/src/services/workPackageService.ts + workBlueprintService.ts'],
  ['Specialist',       'artifacts/api-server/src/services/workExecutionPipelineService.ts + specialistContextService.ts'],
  ['Completed Work',   'artifacts/api-server/src/services/completedWorkService.ts'],
  ['Audit Trail',      'artifacts/api-server/src/services/auditService.ts'],
];

doc.rect(48, fy, W, 18).fill(C.tableHead);
fill(C.white);
doc.fontSize(7.5).font('Helvetica-Bold').text('STAGE', 52, fy + 5, { width: 110 });
doc.fontSize(7.5).font('Helvetica-Bold').text('PRIMARY FILE(S)', 166, fy + 5, { width: W - 124 });
fy += 18;

fileIndex.forEach(function(row, i) {
  const bg = i % 2 === 0 ? C.white : C.tableAlt;
  doc.rect(48, fy, W, 18).fill(bg);
  fill(C.accent);
  doc.fontSize(7.5).font('Helvetica-Bold').text(row[0], 52, fy + 4, { width: 110 });
  fill(C.mono);
  doc.fontSize(6.5).font('Courier').text(row[1], 166, fy + 4, { width: W - 124 });
  fy += 18;
});

fy += 14;
doc.rect(48, fy, W, 20).fill(C.brand);
fill(C.white);
doc.fontSize(9).font('Helvetica-Bold').text('DB Schema Files  (lib/db/src/schema/)', 56, fy + 6);
fy += 20;

const schemaFiles = [
  'knowledgeSources.ts','knowledgeSourceVersions.ts','knowledgeSourceScopes.ts',
  'knowledgeChunks.ts','ingestionJobs.ts','retrievalAuditEvents.ts',
  'workPackageManifests.ts','completedWork.ts','completedWorkVersions.ts',
  'completedWorkAssets.ts','orgAuditLog.ts',
];

schemaFiles.forEach(function(f, i) {
  const bg = i % 2 === 0 ? C.white : C.tableAlt;
  doc.rect(48, fy, W, 15).fill(bg);
  fill(C.mono);
  doc.fontSize(7.5).font('Courier').text(f, 56, fy + 3, { width: W - 16 });
  fy += 15;
});

fy += 12;
fill(C.muted);
doc.fontSize(7.5).font('Helvetica')
   .text('RLS table count verified at API server startup: REQUIRED_RLS_TABLES = 70  \u00B7  lib/org-db/src/rlsVerifier.ts', 48, fy);

// ── PAGE NUMBERS ────────────────────────────────────────────────────────────
const totalPages = doc.bufferedPageRange().count;
for (let i = 0; i < totalPages; i++) {
  doc.switchToPage(i);
  fill(C.muted);
  doc.fontSize(7).font('Helvetica')
     .text(
       'NeedsOps AI+  \u00B7  Knowledge Execution Architecture  \u00B7  ' + (i + 1) + ' / ' + totalPages,
       48, doc.page.height - 28, { width: W, align: 'center' }
     );
}

doc.end();

stream.on('finish', function() {
  const size = fs.statSync(outPath).size;
  console.log('OK ' + outPath + ' (' + size + ' bytes)');
});
stream.on('error', function(e) { console.error('ERR', e.message); process.exit(1); });
