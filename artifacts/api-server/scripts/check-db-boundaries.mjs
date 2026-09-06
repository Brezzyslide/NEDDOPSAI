#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const apiRoot = path.resolve(new URL("../", import.meta.url).pathname);
const srcRoot = path.join(apiRoot, "src");
const allowlistPath = path.join(apiRoot, "scripts/db-boundary-allowlist.json");

const allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
const allowed = new Map();

for (const entry of allowlist.entries ?? []) {
  if (!entry.file || !entry.kind || !entry.reason || entry.reason.trim().length < 12) {
    throw new Error(`Invalid db boundary allowlist entry: ${JSON.stringify(entry)}`);
  }
  const key = `${entry.kind}:${normaliseFile(entry.file)}`;
  allowed.set(key, entry.reason);
}

const requestPathRoots = [
  path.join(srcRoot, "routes"),
  path.join(srcRoot, "middlewares"),
  path.join(srcRoot, "services"),
];

const excludedSegments = new Set([
  "__tests__",
  "__mocks__",
  "tests",
  "scripts",
  "workers",
  "bootstrap",
  "startup",
]);

const violations = [];

for (const file of listTypeScriptFiles(requestPathRoots)) {
  const rel = normaliseFile(path.relative(apiRoot, file));
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);

  if (hasPlatformDbImport(source) && !isPlatformRouteFile(rel) && !isAllowed("platform-db-import", rel)) {
    violations.push({
      kind: "platform-db-import",
      file: rel,
      line: firstPlatformDbLine(lines),
      text: "tenant/request-path file imports or aliases platformDb",
    });
  }

  lines.forEach((line, index) => {
    const code = stripLineComment(line);
    if (!hasDirectDbUse(code)) return;
    if (isAllowed("direct-db", rel)) return;

    violations.push({
      kind: "direct-db",
      file: rel,
      line: index + 1,
      text: line.trim(),
    });
  });
}

if (violations.length > 0) {
  console.error(`DB boundary check failed: ${violations.length} violation(s)`);
  for (const violation of violations) {
    console.error(`${violation.kind}\t${violation.file}:${violation.line}\t${violation.text}`);
  }
  process.exit(1);
}

console.log("DB boundary check passed: no request-path db boundary violations.");

function normaliseFile(file) {
  return file.split(path.sep).join("/");
}

function isAllowed(kind, file) {
  return allowed.has(`${kind}:${file}`);
}

function isPlatformRouteFile(file) {
  return (
    /^src\/routes\/v1\/platform[A-Z][^/]*\.ts$/.test(file) ||
    file === "src/routes/v1/platform.ts" ||
    file === "src/routes/v1/admin.ts"
  );
}

function hasPlatformDbImport(source) {
  return (
    /from\s+["']@workspace\/db\/platform["']/.test(source) ||
    /import\s*\(\s*["']@workspace\/db\/platform["']\s*\)/.test(source) ||
    /\bdb\s+as\s+platformDb\b/.test(source) ||
    /\bdb\s*:\s*platformDb\b/.test(source)
  );
}

function firstPlatformDbLine(lines) {
  const index = lines.findIndex((line) => (
    line.includes("@workspace/db/platform") ||
    line.includes("db as platformDb") ||
    line.includes("db: platformDb")
  ));
  return index >= 0 ? index + 1 : 1;
}

function hasDirectDbUse(code) {
  return /(?<![\w$.])db\s*\./.test(code);
}

function stripLineComment(line) {
  const index = line.indexOf("//");
  return index >= 0 ? line.slice(0, index) : line;
}

function listTypeScriptFiles(roots) {
  const files = [];
  for (const root of roots) {
    walk(root, files);
  }
  return files.sort();
}

function walk(dir, files) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludedSegments.has(entry.name)) continue;
      walk(full, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }
}
