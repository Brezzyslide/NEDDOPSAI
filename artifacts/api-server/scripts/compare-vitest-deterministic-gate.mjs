#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [, , parentPath, currentPath] = process.argv;

if (!parentPath || !currentPath) {
  console.error("Usage: compare-vitest-deterministic-gate.mjs <parent-json> <current-json>");
  process.exit(2);
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
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return relative(process.cwd(), absolute);
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

const parent = readReport(parentPath);
const current = readReport(currentPath);
const zeroCollectedExclusions = readZeroCollectedExclusions();
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
  },
  current: {
    total: current.numTotalTests,
    failed: current.numFailedTests,
    passed: current.numPassedTests,
    skipped: current.numPendingTests,
  },
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

if (releaseOnly.length > 0 || totalDropped || unexpectedParentZeroCollected.length > 0 || unexpectedCurrentZeroCollected.length > 0) {
  if (releaseOnly.length > 0) console.error(`Release-only failures: ${releaseOnly.length}`);
  if (totalDropped) console.error(`Total test count dropped: ${parent.numTotalTests} -> ${current.numTotalTests}`);
  if (unexpectedParentZeroCollected.length > 0) console.error(`Parent files collected zero tests: ${unexpectedParentZeroCollected.map(item => item.file).join(", ")}`);
  if (unexpectedCurrentZeroCollected.length > 0) console.error(`Current files collected zero tests: ${unexpectedCurrentZeroCollected.map(item => item.file).join(", ")}`);
  process.exit(1);
}
