/**
 * @workspace/secrets — Sprint 7
 *
 * Secrets management abstraction for NeedsOps AI+.
 *
 * Current backend: AES-256-GCM encrypted storage in platform_secrets table.
 * Production: swap to AWS Secrets Manager / HashiCorp Vault via same interface.
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
  SecretsError,
  type SecretStatus,
  type StoreSecretOptions,
} from "./secretsService";
