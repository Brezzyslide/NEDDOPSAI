#!/usr/bin/env node
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXPECTED_TEST_FILE_COUNT = 256;

const args = process.argv.slice(2);

if (args.length < 2 && args[0] !== "--run-current") {
  console.error([
    "Usage:",
    "  compare-vitest-deterministic-gate.mjs <parent-json> <current-json>",
    "  compare-vitest-deterministic-gate.mjs --run-current <parent-json> [current-json-output]",
  ].join("\n"));
  process.exit(2);
}

function runCurrentReport(outputPath) {
  const vitestArgs = [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.deterministic.ts",
    "--reporter=json",
    `--outputFile=${outputPath}`,
  ];
  console.log(`Running pinned deterministic gate: PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm ${vitestArgs.join(" ")}`);
  const result = spawnSync("pnpm", vitestArgs, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    process.exit(result.status ?? 1);
  }
}

let parentPath;
let currentPath;

if (args[0] === "--run-current") {
  parentPath = args[1];
  if (!parentPath) {
    console.error("Usage: compare-vitest-deterministic-gate.mjs --run-current <parent-json> [current-json-output]");
    process.exit(2);
  }
  currentPath = args[2] ?? resolve(mkdtempSync(resolve(tmpdir(), "needsops-deterministic-gate-")), "current.json");
  runCurrentReport(currentPath);
} else {
  [parentPath, currentPath] = args;
}

function readReport(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readZeroCollectedExclusions() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const path = resolve(scriptDir, "deterministic-zero-collected-exclusions.json");
  const exclusions = JSON.parse(readFileSync(path, "utf8"));
  return new Set(exclusions.map((entry) => normalisePath(entry.file)));
}

function testName(assertion) {
  return [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean).join(" :: ");
}

function filePath(result) {
  return result.name ?? result.testFilePath ?? "unknown";
}

function normalisePath(path) {
  if (!path || path === "unknown") return path;
  const marker = "artifacts/api-server/";
  const markerIndex = path.indexOf(marker);
  if (markerIndex >= 0) return path.slice(markerIndex + marker.length);
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return relative(process.cwd(), absolute);
}

function expectedTestFiles() {
  const result = spawnSync("git", [
    "ls-files",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  return new Set(result.stdout
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .filter(file => !file.startsWith("src/__tests__/integration/")));
}

function failedNames(report) {
  const names = [];
  for (const result of report.testResults ?? []) {
    for (const assertion of result.assertionResults ?? []) {
      if (assertion.status === "failed") names.push(testName(assertion));
    }
  }
  return Array.from(new Set(names)).sort();
}

function zeroCollectedFiles(report) {
  return (report.testResults ?? [])
    .filter(result => (result.assertionResults ?? []).length === 0)
    .map(result => ({
      file: normalisePath(filePath(result)),
      status: result.status,
      message: String(result.message ?? "").split("\n").slice(0, 2).join(" "),
    }));
}

function assertionCountByFile(report) {
  const counts = new Map();
  for (const result of report.testResults ?? []) {
    counts.set(normalisePath(filePath(result)), (result.assertionResults ?? []).length);
  }
  return counts;
}

function testFileCount(report) {
  return (report.testResults ?? []).length;
}

function validateReportShape(label, report, expectedFiles) {
  const count = testFileCount(report);
  const files = new Set((report.testResults ?? []).map(result => normalisePath(filePath(result))));
  const errors = [];
  if (count !== EXPECTED_TEST_FILE_COUNT) {
    errors.push({
      label,
      type: "file_count",
      expected: EXPECTED_TEST_FILE_COUNT,
      actual: count,
    });
  }
  if (expectedFiles) {
    const missing = [...expectedFiles].filter(file => !files.has(file)).sort();
    const extra = [...files].filter(file => !expectedFiles.has(file)).sort();
    if (missing.length > 0 || extra.length > 0) {
      errors.push({
        label,
        type: "file_set",
        missing,
        extra,
      });
    }
  }
  return errors;
}

const parent = readReport(parentPath);
const current = readReport(currentPath);
const zeroCollectedExclusions = readZeroCollectedExclusions();
const expectedFiles = expectedTestFiles();
const reportShapeErrors = [
  ...validateReportShape("parent", parent, expectedFiles),
  ...validateReportShape("current", current, expectedFiles),
];
const parentFailures = failedNames(parent);
const currentFailures = failedNames(current);
const parentFailureSet = new Set(parentFailures);
const releaseOnly = currentFailures.filter(name => !parentFailureSet.has(name));
const parentAssertionCounts = assertionCountByFile(parent);
const parentZeroCollected = zeroCollectedFiles(parent);
const currentZeroCollected = zeroCollectedFiles(current);
const unexpectedParentZeroCollected = parentZeroCollected
  .filter(result => !zeroCollectedExclusions.has(result.file));
const unexpectedCurrentZeroCollected = currentZeroCollected
  .filter(result => !zeroCollectedExclusions.has(result.file));
const newlyZeroCollected = currentZeroCollected
  .filter(result => (parentAssertionCounts.get(result.file) ?? 0) > 0);
const totalDropped = current.numTotalTests < parent.numTotalTests;

const summary = {
  parent: {
    total: parent.numTotalTests,
    failed: parent.numFailedTests,
    passed: parent.numPassedTests,
    skipped: parent.numPendingTests,
    files: testFileCount(parent),
  },
  current: {
    total: current.numTotalTests,
    failed: current.numFailedTests,
    passed: current.numPassedTests,
    skipped: current.numPendingTests,
    files: testFileCount(current),
  },
  expectedFiles: EXPECTED_TEST_FILE_COUNT,
  reportShapeErrors,
  releaseOnlyFailures: releaseOnly,
  zeroCollectedFiles: unexpectedCurrentZeroCollected,
  parentZeroCollectedFiles: unexpectedParentZeroCollected,
  newlyZeroCollectedFiles: newlyZeroCollected,
  excludedZeroCollectedFiles: {
    parent: parentZeroCollected.filter(result => zeroCollectedExclusions.has(result.file)).length,
    current: currentZeroCollected.filter(result => zeroCollectedExclusions.has(result.file)).length,
    configured: zeroCollectedExclusions.size,
  },
};

console.log(JSON.stringify(summary, null, 2));

if (releaseOnly.length > 0 || totalDropped || reportShapeErrors.length > 0 || unexpectedParentZeroCollected.length > 0 || unexpectedCurrentZeroCollected.length > 0) {
  if (releaseOnly.length > 0) console.error(`Release-only failures: ${releaseOnly.length}`);
  if (totalDropped) console.error(`Total test count dropped: ${parent.numTotalTests} -> ${current.numTotalTests}`);
  for (const error of reportShapeErrors) {
    if (error.type === "file_count") {
      console.error(`${error.label} test file count mismatch: expected ${error.expected}, got ${error.actual}`);
    } else {
      if (error.missing.length > 0) console.error(`${error.label} missing test files: ${error.missing.join(", ")}`);
      if (error.extra.length > 0) console.error(`${error.label} unexpected test files: ${error.extra.join(", ")}`);
    }
  }
  if (unexpectedParentZeroCollected.length > 0) console.error(`Parent files collected zero tests: ${unexpectedParentZeroCollected.map(item => item.file).join(", ")}`);
  if (unexpectedCurrentZeroCollected.length > 0) console.error(`Current files collected zero tests: ${unexpectedCurrentZeroCollected.map(item => item.file).join(", ")}`);
  process.exit(1);
}
