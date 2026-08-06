/**
 * Write Target Resolver Service — Sprint 29D (Deliverable C)
 *
 * Deterministically resolves write destinations for proposed ExecutionActions.
 * Every action receives a fully resolved ResolvedWriteTarget BEFORE execution.
 *
 * Resolution is deterministic — given the same inputs, the resolver always
 * produces the same output. No randomness, no LLM calls, no I/O.
 *
 * Resolution rules (in priority order):
 *   1. Action type beats domain — "draft_email" always → outlook_drafts
 *      regardless of what domain field says.
 *   2. Domain narrows the category — "files" maps to desktop_* based on path.
 *   3. Path hints narrow further — "documents", "downloads", "desktop" in path.
 *   4. Default within domain — every domain has a safe default target.
 *
 * Connector requirements:
 *   - desktop_*    → connector channel required (files live on the user's machine)
 *   - outlook_*    → office channel required (Outlook is a managed app)
 *   - excel_*      → office channel required
 *   - organisation_library / completed_work → no connector (NeedsOps-internal)
 *   - sharepoint / google_drive → cloud channel required (future)
 */

import type {
  ExecutionActionType,
  ResolvedWriteTarget,
  WriteTargetDomain,
} from "../types/canonicalExecutionContext.js";
import type { SessionChannel } from "../lib/resources/ExecutionSession.js";

// ─── Resolution entry point ───────────────────────────────────────────────────

/**
 * Resolves the write target for a proposed action.
 *
 * @param actionType  The typed action kind from ExecutionActionType
 * @param domain      The domain field from the specialist's requested action
 * @param parameters  Raw parameters from specialist output (may contain "path")
 * @returns           A fully resolved write target
 */
export function resolveWriteTarget(
  actionType: ExecutionActionType,
  domain: string,
  parameters: Record<string, unknown>,
): ResolvedWriteTarget {
  // Rule 1: Action-type overrides take priority
  if (actionType === "draft_email") {
    return TARGETS.outlookDrafts;
  }
  if (actionType === "send_email") {
    return TARGETS.outlookSend;
  }
  if (actionType === "calendar_update") {
    return TARGETS.calendarEvent;
  }

  // Rule 2: Domain + path-hint resolution
  const normDomain = normaliseDomain(domain);

  if (normDomain === "email") {
    return TARGETS.outlookDrafts;
  }
  if (normDomain === "excel") {
    return TARGETS.excelWorkbook;
  }
  if (normDomain === "browser") {
    // Browser interactions produce captured output that goes into Completed Work
    return TARGETS.completedWork;
  }
  if (normDomain === "terminal") {
    // Terminal commands produce captured output that goes into Completed Work
    return TARGETS.completedWork;
  }
  if (normDomain === "word") {
    // Word documents land in Documents by default
    return TARGETS.desktopDocuments;
  }

  // Rule 3: File domain — path hints
  if (normDomain === "files" || normDomain === "file") {
    return resolveFileTarget(parameters);
  }

  // Rule 4: Unknown domain — safe default (Completed Work)
  return TARGETS.completedWork;
}

// ─── Pre-defined targets ──────────────────────────────────────────────────────

const TARGETS: Record<string, ResolvedWriteTarget> = {
  desktopDocuments: {
    domain:             "desktop_documents",
    displayPath:        "~/Documents",
    connectorRequired:  true,
    channelRequired:    "connector",
    approvalRequired:   false,
    approvalReason:     null,
  },
  desktopDownloads: {
    domain:             "desktop_downloads",
    displayPath:        "~/Downloads",
    connectorRequired:  true,
    channelRequired:    "connector",
    approvalRequired:   false,
    approvalReason:     null,
  },
  desktopDesktop: {
    domain:             "desktop_desktop",
    displayPath:        "~/Desktop",
    connectorRequired:  true,
    channelRequired:    "connector",
    approvalRequired:   false,
    approvalReason:     null,
  },
  organisationLibrary: {
    domain:             "organisation_library",
    displayPath:        "NeedsOps Organisation Library",
    connectorRequired:  false,
    channelRequired:    null,
    approvalRequired:   true,
    approvalReason:     "Writing to the Organisation Library requires admin approval",
  },
  completedWork: {
    domain:             "completed_work",
    displayPath:        "NeedsOps Completed Work",
    connectorRequired:  false,
    channelRequired:    null,
    approvalRequired:   false,
    approvalReason:     null,
  },
  outlookDrafts: {
    domain:             "outlook_drafts",
    displayPath:        "Outlook Drafts",
    connectorRequired:  true,
    channelRequired:    "office",
    approvalRequired:   false,
    approvalReason:     null,
  },
  outlookSend: {
    domain:             "outlook_send",
    displayPath:        "Outlook → Send immediately",
    connectorRequired:  true,
    channelRequired:    "office",
    approvalRequired:   true,
    approvalReason:     "Sending an email requires explicit approval before it is dispatched",
  },
  excelWorkbook: {
    domain:             "excel_workbook",
    displayPath:        "Active Excel Workbook",
    connectorRequired:  true,
    channelRequired:    "office",
    approvalRequired:   false,
    approvalReason:     null,
  },
  calendarEvent: {
    domain:             "custom",
    displayPath:        "Calendar — New Event",
    connectorRequired:  true,
    channelRequired:    "office",
    approvalRequired:   false,
    approvalReason:     null,
  },
} as const;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function normaliseDomain(raw: string): string {
  return (raw ?? "").toLowerCase().trim();
}

/**
 * Resolves a file-domain action to a desktop path using path-hint detection.
 * Priority: downloads hint → desktop hint → documents (safe default).
 */
function resolveFileTarget(parameters: Record<string, unknown>): ResolvedWriteTarget {
  const path = String(parameters.path ?? parameters.destination ?? "").toLowerCase();

  if (containsHint(path, ["download", "downloads"])) {
    return TARGETS.desktopDownloads;
  }
  if (containsHint(path, ["desktop"])) {
    return TARGETS.desktopDesktop;
  }
  if (containsHint(path, ["library", "organisation", "org_library"])) {
    return TARGETS.organisationLibrary;
  }

  // Safe default: Documents
  return TARGETS.desktopDocuments;
}

function containsHint(value: string, hints: string[]): boolean {
  return hints.some(h => value.includes(h));
}

// ─── Channel mapping utilities ────────────────────────────────────────────────

/**
 * Maps a connector category string (from specialist allowedConnectorCategories)
 * to the closest SessionChannel. Used when building ConnectorRequirements.
 */
export function mapConnectorCategoryToChannel(connectorCategory: string): SessionChannel {
  const cat = (connectorCategory ?? "").toLowerCase();
  if (cat.includes("browser")) return "browser";
  if (cat.includes("office") || cat.includes("excel") || cat.includes("outlook") || cat.includes("word")) {
    return "office";
  }
  if (cat.includes("cloud") || cat.includes("sharepoint") || cat.includes("drive")) {
    return "cloud";
  }
  return "connector"; // default to main NeedsOps connector channel
}

/**
 * Maps an execution channel string (from specialist allowedExecutionChannels)
 * to a SessionChannel. Falls back to "connector".
 */
export function mapExecutionChannelToSession(executionChannel: string): SessionChannel {
  const ch = (executionChannel ?? "").toLowerCase();
  if (ch === "browser") return "browser";
  if (ch === "office") return "office";
  if (ch === "cloud") return "cloud";
  return "connector";
}
