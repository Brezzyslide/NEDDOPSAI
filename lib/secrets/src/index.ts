/**
 * @workspace/secrets — Sprint 7.1
 *
 * Secrets management abstraction for NeedsOps AI+.
 *
 * Current backend: AES-256-GCM encrypted storage in platform_secrets table.
 * Production: swap to AWS Secrets Manager / HashiCorp Vault via SecretsProvider interface.
 *
 * Usage:
 *   // Direct functions (backward compat):
 *   import { storeSecret, retrieveSecret } from "@workspace/secrets";
 *
 *   // Via provider interface (preferred for new code):
 *   import { createSecretsProvider } from "@workspace/secrets";
 *   const provider = await createSecretsProvider();
 *   await provider.store("ref", { password: "..." });
 */
export {
  storeSecret,
  retrieveSecret,
  rotateSecret,
  revokeSecret,
  getSecretStatus,
  markSecretValidated,
  buildOrgDbCredentialRef,
  parseOrgDbCredentialRef,
  DatabaseSecretsProvider,
  SecretsError,
  type SecretStatus,
  type StoreSecretOptions,
} from "./secretsService";

export {
  createSecretsProvider,
  type SecretsProvider,
  type SecretsProviderOptions,
  type SecretsProviderStatus,
} from "./provider";
