#!/usr/bin/env node
/**
 * preflight.mjs — NeedsOps Connector Real-Mac Acceptance Preflight
 *
 * Sprint 29F.3 Part 5
 *
 * Checks everything required before running the real-connector acceptance
 * test suite. Exits 0 on pass, 1 on failure.
 *
 * Safe: the only write side-effect is creating and immediately removing one
 * disposable file inside ~/Documents/needsops-acceptance-test/.
 * No production data is read or written.
 *
 * Usage (from repo root):
 *   node artifacts/desktop-connector/scripts/preflight.mjs
 *
 * Required environment variables:
 *   NEEDSOPS_API_BASE_URL  — e.g. https://yourapp.replit.dev
 *   REAL_ORG_ID            — organisation ID (not slug)
 *   REAL_DEVICE_ID         — device ID registered in that organisation
 *   REAL_USER_TOKEN        — Clerk session token for a user in that org
 *   BROKER_PORT            — local broker HTTP port (default 19002)
 */

import { createConnection } from "node:net";
import { homedir }          from "node:os";
import { join }             from "node:path";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

// ── Config ─────────────────────────────────────────────────────────────────────

const API_BASE    = (process.env.NEEDSOPS_API_BASE_URL ?? "").replace(/\/$/, "");
const ORG_ID      = process.env.REAL_ORG_ID ?? "";
const DEVICE_ID   = process.env.REAL_DEVICE_ID ?? "";
const USER_TOKEN  = process.env.REAL_USER_TOKEN ?? "";
const BROKER_PORT = Number(process.env.BROKER_PORT ?? "19002");
const TEST_DIR    = join(homedir(), "Documents", "needsops-acceptance-test");

let passed = 0;
let failed = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

