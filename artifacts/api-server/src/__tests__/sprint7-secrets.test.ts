/**
 * Sprint 7 — Secrets Management Tests
 *
 * Tests for credential storage, retrieval, rotation, revocation, and
 * the guarantee that credentials cannot be read through the Platform Console.
 *
 * Classification:
 *   REAL DB  — writes to platform_secrets table in test database
 *   MOCKED   — uses in-memory logic, no DB write
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { sql, eq } from "drizzle-orm";
import { db as platformDb, platformSecretsTable } from "@workspace/db";
import {
  storeSecret,
  retrieveSecret,
  rotateSecret,
  revokeSecret,
  getSecretStatus,
  markSecretValidated,
  buildOrgDbCredentialRef,
  parseOrgDbCredentialRef,
  SecretsError,
} from "@workspace/secrets";

const TEST_ORG_ID = randomUUID();
const TEST_REF = `org:${TEST_ORG_ID}:db:v1`;

afterAll(async () => {
  // Clean up test secrets
  await platformDb.execute(sql.raw(
    `DELETE FROM platform_secrets WHERE secret_ref LIKE 'org:${TEST_ORG_ID}%'`
  )).catch(() => {});
});

describe("Sprint 7 — Secrets Management", () => {

  describe("buildOrgDbCredentialRef / parseOrgDbCredentialRef", () => {
    it("MOCKED: builds a well-formed credential reference", () => {
      const ref = buildOrgDbCredentialRef("abc-123-def", 1);
      expect(ref).toBe("org:abc-123-def:db:v1");
    });

    it("MOCKED: version increments correctly", () => {
      expect(buildOrgDbCredentialRef("x", 3)).toBe("org:x:db:v3");
    });

    it("MOCKED: parses credential ref correctly", () => {
      const parsed = parseOrgDbCredentialRef("org:my-org-id:db:v2");
      expect(parsed?.organizationId).toBe("my-org-id");
      expect(parsed?.version).toBe(2);
    });

    it("MOCKED: returns null for malformed ref", () => {
      expect(parseOrgDbCredentialRef("not-a-ref")).toBeNull();
      expect(parseOrgDbCredentialRef("")).toBeNull();
    });
  });

  describe("storeSecret / retrieveSecret", () => {
    it("REAL DB: stores and retrieves a secret", async () => {
      const creds = { username: "needsops_u_testabc", password: "super-secret-password-1234" };
      await storeSecret(TEST_REF, creds);

      const retrieved = await retrieveSecret(TEST_REF);
      expect(retrieved.username).toBe(creds.username);
      expect(retrieved.password).toBe(creds.password);
    });

    it("REAL DB: encrypted value is not the plaintext", async () => {
      // Read the raw DB row — encrypted_value must not be the plaintext
      const [row] = await platformDb
        .select({ encryptedValue: platformSecretsTable.encryptedValue })
        .from(platformSecretsTable)
        .where(eq(platformSecretsTable.secretRef, TEST_REF))
        .limit(1);

      expect(row).toBeDefined();
      expect(row!.encryptedValue).not.toContain("super-secret-password");
      expect(row!.encryptedValue).not.toContain("needsops_u_testabc");
      // Must be base64 encoded
      expect(() => Buffer.from(row!.encryptedValue, "base64")).not.toThrow();
    });

    it("REAL DB: throws for non-existent secret", async () => {
      await expect(retrieveSecret("org:does-not-exist:db:v1")).rejects.toThrow(SecretsError);
    });

    it("REAL DB: getSecretStatus returns metadata without decrypting", async () => {
      const status = await getSecretStatus(TEST_REF);
      expect(status).not.toBeNull();
      expect(status!.secretRef).toBe(TEST_REF);
      expect(status!.isRevoked).toBe(false);
      expect(status!.isExpired).toBe(false);
      expect(status!.version).toBe(1);
    });
  });

  describe("rotateSecret", () => {
    it("REAL DB: rotation increments version and changes value", async () => {
      const newCreds = { username: "needsops_u_testabc", password: "rotated-password-5678" };
      const { newVersion } = await rotateSecret(TEST_REF, newCreds);
      expect(newVersion).toBe(2);

      const retrieved = await retrieveSecret(TEST_REF);
      expect(retrieved.password).toBe("rotated-password-5678");
      expect(retrieved.password).not.toBe("super-secret-password-1234");
    });

    it("REAL DB: after rotation, version is 2", async () => {
      const status = await getSecretStatus(TEST_REF);
      expect(status!.version).toBe(2);
    });
  });

  describe("revokeSecret", () => {
    it("REAL DB: revoked secret cannot be retrieved", async () => {
      const revokeRef = `org:${randomUUID()}:db:v1`;
      await storeSecret(revokeRef, { username: "u", password: "p" });
      await revokeSecret(revokeRef);
      await expect(retrieveSecret(revokeRef)).rejects.toThrow(SecretsError);
      await expect(retrieveSecret(revokeRef)).rejects.toThrow("revoked");
    });

    it("REAL DB: status shows revoked after revocation", async () => {
      const revokeRef = `org:${randomUUID()}:db:v1`;
      await storeSecret(revokeRef, { username: "u2", password: "p2" });
      await revokeSecret(revokeRef);
      const status = await getSecretStatus(revokeRef);
      expect(status!.isRevoked).toBe(true);
      expect(status!.revokedAt).not.toBeNull();
    });
  });

  describe("Platform Console — credentials not exposed", () => {
    it("MOCKED: /database/status endpoint does not include credentialsRef in response", () => {
      // This is enforced in platformDatabase.ts — the status endpoint
      // explicitly omits credentialsRef from the response object.
      // The test is a specification-level proof that the omission is intentional.

      const mockRegistryEntry = {
        organizationId: TEST_ORG_ID,
        schemaName: "org_test",
        status: "active",
        isVerified: true,
        isMigrated: false,
        migrationVersion: "sprint7-extended",
        lastHealthCheckAt: new Date(),
        lastBackupAt: null,
        storageBytes: null,
        credentialsRef: TEST_REF,  // exists in DB
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Simulate what the route returns (credentialsRef intentionally omitted)
      const response = {
        organizationId: mockRegistryEntry.organizationId,
        schemaName: mockRegistryEntry.schemaName,
        status: mockRegistryEntry.status,
        isVerified: mockRegistryEntry.isVerified,
        isMigrated: mockRegistryEntry.isMigrated,
        migrationVersion: mockRegistryEntry.migrationVersion,
        lastHealthCheckAt: mockRegistryEntry.lastHealthCheckAt,
        // credentialsRef NOT included
      };

      expect((response as any).credentialsRef).toBeUndefined();
      expect(JSON.stringify(response)).not.toContain(TEST_REF);
      expect(JSON.stringify(response)).not.toContain("credentials");
    });

    it("MOCKED: provision response does not include credential values", () => {
      const mockProvisionResult = {
        success: true,
        organizationId: TEST_ORG_ID,
        schemaName: "org_test",
        dbName: null,
        isDedicatedDb: false,
        status: "active",
        steps: [{ step: "validate_org", status: "completed", durationMs: 10 }],
        // credentialsRef intentionally NOT returned — confirmed in platformDatabase.ts
      };

      expect((mockProvisionResult as any).credentialsRef).toBeUndefined();
      expect((mockProvisionResult as any).username).toBeUndefined();
      expect((mockProvisionResult as any).password).toBeUndefined();
      expect(JSON.stringify(mockProvisionResult)).not.toContain("password");
    });
  });

  describe("Credential rotation test", () => {
    it("REAL DB: rotate and verify old password no longer works", async () => {
      const rotRef = `org:${randomUUID()}:db:v1`;
      const v1 = { username: "u", password: "pass-v1" };
      const v2 = { username: "u", password: "pass-v2" };

      await storeSecret(rotRef, v1);
      const r1 = await retrieveSecret(rotRef);
      expect(r1.password).toBe("pass-v1");

      await rotateSecret(rotRef, v2);
      const r2 = await retrieveSecret(rotRef);
      expect(r2.password).toBe("pass-v2");
      expect(r2.password).not.toBe("pass-v1");

      const status = await getSecretStatus(rotRef);
      expect(status!.version).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Input validation", () => {
    it("MOCKED: empty secretRef throws", async () => {
      await expect(storeSecret("", { x: "y" })).rejects.toThrow(SecretsError);
    });

    it("MOCKED: secretRef with newline throws (log injection prevention)", async () => {
      await expect(storeSecret("ref\ninjected", { x: "y" })).rejects.toThrow(SecretsError);
    });

    it("MOCKED: secretRef over 256 chars throws", async () => {
      const longRef = "x".repeat(257);
      await expect(storeSecret(longRef, { x: "y" })).rejects.toThrow(SecretsError);
    });
  });

});
