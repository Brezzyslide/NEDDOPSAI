/**
 * FutureProviders — P6, P7, P8 Provider Stubs
 *
 * Defines provider interfaces for:
 *   P6  Desktop Connector  — local file system / desktop application
 *   P7  Cloud Providers    — SharePoint, Google Drive, OneDrive, Dropbox,
 *                            Confluence, Notion
 *   P8  Web Search         — approved live web search
 *
 * ALL providers in this file return { items: [], notImplemented: true }.
 * No retrieval is implemented. No external calls are made.
 *
 * Registration: each class is a complete IKnowledgeProvider implementation
 * and can be registered in the provider registry when the feature ships.
 *
 * Do NOT implement retrieval here — these are interface placeholders only.
 */

import type {
  IKnowledgeProvider,
  PriorityLayer,
  RetrievalContext,
  KnowledgeProviderResult,
} from "../IKnowledgeProvider.js";

// ─── Base stub ────────────────────────────────────────────────────────────────

class NotImplementedProvider implements IKnowledgeProvider {
  readonly isImplemented = false;

  constructor(
    public readonly providerId: string,
    public readonly displayName: string,
    public readonly priorityLayer: PriorityLayer,
    private readonly reason: string,
  ) {}

  async retrieve(_context: RetrievalContext): Promise<KnowledgeProviderResult> {
    return {
      provider:              this.providerId,
      priorityLayer:         this.priorityLayer,
      items:                 [],
      notImplemented:        true,
      notImplementedReason:  this.reason,
      durationMs:            0,
    };
  }
}

// ─── P6: Desktop Connector ────────────────────────────────────────────────────

/**
 * DesktopConnectorProvider — P6
 *
 * Retrieves documents from approved local desktop file providers.
 * Requires the NeedsOps Desktop Connector to be installed and running.
 *
 * Interface contract:
 *   - Connector must be authenticated and authorised by the organisation
 *   - Files must be whitelisted in the connector configuration
 *   - No file contents are transmitted without explicit connector approval
 *   - All transfers are encrypted in transit
 *
 * Not implemented — desktop file retrieval is out of scope for Task #17.
 */
export class DesktopConnectorProvider extends NotImplementedProvider {
  constructor() {
    super(
      "desktop_connector",
      "Desktop Connector Provider (P6)",
      "desktop",
      "Desktop file retrieval is not implemented in this version. " +
        "Install and configure the NeedsOps Desktop Connector to enable this feature.",
    );
  }
}

// ─── P7: Cloud Providers ──────────────────────────────────────────────────────

/**
 * SharePointProvider — P7
 * Retrieves documents from Microsoft SharePoint.
 * Requires OAuth delegation to the organisation's Microsoft 365 tenant.
 */
export class SharePointProvider extends NotImplementedProvider {
  constructor() {
    super(
      "cloud_sharepoint",
      "SharePoint Provider (P7)",
      "cloud",
      "SharePoint retrieval is not implemented. Configure Microsoft 365 connector to enable.",
    );
  }
}

/**
 * GoogleDriveProvider — P7
 * Retrieves documents from Google Drive.
 * Requires OAuth delegation to the organisation's Google Workspace.
 */
export class GoogleDriveProvider extends NotImplementedProvider {
  constructor() {
    super(
      "cloud_google_drive",
      "Google Drive Provider (P7)",
      "cloud",
      "Google Drive retrieval is not implemented. Configure Google Workspace connector to enable.",
    );
  }
}

/**
 * OneDriveProvider — P7
 * Retrieves documents from Microsoft OneDrive.
 * Requires OAuth delegation to the organisation's Microsoft 365 tenant.
 */
export class OneDriveProvider extends NotImplementedProvider {
  constructor() {
    super(
      "cloud_onedrive",
      "OneDrive Provider (P7)",
      "cloud",
      "OneDrive retrieval is not implemented. Configure Microsoft 365 connector to enable.",
    );
  }
}

/**
 * DropboxProvider — P7
 * Retrieves documents from Dropbox.
 * Requires OAuth delegation to the organisation's Dropbox account.
 */
export class DropboxProvider extends NotImplementedProvider {
  constructor() {
    super(
      "cloud_dropbox",
      "Dropbox Provider (P7)",
      "cloud",
      "Dropbox retrieval is not implemented. Configure Dropbox connector to enable.",
    );
  }
}

/**
 * ConfluenceProvider — P7
 * Retrieves pages from Atlassian Confluence.
 * Requires OAuth / API token delegation to the organisation's Confluence instance.
 */
export class ConfluenceProvider extends NotImplementedProvider {
  constructor() {
    super(
      "cloud_confluence",
      "Confluence Provider (P7)",
      "cloud",
      "Confluence retrieval is not implemented. Configure Atlassian connector to enable.",
    );
  }
}

/**
 * NotionProvider — P7
 * Retrieves pages and databases from Notion.
 * Requires Notion OAuth delegation from the organisation.
 */
export class NotionProvider extends NotImplementedProvider {
  constructor() {
    super(
      "cloud_notion",
      "Notion Provider (P7)",
      "cloud",
      "Notion retrieval is not implemented. Configure Notion connector to enable.",
    );
  }
}

// ─── P8: Web Search ───────────────────────────────────────────────────────────

/**
 * WebSearchProvider — P8
 * Approved live web search.
 *
 * Contract (when implemented):
 *   - Only approved search engines may be queried
 *   - All queries are logged for audit
 *   - Results are not stored in the Organisation Library
 *   - Sensitive queries are blocked
 *   - Rate limits enforced per organisation
 */
export class WebSearchProvider extends NotImplementedProvider {
  constructor() {
    super(
      "web_search",
      "Web Search Provider (P8)",
      "web_search",
      "Live web search is not implemented. Enable Approved Web Search in organisation settings.",
    );
  }
}

// ─── All future providers (export for registration) ───────────────────────────

export const ALL_FUTURE_PROVIDERS: NotImplementedProvider[] = [
  new DesktopConnectorProvider(),
  new SharePointProvider(),
  new GoogleDriveProvider(),
  new OneDriveProvider(),
  new DropboxProvider(),
  new ConfluenceProvider(),
  new NotionProvider(),
  new WebSearchProvider(),
];
