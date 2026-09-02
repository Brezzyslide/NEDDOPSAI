#!/usr/bin/env node
import { readFileSync } from "node:fs";

const [, , parentPath, currentPath] = process.argv;

if (!parentPath || !currentPath) {
  console.error("Usage: compare-vitest-deterministic-gate.mjs <parent-json> <current-json>");
  process.exit(2);
}

function readReport(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function testName(assertion) {
  return [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean).join(" :: ");
}

function filePath(result) {
  return result.name ?? result.testFilePath ?? "unknown";
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
      file: filePath(result),
      status: result.status,
      message: String(result.message ?? "").split("\n").slice(0, 2).join(" "),
    }));
}

function assertionCountByFile(report) {
  const counts = new Map();
  for (const result of report.testResults ?? []) {
    counts.set(filePath(result), (result.assertionResults ?? []).length);
  }
  return counts;
}

const parent = readReport(parentPath);
const current = readReport(currentPath);
const parentFailures = failedNames(parent);
const currentFailures = failedNames(current);
const parentFailureSet = new Set(parentFailures);
const releaseOnly = currentFailures.filter(name => !parentFailureSet.has(name));
const parentAssertionCounts = assertionCountByFile(parent);
const zeroCollected = zeroCollectedFiles(current)
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
  zeroCollectedFiles: zeroCollected,
};

console.log(JSON.stringify(summary, null, 2));

if (releaseOnly.length > 0 || totalDropped || zeroCollected.length > 0) {
  if (releaseOnly.length > 0) console.error(`Release-only failures: ${releaseOnly.length}`);
  if (totalDropped) console.error(`Total test count dropped: ${parent.numTotalTests} -> ${current.numTotalTests}`);
  if (zeroCollected.length > 0) console.error(`Files collected zero tests: ${zeroCollected.map(item => item.file).join(", ")}`);
  process.exit(1);
}
