/**
 * Plan Page — /app/:slug/plan
 * Sprint 3: Shows current plan, trial status, seat allowances,
 * included workforce packs, execution capabilities, and upgrade CTA.
 */

import { useParams, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";
import CapabilitiesSection from "@/components/plan/CapabilitiesSection";

const PLAN_COLOURS: Record<string, string> = {
  foundation: "#64748B",
  professional: "#00D4FF",
  business: "#FF8C00",
  enterprise: "#A855F7",
};

const PACK_COLOURS: Record<string, string> = {
  core: "#00D4FF",
  compliance: "#FF8C00",
  operations: "#1E90FF",
  finance: "#32CD32",
  hr: "#FF69B4",
  marketing: "#FF1493",
};

const EXEC_LABELS: Record<string, { label: string; icon: string }> = {
  task_runner:         { label: "Task Runner",         icon: "🏃" },
  browser_session:     { label: "Browser Automation",  icon: "🌐" },
  file_io:             { label: "File I/O",             icon: "📁" },
  email_send:          { label: "Email Send",           icon: "📧" },
  calendar_access:     { label: "Calendar Access",      icon: "📅" },
  api_call:            { label: "External API Calls",   icon: "🔗" },
  db_query:            { label: "Database Queries",     icon: "🗄️" },
  ai_inference:        { label: "AI Inference",         icon: "🧠" },
  webhook_trigger:     { label: "Webhook Triggers",     icon: "⚡" },
};

function daysBetween(a: Date, b: Date) {
  return Math.ceil((b.getTime() - a.getTime()) / 86_400_000);
}

export default function PlanPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();

  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ["subscription", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/subscription`).then(r => r.json()),
    enabled: !!slug,
  });

  const { data: entData } = useQuery({
    queryKey: ["entitlements", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/entitlements`).then(r => r.json()),
    enabled: !!slug,
  });

  const { data: seatsData } = useQuery({
    queryKey: ["seats", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/seats`).then(r => r.json()),
    enabled: !!slug,
  });

  const { data: workforceData } = useQuery({
    queryKey: ["org-workforce", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/workforce`).then(r => r.json()),
    enabled: !!slug,
  });

  const sub = subData?.subscription;
  const planCode: string = sub?.plan?.code ?? "foundation";
  const planColour = PLAN_COLOURS[planCode] ?? "#64748B";
  const entitlements: string[] = entData?.features ?? [];
  const activePacks: any[] = workforceData?.packs?.filter((p: any) => p.isIncluded) ?? [];
  const lockedPacks: any[] = workforceData?.packs?.filter((p: any) => !p.isIncluded) ?? [];

  const trialEnd = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
  const trialDaysLeft = trialEnd ? daysBetween(new Date(), trialEnd) : null;
  const isOnTrial = sub?.status === "trialing" && trialDaysLeft !== null && trialDaysLeft > 0;

  const seats = seatsData?.seats;
  const seatUsed = seats?.used ?? 0;
  const seatLimit = seats?.limit ?? null;
  const seatPct = seatLimit ? Math.round((seatUsed / seatLimit) * 100) : 0;

  const execCodes: string[] = entitlements.filter(f =>
    Object.keys(EXEC_LABELS).some(k => f.includes(k)) || f.startsWith("exec_")
  );
  // derive execution capabilities from feature codes
  const execCapabilities = Object.keys(EXEC_LABELS).filter(k =>
    entitlements.includes(`exec_${k}`) || entitlements.includes(k)
  );

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-5xl">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Plan &amp; Entitlements</h1>
            <p className="text-[#64748B] text-sm mt-1">Your current subscription, active capabilities, and workforce access.</p>
          </div>

          {subLoading ? (
            <div className="text-[#64748B] text-sm">Loading plan details…</div>
          ) : (
            <>
              {/* Plan card */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6 mb-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4">
                    <div
                      className="h-12 w-12 rounded-xl flex items-center justify-center text-lg font-bold"
                      style={{ backgroundColor: planColour + "22", color: planColour }}
                    >
                      {(sub?.plan?.name ?? planCode).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-[#E2E8F0] text-xl font-bold">
                          {sub?.plan?.name ?? planCode.charAt(0).toUpperCase() + planCode.slice(1)}
                        </h2>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide"
                          style={{ backgroundColor: planColour + "22", color: planColour }}
                        >
                          {sub?.status ?? "active"}
                        </span>
                        {isOnTrial && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400 font-semibold">
                            Trial — {trialDaysLeft}d left
                          </span>
                        )}
                      </div>
                      <p className="text-[#64748B] text-sm mt-0.5">
                        {sub?.plan?.description ?? "NDIS provider operations platform"}
                      </p>
                    </div>
                  </div>

                  {/* Upgrade CTA — shown for non-enterprise */}
                  {planCode !== "enterprise" && (
                    <div className="bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-4 py-3 text-center min-w-[160px]">
                      <p className="text-[#64748B] text-xs mb-1">Want more capacity?</p>
                      <p className="text-[#00D4FF] text-sm font-semibold">Contact us to upgrade</p>
                      <p className="text-[#64748B] text-xs mt-0.5">sales@needsops.com.au</p>
                    </div>
                  )}
                </div>

                {/* Trial warning bar */}
                {isOnTrial && trialDaysLeft !== null && trialDaysLeft <= 7 && (
                  <div className="mt-4 flex items-center gap-2 bg-amber-900/20 border border-amber-500/30 rounded-lg px-4 py-2.5">
                    <span className="text-amber-400 shrink-0">⚠</span>
                    <p className="text-amber-200 text-sm">
                      Your trial ends in <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong>. Contact your account manager to continue without interruption.
                    </p>
                  </div>
                )}
              </div>

              {/* Seats */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6">
                  <h3 className="text-[#E2E8F0] font-semibold mb-4">Team Seats</h3>
                  <div className="flex items-end gap-3 mb-3">
                    <span className="text-3xl font-bold text-[#E2E8F0]">{seatUsed}</span>
                    <span className="text-[#64748B] text-sm mb-1">
                      {seatLimit !== null ? `/ ${seatLimit} seats` : "/ Unlimited"}
                    </span>
                  </div>
                  {seatLimit !== null && (
                    <>
                      <div className="h-2 bg-[#1E3A5F] rounded-full overflow-hidden mb-2">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(seatPct, 100)}%`,
                            backgroundColor: seatPct >= 95 ? "#F87171" : seatPct >= 80 ? "#FB923C" : "#00D4FF",
                          }}
                        />
                      </div>
                      <p className="text-[#64748B] text-xs">{seatPct}% of seat allowance used</p>
                    </>
                  )}
                  <button
                    onClick={() => setLocation(`/app/${slug}/usage`)}
                    className="mt-3 text-[#00D4FF] text-xs hover:underline"
                  >
                    View full usage →
                  </button>
                </div>

                {/* Plan version info */}
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6">
                  <h3 className="text-[#E2E8F0] font-semibold mb-4">Subscription Details</h3>
                  <div className="space-y-2.5 text-sm">
                    {[
                      { label: "Plan version", value: sub?.planVersion?.versionTag ?? "—" },
                      { label: "Billing cycle", value: sub?.billingCycle ?? "monthly" },
                      {
                        label: "Current period start",
                        value: sub?.currentPeriodStart
                          ? new Date(sub.currentPeriodStart).toLocaleDateString("en-AU")
                          : "—",
                      },
                      {
                        label: "Current period end",
                        value: sub?.currentPeriodEnd
                          ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-AU")
                          : "—",
                      },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between gap-2">
                        <span className="text-[#64748B]">{label}</span>
                        <span className="text-[#E2E8F0] font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Workforce packs */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6 mb-6">
                <h3 className="text-[#E2E8F0] font-semibold mb-4">Workforce Packs</h3>

                {activePacks.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[#64748B] text-xs uppercase tracking-widest mb-3">Included in your plan</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {activePacks.map((pack: any) => {
                        const colour = PACK_COLOURS[pack.code] ?? "#00D4FF";
                        return (
                          <div key={pack.code} className="flex items-center gap-3 bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5">
                            <div
                              className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                              style={{ backgroundColor: colour + "22", color: colour }}
                            >
                              {pack.name?.charAt(0) ?? "?"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[#E2E8F0] text-sm font-medium truncate">{pack.name}</p>
                              <p className="text-[#64748B] text-xs">{pack.specialistCount ?? pack.specialists?.length ?? 0} specialists</p>
                            </div>
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 shrink-0">✓</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {lockedPacks.length > 0 && (
                  <LockedPacksMarketplace
                    packs={lockedPacks}
                    orgSlug={slug ?? ""}
                    apiFetch={apiFetch}
                  />
                )}
              </div>

              {/* Execution capabilities */}
              {execCapabilities.length > 0 && (
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6 mb-6">
                  <h3 className="text-[#E2E8F0] font-semibold mb-4">Execution Capabilities</h3>
                  <p className="text-[#64748B] text-sm mb-4">The actions your AI specialists can perform on your behalf.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {execCapabilities.map(code => {
                      const info = EXEC_LABELS[code] ?? { label: code, icon: "⚙" };
                      return (
                        <div key={code} className="flex items-center gap-3 bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5">
                          <span className="text-base shrink-0">{info.icon}</span>
                          <span className="text-[#E2E8F0] text-sm font-medium">{info.label}</span>
                          <span className="ml-auto text-xs text-emerald-400">✓</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Business Capabilities — Sprint 9.4 */}
              <CapabilitiesSection orgSlug={slug ?? ""} />
            </>
          )}
        </div>
      </AppShell>
    </>
  );
}

// ─── Locked Packs Marketplace ─────────────────────────────────────────────────

interface PackPricingDisplay {
  isFree: boolean;
  currency?: string;
  monthlyPriceCents?: number;
  displayMode: "free" | "priced" | "contact_sales" | "coming_soon";
  fallbackText?: string;
}

function LockedPacksMarketplace({
  packs,
  orgSlug,
  apiFetch,
}: {
  packs: any[];
  orgSlug: string;
  apiFetch: ReturnType<typeof useAuthFetch>;
}) {
  const queryClient = useQueryClient();
  const [pricingMap, setPricingMap] = useState<Record<string, PackPricingDisplay>>({});
  const [requestStates, setRequestStates] = useState<Record<string, "idle" | "sending" | "sent" | "error">>({});

  // Fetch public catalogue for pricing data
  useEffect(() => {
    fetch("/v1/workforce-packs?status=available")
      .then(r => r.json())
      .then(d => {
        const map: Record<string, PackPricingDisplay> = {};
        for (const p of d.packs ?? []) {
          if (p.pricing) map[p.code] = p.pricing;
        }
        setPricingMap(map);
      })
      .catch(() => {});
  }, []);

  const sendRequest = async (packCode: string) => {
    setRequestStates(s => ({ ...s, [packCode]: "sending" }));
    try {
      const res = await apiFetch(`/v1/organisations/${orgSlug}/pack-access-requests`, {
        method: "POST",
        body: JSON.stringify({ packCode }),
      });
      if (res.ok) {
        setRequestStates(s => ({ ...s, [packCode]: "sent" }));
        queryClient.invalidateQueries({ queryKey: ["org-workforce", orgSlug] });
      } else {
        const d = await res.json().catch(() => ({}));
        const msg = d?.error?.message ?? "Request failed";
        console.error("Pack request error:", msg);
        setRequestStates(s => ({ ...s, [packCode]: "error" }));
        setTimeout(() => setRequestStates(s => ({ ...s, [packCode]: "idle" })), 3000);
      }
    } catch {
      setRequestStates(s => ({ ...s, [packCode]: "error" }));
      setTimeout(() => setRequestStates(s => ({ ...s, [packCode]: "idle" })), 3000);
    }
  };

  if (packs.length === 0) return null;

  return (
    <div>
      <p className="text-[#64748B] text-xs uppercase tracking-widest mb-3">Add to your plan</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {packs.map((pack: any) => {
          const colour = pack.colorHex ?? PACK_COLOURS[pack.code] ?? "#00D4FF";
          const pricing: PackPricingDisplay | undefined = pricingMap[pack.code];
          const reqState = requestStates[pack.code] ?? "idle";
          const tenantStatus: string | undefined = pack.tenantStatus;

          // Price label
          const priceLabel = (() => {
            if (!pricing) return "Contact NeedsOps";
            if (pricing.displayMode === "free") return "Free";
            if (pricing.displayMode === "priced" && pricing.monthlyPriceCents != null)
              return `A$${Math.round(pricing.monthlyPriceCents / 100).toLocaleString("en-AU")}/month`;
            if (pricing.displayMode === "coming_soon") return pricing.fallbackText ?? "Coming soon";
            return pricing.fallbackText ?? "Contact NeedsOps";
          })();

          const isFree = pricing?.displayMode === "free";
          const isPriced = pricing?.displayMode === "priced";

          // Tenant status badge
          const statusBadge = (() => {
            if (!tenantStatus) return null;
            const map: Record<string, { label: string; cls: string }> = {
              trial:           { label: "Trial active",    cls: "bg-emerald-900/30 text-emerald-400" },
              trial_expired:   { label: "Trial expired",   cls: "bg-amber-900/30 text-amber-400" },
              requested:       { label: "Requested",       cls: "bg-blue-900/30 text-blue-400" },
              pending_payment: { label: "Pending payment", cls: "bg-violet-900/30 text-violet-400" },
              suspended:       { label: "Suspended",       cls: "bg-red-900/30 text-red-400" },
            };
            const info = map[tenantStatus];
            if (!info) return null;
            return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${info.cls}`}>{info.label}</span>;
          })();

          const btnDisabled = reqState === "sending" || reqState === "sent" || tenantStatus === "requested";
          const btnLabel = reqState === "sending" ? "Requesting…"
            : reqState === "sent" || tenantStatus === "requested" ? "Requested ✓"
            : reqState === "error" ? "Try again"
            : "Request access →";

          return (
            <div
              key={pack.code}
              className="rounded-xl border bg-[#0B1829] p-4 flex flex-col gap-3"
              style={{ borderColor: `${colour}25` }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center text-xl shrink-0"
                  style={{ background: `${colour}15`, border: `1px solid ${colour}25` }}
                >
                  {pack.iconEmoji ?? pack.name?.charAt(0) ?? "📦"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-[#E2E8F0] text-sm font-semibold">{pack.name}</p>
                    {statusBadge}
                  </div>
                  <p className="text-[#64748B] text-xs line-clamp-2">{pack.marketingTagline ?? pack.description}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-[#1E3A5F]">
                <div className="text-xs">
                  <span className={`font-semibold ${isFree ? "text-[#00D4FF]" : isPriced ? "text-[#E2E8F0]" : "text-[#64748B]"}`}>
                    {priceLabel}
                  </span>
                </div>
                <button
                  onClick={() => sendRequest(pack.code)}
                  disabled={btnDisabled}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  style={btnDisabled
                    ? { background: `${colour}08`, color: "#64748B", border: `1px solid #1E3A5F` }
                    : { background: `${colour}15`, color: colour, border: `1px solid ${colour}25` }
                  }
                >
                  {btnLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
