/**
 * Secrets Provider Interface — Sprint 7.1
 *
 * Abstracts secret storage so the backing provider can be swapped without
 * changing callers. The current implementation is DatabaseSecretsProvider
 * (AES-256-GCM encrypted rows in platform_secrets — suitable for development
 * and early-stage SaaS).
 *
 * Future providers (add when contractually required):
 *   - AWSSecretsManagerProvider  — AWS Secrets Manager
 *   - GCPSecretManagerProvider   — GCP Secret Manager
 *   - AzureKeyVaultProvider      — Azure Key Vault
 *   - HashiCorpVaultProvider     — HashiCorp Vault
 *
 * IMPORTANT: The database-backed provider must be replaced with an external
 * vault before handling production client credentials. See docs/runbooks/
 * secret-compromise.md for migration guidance.
 */

export interface SecretsProvider {
  /**
   * Stores a secret under the given reference key.
   * Overwrites if already exists; for rotation use rotateSecret().
   */
  store(
    secretRef: string,
    value: Record<string, string>,
    options?: SecretsProviderOptions,
  ): Promise<void>;

  /**
   * Retrieves and decrypts a secret.
   * Throws if the secret does not exist, is revoked, or has expired.
   */
  retrieve(secretRef: string): Promise<Record<string, string>>;

  /**
   * Rotates a secret: stores new value with version incremented.
   * Returns the new version number.
   */
  rotate(
    secretRef: string,
    newValue: Record<string, string>,
    options?: SecretsProviderOptions,
  ): Promise<{ newVersion: number }>;

  /**
   * Revokes a secret immediately. Cannot be retrieved after revocation.
   */
  revoke(secretRef: string): Promise<void>;

  /**
   * Returns status metadata without decrypting the value.
   */
  getStatus(secretRef: string): Promise<SecretsProviderStatus | null>;

  /**
   * Marks a secret as successfully validated (connection test passed).
   */
  markValidated(secretRef: string): Promise<void>;
}

export interface SecretsProviderOptions {
  /** ISO datetime after which the secret must not be used */
  expiresAt?: Date;
  /** Non-sensitive description or tags */
  metadata?: Record<string, unknown>;
}

export interface SecretsProviderStatus {
  secretRef: string;
  version: number;
  isRevoked: boolean;
  isExpired: boolean;
  lastValidatedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates the appropriate secrets provider based on the SECRETS_PROVIDER
 * environment variable.
 *
 * Supported values:
 *   "database"  — AES-256-GCM encrypted rows in platform_secrets (default)
 *   "aws"       — AWS Secrets Manager (not yet implemented — throws)
 *   "gcp"       — GCP Secret Manager (not yet implemented — throws)
 *   "azure"     — Azure Key Vault (not yet implemented — throws)
 *   "vault"     — HashiCorp Vault (not yet implemented — throws)
 */
export async function createSecretsProvider(): Promise<SecretsProvider> {
  const providerType = process.env["SECRETS_PROVIDER"] ?? "database";

  switch (providerType) {
    case "database": {
      const { DatabaseSecretsProvider } = await import("./secretsService.js");
      return new DatabaseSecretsProvider();
    }

    case "aws":
      throw new Error(
        "AWSSecretsManagerProvider is not yet implemented. " +
        "Set SECRETS_PROVIDER=database for development, or implement " +
        "lib/secrets/src/providers/aws.ts following the SecretsProvider interface.",
      );

    case "gcp":
      throw new Error(
        "GCPSecretManagerProvider is not yet implemented. " +
        "Set SECRETS_PROVIDER=database for development.",
      );

    case "azure":
      throw new Error(
        "AzureKeyVaultProvider is not yet implemented. " +
        "Set SECRETS_PROVIDER=database for development.",
      );

    case "vault":
      throw new Error(
        "HashiCorpVaultProvider is not yet implemented. " +
        "Set SECRETS_PROVIDER=database for development.",
      );

    default:
      throw new Error(
        `Unknown SECRETS_PROVIDER value: "${providerType}". ` +
        "Supported values: database, aws, gcp, azure, vault.",
      );
  }
}
