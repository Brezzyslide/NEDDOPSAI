/**
 * @workspace/integrations — Integration registry
 *
 * Sprint 0 shell. Defines the registry interface that the API server will use
 * to look up and invoke integrations. Sprint 2+: concrete implementations added.
 */

import type { Integration, IntegrationConfig, IntegrationProvider } from "./types.js";

export const INTEGRATION_CONFIGS: Partial<
  Record<IntegrationProvider, IntegrationConfig>
> = {
  google: {
    provider: "google",
    label: "Google Workspace",
    requiredScopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar",
    ],
    availableOnTiers: ["professional", "enterprise"],
  },
  microsoft: {
    provider: "microsoft",
    label: "Microsoft 365",
    requiredScopes: [
      "Files.ReadWrite.All",
      "Mail.Send",
      "Calendars.ReadWrite",
      "Team.ReadBasic.All",
    ],
    availableOnTiers: ["professional", "enterprise"],
  },
  xero: {
    provider: "xero",
    label: "Xero",
    requiredScopes: ["accounting.transactions", "accounting.reports.read"],
    availableOnTiers: ["professional", "enterprise"],
  },
  zoho: {
    provider: "zoho",
    label: "Zoho",
    requiredScopes: ["ZohoCRM.modules.ALL"],
    availableOnTiers: ["enterprise"],
  },
};

/**
 * Sprint 2+: replace with a concrete registry that maps providers to
 * class instances and handles token refresh + OAuth callbacks.
 */
export interface IntegrationRegistry {
  get(provider: IntegrationProvider): Integration | undefined;
  list(): Integration[];
}
