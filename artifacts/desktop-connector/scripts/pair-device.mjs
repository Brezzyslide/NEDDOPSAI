#!/usr/bin/env node
/**
 * pair-device.mjs — NeedsOps Desktop Connector Device Pairing Script
 *
 * Performs the full device activation/pairing flow and persists credentials
 * to ~/.needsops/relay-credentials.json (TEMPORARY DEVELOPMENT FALLBACK store).
 *
 * After pairing, the broker reads credentials from the store automatically
 * on every startup — no manual token handling required.
 *
 * Usage:
 *   node scripts/pair-device.mjs
 *
 * Required environment variables:
 *   NEEDSOPS_API_BASE_URL      HTTPS base URL of the NeedsOps API
 *                              e.g. https://<dev-domain>/api-server
 *   NEEDSOPS_ACTIVATION_CODE   Plaintext activation code from the portal
 *                              (Settings → Activation Code → Generate)
 *   NEEDSOPS_ORG_ID            Organisation UUID
 *                              e.g. e13f274d-68e6-4e58-b1dd-26361b1ac564
 *
 * Optional:
 *   NEEDSOPS_DISPLAY_NAME      Display name for this device (default: hostname)
 *
 * Security:
 *   - Private key never leaves this machine
 *   - brokerAuthToken displayed only in the summary (store in your password manager)
 *   - Relay access + refresh tokens are stored in the credential file, never printed
 *   - Credential file permissions: 0o600 (owner read/write only)
 */

import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

// ── Credential store (inlined from credentialStore.ts for standalone use) ─────

const CREDENTIAL_DIR  = path.join(os.homedir(), ".needsops");
const CREDENTIAL_PATH = path.join(CREDENTIAL_DIR, "relay-credentials.json");

function deriveMachineKey() {
  const seed = [os.hostname(), os.userInfo().username, "needsops-relay-dev-v1"].join("|");
  return crypto.createHash("sha256").update(seed).digest();
}

