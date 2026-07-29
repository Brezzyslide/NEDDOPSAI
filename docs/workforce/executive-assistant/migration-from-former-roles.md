# AI Executive Assistant — Migration from Former Roles

> **Version:** 1.0.0  
> **Status:** employee_file_draft  
> **Last Updated:** Sprint 13  
> **Architecture Level:** Migration Reference

---

## Purpose

This document records the migration of deprecated roles into the Executive Assistant. It defines what is preserved from historical records, what is not rewritten, how alias resolution works, the deprecation timeline, and the impact on existing customers.

---

## Migration Table

| Former Role Code | Former Role Title | New Role Code | New Role Title | Sprint of Consolidation |
|---|---|---|---|---|
| `calendar_specialist` | AI Calendar Specialist | `executive_assistant` | AI Executive Assistant | Sprint 13 |
| `communication_specialist` | AI Communication Specialist | `executive_assistant` | AI Executive Assistant | Sprint 13 |

Both former roles are fully absorbed into the Executive Assistant. Neither role continues to exist as an independent employee after this consolidation. New work that would previously have routed to either role now routes to `executive_assistant`.

---

## What Is Preserved

The following items from the former roles are preserved in full and are not modified, deleted, or reattributed:

| Preserved Item | Detail |
|---|---|
| **Historical task runs** | All task runs completed by `calendar_specialist` and `communication_specialist` are preserved in the audit log with their original employee identifiers |
| **Audit records** | Audit records for all historical work retain the original executing role code (`calendar_specialist` / `communication_specialist`) — they are not rewritten to show `executive_assistant` |
| **Previous role names** | The role names "AI Calendar Specialist" and "AI Communication Specialist" are preserved in historical records as the identity of the executing employee at the time |
| **Previous capability mappings** | Historical capability codes assigned to `calendar_specialist` and `communication_specialist` are preserved in the historical capability registry |
| **Old pack entitlements** | Any pack entitlements previously granted to a tenant through `calendar_specialist` or `communication_specialist` are preserved and map to the equivalent EA capabilities |
| **Existing customer access rights** | Tenants who previously had access to `calendar_specialist` or `communication_specialist` capabilities retain their access through the Core Pack via `executive_assistant` |

---

## What Is NOT Rewritten

The following items are explicitly not rewritten as part of the migration:

| Item | Why It Is Not Rewritten |
|---|---|
| **Historical work attribution** | Work completed by `calendar_specialist` or `communication_specialist` is not retroactively attributed to `executive_assistant`. The EA did not perform that work — the former employees did. |
| **Historical audit records** | Audit records are immutable for compliance purposes. The role code in a historical audit record reflects who performed the action at the time it was performed. |
| **Former role documentation** | Documentation for `calendar_specialist` and `communication_specialist` is retained in the historical registry for reference. It is marked as deprecated but not deleted. |
| **Historical DNA versions** | Any DNA profiles associated with the former roles are preserved in the historical DNA registry. They are not merged into the EA DNA — the EA DNA is a new design. |

---

## Alias Resolution

The platform resolves former role codes to the Executive Assistant using `resolveAlias()`. This enables:

1. **Backward compatibility in API calls:** If an existing integration references `calendar_specialist` as a capability source, `resolveAlias("calendar_specialist")` returns `executive_assistant`
2. **Task routing:** Incoming tasks that specify a former role code are automatically routed to the EA
3. **Reporting:** References to former role codes in reports are resolved to display the current role name with a deprecation note

### How `resolveAlias` Works

```typescript
resolveAlias("calendar_specialist")
// Returns: { currentCode: "executive_assistant", deprecated: true, deprecatedAs: "calendar_specialist", since: "Sprint 13" }

resolveAlias("communication_specialist")
// Returns: { currentCode: "executive_assistant", deprecated: true, deprecatedAs: "communication_specialist", since: "Sprint 13" }

resolveAlias("executive_assistant")
// Returns: { currentCode: "executive_assistant", deprecated: false }
```

Alias resolution is transparent to the Organisation Owner and end users. When a task is routed through an alias, the execution record shows the resolved current role code (`executive_assistant`) alongside the alias that was used.

---

## Deprecation Timeline

| Milestone | Date / Sprint |
|---|---|
| Former roles (`calendar_specialist`, `communication_specialist`) marked as `deprecated` in the catalogue | Sprint 13 |
| `executive_assistant` Employee File created and documented | Sprint 13 |
| EA DNA designed (draft — pending approval) | Sprint 13 |
| Former role codes aliased to `executive_assistant` in the alias registry | Sprint 13 |
| EA DNA approved by human reviewer | Pending |
| EA Worker Profile activated | Pending (after DNA approval) |
| EA available for execution dispatch | Pending (after Worker Profile activation) |
| Former role codes removed from active catalogue | Upon EA activation |
| Former role documentation archived to historical registry | Upon EA activation |

---

## Capability Coverage Mapping

The Executive Assistant fully covers all capabilities of both former roles, and extends them:

| Former Role | Former Capabilities | EA Coverage |
|---|---|---|
| `calendar_specialist` | Calendar read, create, update, cancel, propose times, conflict detection | `calendar.read`, `calendar.management`, `calendar.propose_times`, `calendar.create_event`, `calendar.update_event`, `calendar.cancel_event` — full coverage plus extended context awareness |
| `communication_specialist` | Communications draft, review, send, summarise | `communications.draft`, `communications.review`, `communications.summarise`, `communications.send` — full coverage plus high-risk approval gate |
| — | Meeting preparation (partial in both former roles) | `meeting.prepare_agenda`, `meeting.prepare_brief`, `meeting.capture_notes`, `meeting.extract_actions`, `meeting.prepare_follow_up` — extended capability |
| — | Action management (not in former roles) | `actions.create`, `actions.track`, `actions.escalate` — new capability in EA |
| — | Document handling (not in former roles) | `documents.read`, `documents.organise`, `documents.summarise` — new capability in EA |
| — | Contact lookup (partial in former roles) | `contacts.lookup` — formalised capability in EA |

---

## Customer Impact

### Existing Tenants

Existing tenants who previously had access to `calendar_specialist` or `communication_specialist` capabilities:

- **Retain their pack access** — Core Pack entitlement continues unchanged; the capabilities are now delivered through `executive_assistant`
- **Do not need to update integrations** — Alias resolution handles backward compatibility
- **Will see improved capability** — The EA offers a wider capability set than either former role individually
- **Will see no change in billing** — The consolidation is a capability upgrade within the existing Core Pack, not a new entitlement

### New Tenants

New tenants provisioned after Sprint 13:

- Will see only `executive_assistant` in the Core Pack — the former role codes will not appear
- Will receive the full EA capability set from provisioning

### Workflow Impact

- Existing workflows that route to `calendar_specialist` or `communication_specialist` will continue to work via alias resolution
- No workflow updates are required from existing tenants
- The EA's additional capabilities (action management, meeting preparation, document handling) are available to all Core Pack tenants immediately upon EA activation

---

*Migration Reference v1.0.0 — Sprint 13. Records the consolidation of calendar_specialist and communication_specialist into executive_assistant.*
