---
name: NeedsOps pdf-parse v2 API
description: pdf-parse installed is v2.4.5 (class-based ESM) not v1.x (function-based CJS). Must be marked external in build.mjs and used differently.
---

## The Rule

The installed `pdf-parse` is **v2.4.5** — a completely different fork from the v1.x package on npm.

**Why:** The v1.x function-based API (`pdfParse(buffer, opts)`) does not exist in v2. v2 is ESM-first with a class-based API.

**How to apply:**

1. `pdf-parse` and `pdfjs-dist` must both be in `external` in `artifacts/api-server/build.mjs`.
   Without this, esbuild bundles them and dynamic `import("pdf-parse")` returns a namespace object where `.default` is undefined or an object, never the function.

2. v2 API usage:
```typescript
const { PDFParse } = await import("pdf-parse");
const parser = new PDFParse({ data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), verbosity: 0 });
const result = await parser.getText();  // { text: string, pages: { num, text }[], total: number }
await parser.destroy();
```

3. Named exports from v2: `PDFParse`, `VerbosityLevel`, `AbortException`, etc. **No default export.**

## Job Queue Gotcha

`claimNext` in `DatabaseIngestionQueue.ts` only claims jobs where `status = 'queued'` OR `status = 'failed' AND attempt_count < max_attempts`.
When manually resetting dead-lettered jobs in the DB, set `status = 'queued'` (not `'pending'` — that status is not polled).
