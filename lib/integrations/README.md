# @workspace/integrations

Third-party integration infrastructure for NeedsOps AI+.

## Sprint 0 status

Shell. Defines integration types, OAuth token storage shape, and the `Integration` interface that all providers must implement.

## Planned integrations (Sprint 2+)

| Provider | Purpose | Tier |
|---|---|---|
| Google Workspace | Drive, Gmail, Calendar | Professional+ |
| Microsoft 365 | Teams, SharePoint, Outlook | Professional+ |
| Xero | Accounting, invoices | Professional+ |
| Zoho | CRM | Enterprise |
| OpenAI | AI worker backbone | All |
| OpenClaw | Agent orchestration gateway | All |

## Architecture rules

- OAuth tokens are **always encrypted at rest** before storage — never plain text
- Token refresh is handled server-side only — never exposed to the frontend
- Each integration is a class implementing the `Integration` interface
- The `IntegrationRegistry` resolves providers by name at runtime