function encryptCredentials(credentials) {
  const plaintext = JSON.stringify(credentials);
  const key = deriveMachineKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function saveCredentials(credentials) {
  fs.mkdirSync(CREDENTIAL_DIR, { recursive: true });
  const encoded = encryptCredentials(credentials);
  const tmp = `${CREDENTIAL_PATH}.tmp`;
  fs.writeFileSync(tmp, encoded, { mode: 0o600 });
  fs.renameSync(tmp, CREDENTIAL_PATH);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function require_env(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n✗ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

function redact(token) {
  if (!token || token.length < 8) return "***";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

async function apiPost(apiBaseUrl, path_, body, bearerToken) {
  const url = `${apiBaseUrl.replace(/\/$/, "")}${path_}`;
  const headers = { "Content-Type": "application/json" };
  if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: non-JSON response from ${url}\n${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json?.error?.message ?? json?.message ?? JSON.stringify(json);
    throw new Error(`HTTP ${res.status} from ${url}: ${msg}`);
  }

  return json;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  NeedsOps Desktop Connector — Device Pairing");
  console.log("═══════════════════════════════════════════════════════\n");

  const apiBaseUrl         = require_env("NEEDSOPS_API_BASE_URL");
  const activationCode     = require_env("NEEDSOPS_ACTIVATION_CODE");
  const organizationId     = require_env("NEEDSOPS_ORG_ID");
  const displayName        = process.env["NEEDSOPS_DISPLAY_NAME"] ?? `${os.hostname()} Dev`;

  console.log(`API URL:          ${apiBaseUrl}`);
  console.log(`Organisation:     ${organizationId}`);
  console.log(`Display name:     ${displayName}`);
  console.log(`Platform:         ${process.platform}/${process.arch}`);
  console.log(`Hostname:         ${os.hostname()}`);
  console.log();

  // ── Step 1: Generate Ed25519 key pair ──────────────────────────────────────
  console.log("Step 1/4  Generating Ed25519 key pair...");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding:  { type: "spki",  format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  // Store private key next to credentials — same directory, same permissions
  const privateKeyPath = path.join(CREDENTIAL_DIR, "relay-device.key");
  fs.mkdirSync(CREDENTIAL_DIR, { recursive: true });
  fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  console.log(`  ✓ Private key stored at ${privateKeyPath}`);

  // ── Step 2: Redeem activation code ────────────────────────────────────────
  console.log("\nStep 2/4  Redeeming activation code...");
  const redeemResult = await apiPost(apiBaseUrl, "/v1/activation-codes/redeem", {
    code:           activationCode,
    organizationId,
    platform:       process.platform,
    arch:           process.arch,
    hostname:       os.hostname(),
    osVersion:      os.release(),
    appVersion:     "1.0.0",
    displayName,
    // SECURITY: publicKey is registered server-side for challenge signing.
    // This is the only value sent over the network from this key pair.
    publicKey:      publicKey.trim(),
  });

  const deviceId      = redeemResult.deviceId;
  const brokerToken   = redeemResult.brokerAuthToken;
  const redeemOrgId   = redeemResult.organizationId;

  console.log(`  ✓ Device registered`);
  console.log(`    deviceId:       ${deviceId}`);
  console.log(`    organizationId: ${redeemOrgId}`);
  console.log(`    brokerAuthToken: ${redact(brokerToken)}  ← store this in your password manager`);

  if (redeemOrgId !== organizationId) {
    console.warn(`  ⚠ Warning: server returned organizationId (${redeemOrgId}) differs from NEEDSOPS_ORG_ID (${organizationId})`);
    console.warn("    Using server-issued organizationId.");
  }

  // ── Step 3: Challenge/Exchange ─────────────────────────────────────────────
  console.log("\nStep 3/4  Performing challenge/exchange for relay access token...");

  const challengeResult = await apiPost(
    apiBaseUrl,
    "/v1/devices/auth/challenge",
    { deviceId, organizationId: redeemOrgId },
    brokerToken,
  );
  const { challengeId, nonce } = challengeResult;
  console.log(`  ✓ Challenge issued: ${challengeId}`);

  // Sign the nonce with the Ed25519 private key
  const nonceBuffer = Buffer.from(nonce, "utf8");
  const keyObj = crypto.createPrivateKey({ key: privateKey, format: "pem", type: "pkcs8" });
  const signatureBuffer = crypto.sign(null, nonceBuffer, keyObj);
  const signature = signatureBuffer.toString("base64");

  const exchangeResult = await apiPost(apiBaseUrl, "/v1/devices/auth/exchange", {
    deviceId,
    organizationId: redeemOrgId,
    challengeId,
    signature,
  });

  const {
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    refreshTokenExpiresAt,
  } = exchangeResult;

  console.log(`  ✓ Tokens issued`);
  console.log(`    accessToken expires:  ${accessTokenExpiresAt}`);
  console.log(`    refreshToken expires: ${refreshTokenExpiresAt}`);
  // SECURITY: tokens are NOT printed — they are written directly to the store

  // ── Step 4: Persist credentials ────────────────────────────────────────────
  console.log("\nStep 4/4  Persisting credentials to store...");
  saveCredentials({
    deviceId,
    organizationId: redeemOrgId,
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    refreshTokenExpiresAt,
  });
  console.log(`  ✓ Credentials saved to ${CREDENTIAL_PATH}`);
  console.log(`    Permissions: 0o600 (owner read/write only)`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Pairing complete");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`\nDevice ID:        ${deviceId}`);
  console.log(`Organisation:     ${redeemOrgId}`);
  console.log(`Credential file:  ${CREDENTIAL_PATH}`);
  console.log(`Private key:      ${privateKeyPath}`);
  console.log();
  console.log("Next steps:");
  console.log(`  1. Ensure NEEDSOPS_API_BASE_URL=${apiBaseUrl} is set in the broker env`);
  console.log("  2. Restart the broker — relay will connect automatically");
  console.log("  3. Monitor broker logs for: [relay] Outbound WebSocket relay client started");
  console.log("  4. Verify in the portal: Settings → Connectors → this device shows 'Connected'");
  console.log();
  console.log("SECURITY reminder:");
  console.log("  Store the brokerAuthToken shown above in your password manager.");
  console.log("  It is needed to re-pair this device if credentials are lost.");
  console.log("  The private key and credential file contain sensitive material —");
  console.log("  do not share them or check them into version control.");
}

main().catch((err) => {
  console.error(`\n✗ Pairing failed: ${err.message}`);
  if (process.env.NODE_ENV !== "production") console.error(err.stack);
  process.exit(1);
});
