/**
 * CapabilitiesSection — Sprint 9.4
 *
 * Displays business capabilities grouped by Workforce Pack on the Plan page.
 * Shows: included capabilities (info/analysis/execution tiers), locked capabilities
 * that require a higher plan or pack, and the required connector eligibility.
 *
 * Note: raw capability codes are hidden unless the user expands the detail panel.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthFetch } from "@/lib/api";

const LEVEL_LABELS = {
  informationAccess: { label: "General Info",   icon: "ℹ",  colour: "#60A5FA", desc: "Educational answers, no org data needed" },
  analysisAccess:   { label: "Analysis",        icon: "🔍", colour: "#34D399", desc: "Analyse your organisation's records" },
  executionAccess:  { label: "Execution",       icon: "⚡",  colour: "#F59E0B", desc: "Execute actions in connected systems" },
};

interface CapAccess {
  allowed: boolean;
  partial: boolean;
  reasonCode: string;
}

interface CapEntry {
  code: string;
  displayName: string;
  description: string;
  category: string;
  informationAccess: { allowed: boolean; reasonCode: string };
  analysisAccess: CapAccess | null;
  executionAccess: CapAccess | null;
}

interface PackGroup {
  packCode: string | null;
  packDisplayName: string;
  capabilities: CapEntry[];
}

function AccessPill({ label, icon, colour, allowed, partial }: {
  label: string; icon: string; colour: string; allowed: boolean; partial: boolean;
}) {
  if (!allowed && !partial) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium"
      style={{
        backgroundColor: (partial ? "#92400E" : colour) + "22",
        color: partial ? "#FCD34D" : colour,
        border: `1px solid ${partial ? "#92400E" : colour}44`,
      }}
      title={partial ? `${label} — partial access` : label}
    >
      <span>{icon}</span>
      <span>{label}{partial ? "*" : ""}</span>
    </span>
  );
}

function CapabilityRow({ cap, showCodes }: { cap: CapEntry; showCodes: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[#1E3A5F]/50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-[#E2E8F0] text-sm font-medium truncate">{cap.displayName}</p>
        <p className="text-[#64748B] text-xs mt-0.5 truncate">{cap.description}</p>
        {showCodes && (
          <code className="text-[#00D4FF] text-xs opacity-60 mt-0.5 block">{cap.code}</code>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <AccessPill
          label="General Info" icon="ℹ" colour="#60A5FA"
          allowed={cap.informationAccess.allowed} partial={false}
        />
        {cap.analysisAccess && (
          <AccessPill
            label="Analysis" icon="🔍" colour="#34D399"
            allowed={cap.analysisAccess.allowed} partial={cap.analysisAccess.partial}
          />
        )}
        {cap.executionAccess && (
          <AccessPill
            label="Execution" icon="⚡" colour="#F59E0B"
            allowed={cap.executionAccess.allowed} partial={cap.executionAccess.partial}
          />
        )}
        {!cap.informationAccess.allowed && !cap.analysisAccess?.allowed && !cap.executionAccess?.allowed && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-[#1E3A5F] text-[#64748B]">🔒 Locked</span>
        )}
      </div>
    </div>
  );
}

function PackCapabilityGroup({ group, showCodes }: { group: PackGroup; showCodes: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasAnyAccess = group.capabilities.some(c =>
    c.informationAccess.allowed || c.analysisAccess?.allowed || c.executionAccess?.allowed
  );
  const PACK_COLOURS: Record<string, string> = {
    "Core": "#00D4FF", "Compliance Workforce Pack": "#FF8C00",
    "Finance Workforce Pack": "#32CD32", "HR Workforce Pack": "#FF69B4",
    "Operations Workforce Pack": "#1E90FF", "Marketing Workforce Pack": "#FF1493",
  };
  const colour = PACK_COLOURS[group.packDisplayName] ?? "#64748B";
  const visibleCaps = expanded ? group.capabilities : group.capabilities.slice(0, 4);

  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
            style={{ backgroundColor: colour + "22", color: colour }}
          >
            {group.packDisplayName.charAt(0)}
          </div>
          <div>
            <h4 className="text-[#E2E8F0] text-sm font-semibold">{group.packDisplayName}</h4>
            <p className="text-[#64748B] text-xs">{group.capabilities.length} capabilities</p>
          </div>
        </div>
        {!hasAnyAccess && group.packCode && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#1E3A5F] text-[#64748B]">Pack not included</span>
        )}
        {hasAnyAccess && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400">Included</span>
        )}
      </div>

      <div>
        {visibleCaps.map(cap => (
          <CapabilityRow key={cap.code} cap={cap} showCodes={showCodes} />
        ))}
        {group.capabilities.length > 4 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-3 text-[#00D4FF] text-xs hover:underline"
          >
            {expanded ? "Show less" : `Show ${group.capabilities.length - 4} more capabilities`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CapabilitiesSection({ orgSlug }: { orgSlug: string }) {
  const apiFetch = useAuthFetch();
  const [showCodes, setShowCodes] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["org-capabilities", orgSlug],
    queryFn: () =>
      apiFetch(`/v1/organisations/${orgSlug}/capabilities`).then(r => r.json()),
    enabled: !!orgSlug,
    staleTime: 60_000,
  });

  const groups: PackGroup[] = data?.capabilityGroups ?? [];

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[#E2E8F0] font-semibold">Business Capabilities</h3>
          <p className="text-[#64748B] text-xs mt-0.5">
            What your AI specialists can do for your organisation at each access level.
          </p>
        </div>
        <button
          onClick={() => setShowCodes(s => !s)}
          className="text-[#64748B] text-xs hover:text-[#E2E8F0] transition-colors"
        >
          {showCodes ? "Hide codes" : "Advanced details"}
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-5">
        {Object.entries(LEVEL_LABELS).map(([, v]) => (
          <div key={v.label} className="flex items-center gap-1.5 text-xs text-[#64748B]">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: v.colour + "22", color: v.colour }}>
              {v.icon} {v.label}
            </span>
            <span>— {v.desc}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
          <span className="text-amber-400 text-xs">*</span>
          <span>Partial access available (lower level than requested)</span>
        </div>
      </div>

      {isLoading && (
        <div className="text-[#64748B] text-sm">Loading capabilities…</div>
      )}

      {isError && (
        <div className="text-[#64748B] text-sm">Unable to load capability details.</div>
      )}

      {!isLoading && !isError && groups.length === 0 && (
        <div className="text-[#64748B] text-sm">No capabilities configured.</div>
      )}

      {groups.map(group => (
        <PackCapabilityGroup key={group.packCode ?? "core"} group={group} showCodes={showCodes} />
      ))}
    </div>
  );
}
