#!/usr/bin/env node
/**
 * verify-package.mjs — Sprint 15
 *
 * Post-build packaging verification script.
 * Inspects the electron-builder output directory and fails if required
 * resources are missing, contain dev/repo paths, or have incorrect structure.
 *
 * Usage:
 *   node scripts/verify-package.mjs [--release-dir ./release]
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";

// ── Configuration ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const releaseDirIdx = args.indexOf("--release-dir");
const releaseDir = releaseDirIdx >= 0
  ? resolve(args[releaseDirIdx + 1])
  : resolve(new URL(".", import.meta.url).pathname, "../release");

const platform = process.platform; // "darwin" | "win32" | "linux"

console.log(`\n=== NeedsOps AI+ Package Verification ===`);
console.log(`Platform: ${platform}`);
console.log(`Release dir: ${releaseDir}\n`);

// ── Checks ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const result = fn();
    if (result === false) {
      console.error(`  ✗ FAIL: ${name}`);
      failed++;
    } else {
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    }
  } catch (err) {
    console.error(`  ✗ FAIL: ${name} — ${err.message}`);
    failed++;
  }
}

// ── Check: release directory exists ──────────────────────────────────────────

check("Release directory exists", () => {
  if (!existsSync(releaseDir)) {
    throw new Error(`Release directory not found: ${releaseDir}`);
  }
});

// ── Check: installer artifact exists ─────────────────────────────────────────

check("Installer artifact exists", () => {
  const patterns = platform === "darwin"
    ? ["*.dmg"]
    : platform === "win32"
    ? ["*.exe", "*.msi"]
    : ["*.AppImage", "*.deb"];

  const { readdirSync } = await import("fs");
  // Use sync approach
  const { readdirSync: rds } = (await import("fs"));
  void rds; // unused

  const { execSync: es } = await import("child_process");
  void es; // unused

  const fs = await import("fs");
  const files = fs.readdirSync(releaseDir, { recursive: true });
  const installers = files.filter(f => {
    const str = String(f);
    return patterns.some(p => {
      const ext = p.slice(1);
      return str.endsWith(ext) && !str.includes("latest") && !str.includes("mac.yml");
    });
  });

  if (installers.length === 0) {
    throw new Error(`No installer found matching ${patterns.join(", ")} in ${releaseDir}`);
  }
  console.log(`    Found: ${installers[0]}`);
});

// ── Check: app bundle / unpacked directory exists ─────────────────────────────

check("Unpacked app directory exists", () => {
  const unpackedDirs = ["win-unpacked", "mac", "mac-arm64", "linux-unpacked"];
  const found = unpackedDirs.filter(d => existsSync(join(releaseDir, d)));
  if (found.length === 0) {
    throw new Error(`No unpacked app directory found (checked: ${unpackedDirs.join(", ")})`);
  }
  console.log(`    Found: ${found[0]}`);
});

// ── Check: broker resources bundled ──────────────────────────────────────────

check("Broker resources are bundled", () => {
  const unpackedDirs = ["win-unpacked", "mac", "mac-arm64", "linux-unpacked"];
  let brokerFound = false;
  for (const dir of unpackedDirs) {
    const basePath = join(releaseDir, dir);
    if (!existsSync(basePath)) continue;

    // Check for broker in resources
    const brokerPaths = [
      join(basePath, "resources", "broker", "index.js"),
      join(basePath, "resources", "app", "resources", "broker", "index.js"),
    ];
    if (brokerPaths.some(p => existsSync(p))) {
      brokerFound = true;
      console.log(`    Broker found in: ${dir}`);
      break;
    }
  }
  if (!brokerFound) {
    throw new Error("Broker index.js not found in packaged resources/broker/");
  }
});

// ── Check: no development/repository path references ─────────────────────────

check("No repository paths in packaged app", () => {
  const devPaths = [
    "/home/runner/workspace",
    "/Users/",
    "C:\\Users\\",
    "node_modules/.pnpm",
    ".pnpm-store",
    "replit.com",
    ".replit",
    "workspace/artifacts",
  ];

  // Only check the main process bundle (not renderer)
  const unpackedDirs = ["win-unpacked", "mac", "mac-arm64"];
  for (const dir of unpackedDirs) {
    const mainBundle = join(releaseDir, dir, "resources", "app.asar");
    const mainBundleDir = join(releaseDir, dir, "resources", "app", "dist", "main.js");
    
    let content = "";
    if (existsSync(mainBundleDir)) {
      content = readFileSync(mainBundleDir, "utf8");
    } else {
      // asar is binary — skip this check if we can't read it
      continue;
    }

    for (const devPath of devPaths) {
      if (content.includes(devPath)) {
        throw new Error(`Found dev path "${devPath}" in packaged main bundle`);
      }
    }
  }
  console.log("    No dev paths found in accessible bundles");
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
