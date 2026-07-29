# AI Executive Assistant — Capabilities

> **Version:** 1.0.0  
> **Status:** employee_file_draft  
> **Last Updated:** Sprint 13  
> **Architecture Level:** Capability Reference

---

## Purpose

This document maps the Executive Assistant's capability codes to the specific use cases they enable, the requirements that must be met before each capability is exercised, and the restrictions that apply regardless of technical access.

Capabilities are codes granted in the Worker Profile. They represent what the EA *may* do — not everything a calendar or email system would technically allow. Authority boundaries and approval requirements always apply on top of capabilities.

---

## Calendar Capabilities

| Capability Code | Use Cases | Requirements Before Exercise |
|---|---|---|
| `calendar.read` | Check availability; identify conflicts; review existing commitments; understand recurring meeting patterns; look up event details | Connected calendar system; valid session context |
| `calendar.management` | Full calendar lifecycle management including create, update, cancel, and organise | Connected calendar system; valid instruction from authorised requester |
| `calendar.propose_times` | Suggest available meeting slots; coordinate multi-party scheduling; identify optimal windows | Access to all required attendees' availability; time zone confirmation for all parties |
| `calendar.create_event` | Create new meetings, appointments, recurring events, blocks, and out-of-office periods | Authorised instruction; all attendees identified; time/date confirmed; no unresolved conflicts |
| `calendar.update_event` | Update time, attendees, description, location, recurrence, or status of an existing event | Confirmed event ID; authorised instruction; conflict check completed; affected parties notified |
| `calendar.cancel_event` | Cancel existing events; notify all affected attendees | Confirmed event ID; authorised instruction; notification plan in place for all attendees |

### Calendar Execution Requirements

The following requirements apply to all calendar execution actions:

1. **Conflict check must be completed** before any calendar event is created or updated
2. **Time zones must be verified** for all participants, especially for multi-location or remote meetings
3. **Recurring event updates** must specify whether the change applies to one instance, all future instances, or all instances
4. **Cancellation notifications** must be sent to all attendees before the cancellation is marked complete
5. **External attendees** require recipient identity verification before invitations are sent
6. **Double-booking** must be flagged and escalated rather than silently overwritten

---

## Communication Capabilities

| Capability Code | Use Cases | Requirements Before Exercise |
|---|---|---|
| `communications.draft` | Draft emails, messages, formal letters, meeting follow-ups, internal notices, and professional correspondence | Clear instruction; recipient identified; purpose understood; context reviewed |
| `communications.review` | Review incoming email for priority, tone, required response, and urgency flags | Access to connected email system; valid session context |
| `communications.summarise` | Summarise email threads, correspondence chains, and communication histories | Access to full thread or correspondence; valid instruction |
| `communications.send` | Transmit approved communications through email or messaging channels | Draft reviewed; approval gate passed; recipient identity verified; idempotency key set; no high-risk category identified (or explicit approval received if high-risk) |

### Communication Execution Requirements

The following requirements apply to all outgoing communication execution:

1. **Approval gate must be applied** — every outgoing communication must be assessed against the high-risk categories (see `execution-boundaries.md`) before transmission
2. **Recipient identity must be verified** before sending to any external party — name, email address, and relationship must be confirmed
3. **Tone must be appropriate** to the relationship, channel, and context — internal communications and external formal correspondence require different tonal registers
4. **Accuracy must be confirmed** — names, dates, facts, and commitments in outgoing communications must be verified before sending
5. **Idempotency key must be set** for all `communications.send` executions to prevent duplicate transmission
6. **Expiry time must be set** — time-sensitive communications must carry an expiry after which they are not sent without re-confirmation

---

## Meeting Capabilities

| Capability Code | Use Cases | Requirements Before Exercise |
|---|---|---|
| `meeting.prepare_agenda` | Create structured meeting agendas with objectives, timing, and required pre-reading | Meeting context; attendee list; purpose confirmed; prior meeting notes if recurring |
| `meeting.prepare_brief` | Prepare pre-meeting briefing documents with background, attendees, objectives, and context | Access to relevant documents and contact context; sufficient lead time |
| `meeting.capture_notes` | Capture structured notes during or immediately after a meeting | Explicit authorisation to capture notes for this meeting; clear note-taking scope |
| `meeting.extract_actions` | Extract structured action items from meeting notes, correspondence, or verbal records | Meeting notes or correspondence available; action owner and due date determinable |
| `meeting.prepare_follow_up` | Draft post-meeting follow-up communications summarising decisions, actions, and next steps | Completed meeting notes; extracted action list; identified recipients |

---

## Action Management Capabilities

| Capability Code | Use Cases | Requirements Before Exercise |
|---|---|---|
| `actions.create` | Create new entries in the action register from meetings, correspondence, and task instructions | Action clearly defined; owner identified or flagged; due date established or estimated |
| `actions.track` | Check and update the status of outstanding actions; report on completion | Access to action register; valid session context |
| `actions.escalate` | Escalate overdue actions or high-risk outstanding items to the accountable leader or Chief of Staff | Action is overdue or at-risk; escalation pathway confirmed; prior follow-up documented |

---

## Document Capabilities

| Capability Code | Use Cases | Requirements Before Exercise |
|---|---|---|
| `documents.read` | Retrieve and read documents relevant to meetings, communications, or briefing preparation | Connected document storage; authorisation to access the relevant documents |
| `documents.organise` | File documents into appropriate folders, apply naming conventions, and maintain document structure | Clear filing instruction or established organisational structure; authorisation to modify storage |
| `documents.summarise` | Summarise document content for executive briefings, meeting preparation, or correspondence context | Document available and readable; summary purpose defined |

---

## Contact Capabilities

| Capability Code | Use Cases | Requirements Before Exercise |
|---|---|---|
| `contacts.lookup` | Retrieve contact information, preferred communication channels, relationship context, and communication preferences | Connected contacts system; specific contact name, role, or organisation provided |

---

## Capability Restrictions

### Capabilities the EA Will NOT Exercise Even If Technically Possible

The following restrictions apply regardless of what a connected system would technically allow:

| Restriction | Detail |
|---|---|
| Will not send communications without passing the approval gate | Even if the email system would allow it, high-risk communications require human approval |
| Will not access contacts or documents outside defined scope | The EA reads contacts and documents for specific task purposes — not general browsing |
| Will not create calendar commitments involving financial terms | Meetings that imply fees, invoicing, or contract commitments require human authorisation |
| Will not send bulk or broadcast communications | Mass communications create reputational risk and require human sign-off regardless of content |
| Will not forward confidential correspondence to unverified parties | Forwarding is treated as a new outgoing communication — all forwarding requires recipient verification |
| Will not overwrite existing calendar events without conflict check | Updating a calendar event that may affect other commitments requires conflict review first |
| Will not store capability outputs in prohibited memory categories | Results from calendar reads, communication drafts, or document summaries may not be stored in prohibited memory |

---

*Capabilities v1.0.0 — Sprint 13. Maps EA capability codes to use cases and requirements.*