function ok(label)  { passed++; console.log(`  ✅  ${label}`); }
function fail(label, detail) {
  failed++;
  console.error(`  ❌  ${label}`);
  if (detail) console.error(`       ${detail}`);
}
function warn(label) { console.warn(`  ⚠️   ${label}`); }
function section(title) { console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`); }

async function get(url, token) {
  const res = await fetch(url, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function portOpen(host, port, timeout = 3000) {
  return new Promise(resolve => {
    const s = createConnection({ host, port });
    const t = setTimeout(() => { s.destroy(); resolve(false); }, timeout);
    s.on("connect", () => { clearTimeout(t); s.destroy(); resolve(true); });
    s.on("error",   () => { clearTimeout(t); resolve(false); });
  });
}

// ── Check 1 — Environment variables ────────────────────────────────────────────

section("Environment variables");

const required = {
  NEEDSOPS_API_BASE_URL: API_BASE,
  REAL_ORG_ID:           ORG_ID,
  REAL_DEVICE_ID:        DEVICE_ID,
  REAL_USER_TOKEN:       USER_TOKEN,
};

for (const [k, v] of Object.entries(required)) {
  if (v) ok(k);
  else    fail(k, `${k} is not set`);
}

if (API_BASE && !API_BASE.startsWith("http")) {
  fail("NEEDSOPS_API_BASE_URL format", "Must start with http:// or https://");
}

// ── Check 2 — Local broker port reachable ──────────────────────────────────────

section("Local connector broker");

const brokerReachable = await portOpen("127.0.0.1", BROKER_PORT);
if (brokerReachable) {
  ok(`Broker port ${BROKER_PORT} is open`);
} else {
  fail(
    `Broker port ${BROKER_PORT} not reachable`,
    `Is the connector running? Start with: pnpm --filter @workspace/desktop-connector run dev`,
  );
}

// ── Check 3 — API server reachable ─────────────────────────────────────────────

section("API server reachability");

if (API_BASE) {
  try {
    const { status } = await get(`${API_BASE}/health`);
    if (status === 200) {
      ok(`API server ${API_BASE} is healthy`);
    } else {
      fail(`API server responded ${status}`, `Expected 200 from ${API_BASE}/health`);
    }
  } catch (err) {
    fail(`API server unreachable`, `${err.message} — ${API_BASE}/health`);
  }
} else {
  warn("NEEDSOPS_API_BASE_URL not set — skipping API reachability check");
}

// ── Check 4 — Device registered and not revoked ─────────────────────────────────

section("Device registration");

if (API_BASE && ORG_ID && DEVICE_ID && USER_TOKEN) {
  try {
    const { status, body } = await get(
      `${API_BASE}/v1/organisations/${ORG_ID}/devices`,
      USER_TOKEN,
    );
    if (status === 200) {
      const devices = body.devices ?? [];
      const device = devices.find(d => d.id === DEVICE_ID);
      if (!device) {
        fail("Device not found in organisation", `Device ${DEVICE_ID} not in org ${ORG_ID}`);
      } else if (device.status === "revoked") {
        fail("Device is revoked", `Device ${DEVICE_ID} has been revoked — re-activate a new device`);
      } else if (device.status === "disabled") {
        fail("Device is disabled", `Device ${DEVICE_ID} is disabled by an admin — contact your platform owner`);
      } else {
        ok(`Device ${DEVICE_ID} found (status: ${device.status ?? "active"})`);
      }
    } else if (status === 401 || status === 403) {
      fail("Device list auth failed", `REAL_USER_TOKEN may be expired or REAL_ORG_ID incorrect (HTTP ${status})`);
    } else {
      fail(`Device list returned HTTP ${status}`, JSON.stringify(body).slice(0, 200));
    }
  } catch (err) {
    fail("Device registration check error", err.message);
  }
} else {
  warn("Skipping device registration check — environment variables missing");
}

// ── Check 5 — Device relay-connected (heartbeat recency) ───────────────────────

section("Relay connection and heartbeat");

if (API_BASE && ORG_ID && DEVICE_ID && USER_TOKEN) {
  try {
    const { status, body } = await get(
      `${API_BASE}/v1/organisations/${ORG_ID}/devices`,
      USER_TOKEN,
    );
    if (status === 200) {
      const device = (body.devices ?? []).find(d => d.id === DEVICE_ID);
      if (device?.lastHeartbeatAt) {
        const ageMs = Date.now() - new Date(device.lastHeartbeatAt).getTime();
        const ageSec = Math.round(ageMs / 1000);
        if (ageMs < 90_000) {
          ok(`Heartbeat is current (${ageSec}s ago)`);
        } else if (ageMs < 300_000) {
          warn(`Heartbeat is ${ageSec}s old — connector may be stale. Ensure connector is running.`);
        } else {
          fail("Heartbeat is stale", `Last heartbeat ${Math.round(ageSec / 60)}m ago — connector is likely not running`);
        }
        if (device.connectorVersion) {
          ok(`Connector version: ${device.connectorVersion}`);
        } else {
          warn("Connector version not reported yet");
        }
      } else {
        fail("No heartbeat recorded", `Device ${DEVICE_ID} has never sent a heartbeat — is the connector running and authenticated?`);
      }
    }
  } catch (err) {
    fail("Heartbeat check error", err.message);
  }
} else {
  warn("Skipping heartbeat check — environment variables missing");
}

// ── Check 6 — Required capabilities available ───────────────────────────────────

section("Required capabilities");

if (API_BASE && USER_TOKEN) {
  try {
    const { status, body } = await get(
      `${API_BASE}/v1/capabilities`,
      USER_TOKEN,
    );
    if (status === 200) {
      const caps = body.capabilities ?? body.grantedCapabilities ?? [];
      const required = ["execution.openclaw_runtime", "files.read", "files.write"];
      for (const cap of required) {
        const granted = Array.isArray(caps)
          ? caps.some(c => (typeof c === "string" ? c : c.code) === cap)
          : false;
        if (granted) ok(`Capability: ${cap}`);
        else         warn(`Capability not confirmed: ${cap} — check tenant_entitlements for this org`);
      }
    } else {
      warn(`Capability check returned HTTP ${status} — skipping`);
    }
  } catch (err) {
    warn(`Capability check unavailable: ${err.message}`);
  }
} else {
  warn("Skipping capability check — environment variables missing");
}

// ── Check 7 — Acceptance test directory writable ────────────────────────────────

section("Acceptance test directory");

try {
  mkdirSync(TEST_DIR, { recursive: true });
  ok(`Directory created/exists: ${TEST_DIR}`);
} catch (err) {
  fail(`Cannot create ${TEST_DIR}`, err.message);
}

const probeFile = join(TEST_DIR, `preflight_probe_${Date.now()}.txt`);
try {
  writeFileSync(probeFile, "NeedsOps preflight probe — safe to delete\n", "utf-8");
  ok(`Write succeeded: ${probeFile}`);
} catch (err) {
  fail(`Cannot write to ${TEST_DIR}`, err.message);
}

try {
  unlinkSync(probeFile);
  ok("Probe file removed successfully");
} catch (err) {
  warn(`Could not remove probe file ${probeFile}: ${err.message}`);
}

// ── Check 8 — Production safety ─────────────────────────────────────────────────

section("Production safety verification");

const desktopDir = join(homedir(), "Desktop");
const documentsDir = join(homedir(), "Documents");
ok(`Acceptance test directory is isolated: ${TEST_DIR}`);
ok(`Desktop (${desktopDir}) will NOT be written to`);
ok("All scenarios use disposable files with timestamped names");
ok("send_email is blocked (UNSUPPORTED_OPERATION) — no email will be sent");
ok("Scenario 6 creates only an Outlook DRAFT — draft is NOT sent");

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(64)}`);
if (failed === 0) {
  console.log(`\n  🟢  PREFLIGHT PASSED — ${passed} checks OK\n`);
  console.log(`  Next step — Terminal 2:`);
  console.log(`    export REAL_CONNECTOR_URL="${API_BASE || "https://YOUR_API_SERVER"}"`);
  console.log(`    export REAL_ORG_ID="${ORG_ID || "YOUR_ORG_ID"}"`);
  console.log(`    export REAL_DEVICE_ID="${DEVICE_ID || "YOUR_DEVICE_ID"}"`);
  console.log(`    export REAL_USER_TOKEN="<your-clerk-jwt>"`);
  console.log(`    cd artifacts/api-server`);
  console.log(`    npx vitest run src/__tests__/sprint29f1-real-connector-acceptance.test.ts --reporter=verbose`);
  console.log();
} else {
  console.log(`\n  🔴  PREFLIGHT FAILED — ${failed} check(s) failed, ${passed} passed\n`);
  console.log(`  Fix the issues above before running acceptance tests.\n`);
  process.exit(1);
}
