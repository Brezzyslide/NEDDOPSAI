#!/usr/bin/env node
/**
 * NeedsOps — OpenClaw Source Inspector
 *
 * Run this script from INSIDE the OpenClaw source repository:
 *
 *   Terminal — Mac
 *   cd /Users/tayephilipajao/Development/needsops-browser/OpenClaw-NeedsOps
 *   node /path/to/needsops-repo/scripts/inspect-openclaw.mjs
 *
 * The script writes full findings to ./openclaw-inspection-report.json and
 * prints a concise summary to the terminal. Paste the summary back into Replit
 * to proceed with Phase 4 (live gateway adapter implementation).
 *
 * What it inspects:
 *   - HTTP and WebSocket route definitions
 *   - RPC / IPC mechanisms
 *   - Execution / session / task / run / job submission APIs
 *   - CLI entry points and programmatic invocation
 *   - Plugin / SDK exports
 *   - Authentication mechanisms
 *   - Pause, resume, cancel support
 *   - Event streaming / callbacks
 *   - package.json scripts and main entry points
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const REPORT_PATH = join(ROOT, "openclaw-inspection-report.json");
const MAX_FILE_SIZE = 256 * 1024; // Skip files > 256 KB
const MAX_LINES_PER_MATCH = 5;    // Context lines around each match

// ─── Patterns to search for ──────────────────────────────────────────────────

const PATTERNS = {
  httpRoutes: [
    /\b(app|router|server)\s*\.\s*(get|post|put|patch|delete|all)\s*\(/gi,
    /express\s*\(\s*\)/gi,
    /new\s+Router/gi,
    /fastify\.route\s*\(/gi,
    /hapi\.route\s*\(/gi,
    /koa\s*\(\s*\)/gi,
  ],
  websocket: [
    /WebSocket|wss?:\/\/|\.on\s*\(\s*['"]message['"]/gi,
    /io\.on\s*\(\s*['"]connection['"]/gi,
    /socket\.emit|socket\.on/gi,
  ],
  rpc: [
    /\bgrpc\b|\.proto\b|\bthrift\b|\btrpc\b|createServer\s*\(/gi,
    /ipc\.on|ipc\.send|ipcMain|ipcRenderer/gi,
  ],
  executionSubmit: [
    /\b(submit|execute|run|dispatch|start)\s*(Execution|Task|Job|Session|Agent|Browser)/gi,
    /createSession|startSession|newSession/gi,
    /createRun|startRun|submitJob/gi,
    /agentRun|agentSession|browserSession/gi,
  ],
  cancel: [
    /\b(cancel|stop|kill|terminate)\s*(Execution|Task|Job|Session|Run)/gi,
    /cancelRun|cancelJob|stopAgent/gi,
  ],
  pause: [
    /\b(pause|suspend|resume)\s*(Execution|Task|Job|Session|Run)/gi,
    /pauseRun|resumeRun/gi,
  ],
  events: [
    /\b(emit|broadcast|publish|notify)\s*\(/gi,
    /EventEmitter|event\.emit|stream\.push/gi,
    /webhook|callback|callbackUrl/gi,
  ],
  auth: [
    /Bearer\s+|apiKey|api_key|Authorization|authenticate/gi,
    /jwt\.sign|jwt\.verify|jsonwebtoken/gi,
    /basicAuth|hmac|token/gi,
  ],
  cli: [
    /commander\.program|yargs\.command|process\.argv/gi,
    /\bcli\b.*\bcommand\b|\bcommand\b.*\bcli\b/gi,
    /bin:\s*\{|"bin"\s*:/gi,
  ],
  sdkExports: [
    /^export\s+(default|class|function|const|interface|type)\s+/gm,
    /module\.exports\s*=/gi,
  ],
};

// ─── File discovery ───────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage",
  ".next", ".nuxt", "out", ".turbo", ".cache", "__pycache__",
]);

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".proto", ".go", ".py"]);

function* walkFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        yield* walkFiles(full);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (SOURCE_EXTS.has(ext)) {
        yield full;
      }
    }
  }
}

// ─── Search engine ────────────────────────────────────────────────────────────

function searchFile(filePath, patterns) {
  let content;
  try {
    const stat = statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) return null;
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  const hits = [];

  for (const [category, regexes] of Object.entries(patterns)) {
    for (const regex of regexes) {
      regex.lastIndex = 0;
      let m;
      while ((m = regex.exec(content)) !== null) {
        // Find which line this match is on
        const before = content.slice(0, m.index);
        const lineNum = before.split("\n").length;
        const start = Math.max(0, lineNum - 2);
        const end = Math.min(lines.length, lineNum + MAX_LINES_PER_MATCH - 1);
        const context = lines.slice(start, end).join("\n");

        hits.push({ category, match: m[0], lineNum, context });

        // Avoid runaway matches
        if (hits.length > 200) break;
      }
      if (hits.length > 200) break;
    }
    if (hits.length > 200) break;
  }

  return hits.length > 0 ? { file: relative(ROOT, filePath), hits } : null;
}

// ─── package.json analysis ────────────────────────────────────────────────────

function analyzePackageJson() {
  const pkgs = [];

  function findPackageJsons(dir, depth = 0) {
    if (depth > 3) return;
    const p = join(dir, "package.json");
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf8"));
        pkgs.push({
          path: relative(ROOT, p),
          name: data.name,
          version: data.version,
          main: data.main,
          module: data.module,
          exports: data.exports,
          bin: data.bin,
          scripts: data.scripts,
          dependencies: Object.keys(data.dependencies ?? {}),
          devDependencies: Object.keys(data.devDependencies ?? {}).slice(0, 20),
        });
      } catch {}
    }
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && !IGNORE_DIRS.has(e.name)) {
        findPackageJsons(join(dir, e.name), depth + 1);
      }
    }
  }

  findPackageJsons(ROOT);
  return pkgs;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\nOpenClaw Source Inspector`);
console.log(`Repository: ${ROOT}`);
console.log(`─`.repeat(60));

const startedAt = Date.now();

// 1. Scan all source files
const results = [];
let scannedCount = 0;

for (const filePath of walkFiles(ROOT)) {
  scannedCount++;
  const result = searchFile(filePath, PATTERNS);
  if (result) results.push(result);
}

// 2. Analyse package.json files
const packageJsons = analyzePackageJson();

// 3. Find entry points
const entryPoints = packageJsons.flatMap(p => [p.main, p.module, ...(Array.isArray(p.exports) ? p.exports : Object.values(p.exports ?? {}))].filter(Boolean));

// 4. Categorise findings
const byCategory = {};
for (const result of results) {
  for (const hit of result.hits) {
    if (!byCategory[hit.category]) byCategory[hit.category] = [];
    byCategory[hit.category].push({ file: result.file, lineNum: hit.lineNum, match: hit.match });
  }
}

const categoryTotals = Object.fromEntries(
  Object.entries(byCategory).map(([k, v]) => [k, v.length])
);

// 5. Build report
const report = {
  inspectedAt: new Date().toISOString(),
  repositoryPath: ROOT,
  scannedFiles: scannedCount,
  matchingFiles: results.length,
  elapsedMs: Date.now() - startedAt,
  packages: packageJsons,
  entryPoints,
  categoryTotals,
  findingsByFile: results,
};

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

// 6. Print concise summary
console.log(`\nScanned ${scannedCount} source files in ${Date.now() - startedAt}ms`);
console.log(`Found matches in ${results.length} files\n`);

console.log("── Pattern category hits ──");
for (const [cat, count] of Object.entries(categoryTotals)) {
  console.log(`  ${cat.padEnd(20)} ${count} hits`);
}

console.log("\n── Packages found ──");
for (const pkg of packageJsons) {
  console.log(`  ${pkg.path}`);
  if (pkg.bin) console.log(`    bin: ${JSON.stringify(pkg.bin)}`);
  if (pkg.main) console.log(`    main: ${pkg.main}`);
  if (pkg.scripts && Object.keys(pkg.scripts).length) {
    console.log(`    scripts: ${Object.keys(pkg.scripts).join(", ")}`);
  }
}

console.log("\n── Top files by match count ──");
const sorted = [...results].sort((a, b) => b.hits.length - a.hits.length).slice(0, 10);
for (const r of sorted) {
  const cats = [...new Set(r.hits.map(h => h.category))].join(", ");
  console.log(`  ${r.file}  (${r.hits.length} hits — ${cats})`);
}

console.log("\n── HTTP route candidates ──");
const httpFiles = (byCategory.httpRoutes ?? []).map(h => h.file);
const uniqueHttpFiles = [...new Set(httpFiles)].slice(0, 10);
if (uniqueHttpFiles.length) {
  for (const f of uniqueHttpFiles) console.log(`  ${f}`);
} else {
  console.log("  (none found — may use a non-Express HTTP framework)");
}

console.log("\n── WebSocket / RPC candidates ──");
const wsFiles = [...new Set([
  ...(byCategory.websocket ?? []).map(h => h.file),
  ...(byCategory.rpc ?? []).map(h => h.file),
])].slice(0, 10);
if (wsFiles.length) {
  for (const f of wsFiles) console.log(`  ${f}`);
} else {
  console.log("  (none found)");
}

console.log("\n── Execution / session submission candidates ──");
const execFiles = [...new Set((byCategory.executionSubmit ?? []).map(h => h.file))].slice(0, 10);
if (execFiles.length) {
  for (const f of execFiles) console.log(`  ${f}`);
} else {
  console.log("  (none found)");
}

console.log("\n── CLI / bin entry points ──");
const cliFiles = [...new Set((byCategory.cli ?? []).map(h => h.file))].slice(0, 5);
if (cliFiles.length) {
  for (const f of cliFiles) console.log(`  ${f}`);
} else {
  console.log("  (none found)");
}

console.log(`\n✓ Full report written to: ${REPORT_PATH}`);
console.log(`\nPaste the following into Replit to proceed with Phase 4:\n`);
console.log(`--- BEGIN PASTE ---`);
console.log(JSON.stringify({
  scannedFiles: scannedCount,
  matchingFiles: results.length,
  categoryTotals,
  packages: packageJsons.map(p => ({
    path: p.path, name: p.name, bin: p.bin, main: p.main, scripts: p.scripts
  })),
  topFiles: sorted.slice(0, 8).map(r => ({
    file: r.file,
    hits: r.hits.length,
    categories: [...new Set(r.hits.map(h => h.category))],
    sample: r.hits.slice(0, 3).map(h => ({ category: h.category, line: h.lineNum, context: h.context.slice(0, 200) }))
  })),
  httpRouteFiles: uniqueHttpFiles,
  wsRpcFiles: wsFiles,
  executionFiles: execFiles,
  cliFiles,
}, null, 2));
console.log(`--- END PASTE ---`);
