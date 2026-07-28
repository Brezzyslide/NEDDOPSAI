/**
 * Platform Pack Builder — /platform/packs
 * Sprint 9.6: Versioned pricing panel, DB-driven packs.
 */
import { useState, useEffect } from "react";
import PlatformShell from "@/components/layout/PlatformShell";
import { useAuthFetch } from "@/lib/api";

interface PackPricing {
  isFree: boolean;
  displayMode: "free" | "priced" | "contact_sales" | "coming_soon";
  currency?: string;
  monthlyPriceCents?: number;
  annualPriceCents?: number;
  fallbackText?: string;
}

interface Pack {
  id: string;
  code: string;
  name: string;
  description: string | null;
  marketingTagline: string | null;
  industry: string;
  iconEmoji: string | null;
  colorHex: string | null;
  tier: "starter" | "professional" | "enterprise";
  status: "draft" | "available" | "coming_soon" | "archived";
  isFree: boolean;
  pricingStatus: string;
  displayOrder: number;
  featured: boolean;
  isPubliclyVisible: boolean;
  pricing: PackPricing;
  specialists: { code: string; displayName: string; icon: string; executionStatus: string }[];
}

interface PriceVersion {
  id: string;
  status: "draft" | "active" | "superseded" | "archived";
  isCurrent: boolean;
  currency: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft:       { label: "Draft",       cls: "bg-[#1E3A5F] text-[#94A3B8]" },
  available:   { label: "Live",        cls: "bg-emerald-900/30 text-emerald-400" },
  coming_soon: { label: "Coming Soon", cls: "bg-amber-900/30 text-amber-400" },
  archived:    { label: "Archived",    cls: "bg-red-900/20 text-red-400" },
};

const PRICE_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft:      { label: "Draft",      cls: "bg-[#1E3A5F] text-[#94A3B8]" },
  active:     { label: "Active",     cls: "bg-emerald-900/30 text-emerald-400" },
  superseded: { label: "Superseded", cls: "bg-amber-900/30 text-amber-400" },
  archived:   { label: "Archived",   cls: "bg-red-900/20 text-red-400" },
};

const TIER_LABELS = { starter: "Starter", professional: "Professional", enterprise: "Enterprise" };

const BLANK_FORM = {
  code: "", name: "", description: "", marketingTagline: "",
  iconEmoji: "", colorHex: "#00D4FF", industry: "ndis_provider",
  tier: "professional" as Pack["tier"], displayOrder: "99", featured: false, isFree: false,
};

const BLANK_PRICE_FORM = {
  currency: "AUD",
  monthlyPriceCents: "",
  annualPriceCents: "",
  notes: "",
};

function fmtAUD(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `A$${Math.round(cents / 100).toLocaleString("en-AU")}`;
}

export default function PlatformPacksPage() {
  const apiFetch = useAuthFetch();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Pack | null>(null);
  const [mode, setMode] = useState<"list" | "create" | "edit" | "pricing">("list");
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Pricing panel state
  const [priceVersions, setPriceVersions] = useState<PriceVersion[]>([]);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [priceForm, setPriceForm] = useState({ ...BLANK_PRICE_FORM });
  const [showNewPriceForm, setShowNewPriceForm] = useState(false);
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceError, setPriceError] = useState("");

  const loadPacks = async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/v1/platform/packs");
      const d = await r.json();
      setPacks(d.packs ?? []);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadPacks(); }, []);

  const flash = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(""), 3500); };

  const handleCreate = () => {
    setForm({ ...BLANK_FORM });
    setMode("create");
    setError("");
  };

  const handleEdit = (p: Pack) => {
    setSelected(p);
    setForm({
      code: p.code,
      name: p.name,
      description: p.description ?? "",
      marketingTagline: p.marketingTagline ?? "",
      iconEmoji: p.iconEmoji ?? "",
      colorHex: p.colorHex ?? "#00D4FF",
      industry: p.industry,
      tier: p.tier,
      displayOrder: String(p.displayOrder),
      featured: p.featured,
      isFree: p.isFree,
    });
    setMode("edit");
    setError("");
  };

  const handleOpenPricing = async (p: Pack) => {
    setSelected(p);
    setMode("pricing");
    setPriceError("");
    setShowNewPriceForm(false);
    setPriceForm({ ...BLANK_PRICE_FORM });
    setPricingLoading(true);
    try {
      const r = await apiFetch(`/v1/platform/packs/${p.code}/prices`);
      const d = await r.json();
      setPriceVersions(d.versions ?? []);
    } finally { setPricingLoading(false); }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError("");
    try {
      const body = {
        name: form.name,
        code: form.code || undefined,
        description: form.description || null,
        marketingTagline: form.marketingTagline || null,
        iconEmoji: form.iconEmoji || null,
        colorHex: form.colorHex || null,
        industry: form.industry,
        tier: form.tier,
        displayOrder: Number(form.displayOrder),
        featured: form.featured,
        isFree: form.isFree,
      };

      let r: Response;
      if (mode === "create") {
        r = await apiFetch("/v1/platform/packs", { method: "POST", body: JSON.stringify(body) });
      } else {
        r = await apiFetch(`/v1/platform/packs/${selected!.code}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      const d = await r.json();
      if (!r.ok) { setError(d.error?.message ?? "Save failed."); return; }
      await loadPacks();
      setMode("list");
      flash(mode === "create" ? `Pack "${d.pack.name}" created.` : `Pack "${d.pack.name}" updated.`);
    } finally { setSaving(false); }
  };

  const handleAction = async (code: string, action: "publish" | "unpublish" | "archive") => {
    const r = await apiFetch(`/v1/platform/packs/${code}/${action}`, { method: "POST" });
    if (r.ok) { await loadPacks(); flash(`Pack ${action}ed.`); }
  };

  const handleCreatePriceVersion = async () => {
    if (!selected) return;
    setSavingPrice(true); setPriceError("");
    try {
      const body = {
        currency: priceForm.currency,
        monthlyPriceCents: priceForm.monthlyPriceCents ? Math.round(Number(priceForm.monthlyPriceCents) * 100) : null,
        annualPriceCents: priceForm.annualPriceCents ? Math.round(Number(priceForm.annualPriceCents) * 100) : null,
        notes: priceForm.notes || null,
      };
      const r = await apiFetch(`/v1/platform/packs/${selected.code}/prices`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setPriceError(d.error?.message ?? "Failed to create version."); return; }
      setPriceVersions(v => [d.version, ...v]);
      setShowNewPriceForm(false);
      setPriceForm({ ...BLANK_PRICE_FORM });
      flash("Draft price version created.");
    } finally { setSavingPrice(false); }
  };

  const handlePriceAction = async (vid: string, action: "activate" | "archive") => {
    if (!selected) return;
    const r = await apiFetch(`/v1/platform/packs/${selected.code}/prices/${vid}/${action}`, { method: "POST" });
    if (r.ok) {
      // Reload versions
      const r2 = await apiFetch(`/v1/platform/packs/${selected.code}/prices`);
      const d2 = await r2.json();
      setPriceVersions(d2.versions ?? []);
      await loadPacks();
      flash(`Price version ${action}d.`);
    }
  };

  const upd = (k: keyof typeof BLANK_FORM, v: any) => setForm(f => ({ ...f, [k]: v }));
  const updPrice = (k: keyof typeof BLANK_PRICE_FORM, v: any) => setPriceForm(f => ({ ...f, [k]: v }));

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-[#1E3A5F] px-8 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#E2E8F0]">Pack Builder</h1>
            <p className="text-[#64748B] text-sm mt-0.5">
              Create and manage workforce packs. Prices are controlled via versioned price configurations.
            </p>
          </div>
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] font-semibold text-sm rounded-lg hover:bg-[#00B8D9] transition-colors"
          >
            + New Pack
          </button>
        </div>

        {/* Flash */}
        {successMsg && (
          <div className="mx-8 mt-4 px-4 py-2 bg-emerald-900/30 border border-emerald-700/40 text-emerald-400 text-sm rounded-lg">
            ✓ {successMsg}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Pack list */}
          <div className="flex-1 overflow-y-auto p-8">
            {loading ? (
              <div className="text-[#64748B] text-sm">Loading packs…</div>
            ) : (
              <div className="space-y-3">
                {packs.map(p => {
                  const sc = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.draft;
                  const pricingLabel = p.isFree
                    ? "Free"
                    : p.pricing?.displayMode === "priced" && p.pricing.monthlyPriceCents != null
                    ? `${fmtAUD(p.pricing.monthlyPriceCents)}/month`
                    : "No price set";
                  const pricingCls = p.isFree
                    ? "text-[#00D4FF]"
                    : p.pricing?.displayMode === "priced"
                    ? "text-[#E2E8F0]"
                    : "text-[#64748B]";
                  return (
                    <div
                      key={p.code}
                      className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-5 flex items-start justify-between gap-4"
                    >
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div
                          className="h-12 w-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                          style={{ background: `${p.colorHex ?? "#00D4FF"}20`, border: `1px solid ${p.colorHex ?? "#00D4FF"}40` }}
                        >
                          {p.iconEmoji ?? "📦"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold text-[#E2E8F0]">{p.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.cls}`}>{sc.label}</span>
                            {p.featured && <span className="text-xs px-2 py-0.5 rounded-full bg-[#00D4FF]/10 text-[#00D4FF]">⭐ Featured</span>}
                            <span className="text-xs text-[#475569] font-mono">{p.code}</span>
                          </div>
                          <p className="text-[#64748B] text-xs line-clamp-1 mb-2">{p.marketingTagline ?? p.description}</p>
                          <div className="flex items-center gap-4 text-xs text-[#64748B]">
                            <span>{TIER_LABELS[p.tier]}</span>
                            <span>·</span>
                            <span className={pricingCls}>{pricingLabel}</span>
                            <span>·</span>
                            <span>{p.specialists.length} specialists</span>
                            <span>·</span>
                            <span>{p.isPubliclyVisible ? "Visible" : "Hidden"}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleOpenPricing(p)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-violet-800/50 text-violet-400 hover:bg-violet-900/20 transition-colors"
                        >
                          💰 Pricing
                        </button>
                        <button
                          onClick={() => handleEdit(p)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-[#1E3A5F] text-[#94A3B8] hover:text-[#E2E8F0] hover:border-[#00D4FF] transition-colors"
                        >
                          Edit
                        </button>
                        {p.status === "draft" && (
                          <button
                            onClick={() => handleAction(p.code, "publish")}
                            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 transition-colors"
                          >
                            Publish
                          </button>
                        )}
                        {p.status === "available" && (
                          <button
                            onClick={() => handleAction(p.code, "unpublish")}
                            className="text-xs px-3 py-1.5 rounded-lg bg-amber-900/20 text-amber-400 hover:bg-amber-900/40 transition-colors"
                          >
                            Unpublish
                          </button>
                        )}
                        {p.status !== "archived" && (
                          <button
                            onClick={() => handleAction(p.code, "archive")}
                            className="text-xs px-3 py-1.5 rounded-lg text-[#64748B] hover:text-red-400 hover:bg-red-900/10 transition-colors"
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Create / Edit panel */}
          {(mode === "create" || mode === "edit") && (
            <div className="w-96 shrink-0 border-l border-[#1E3A5F] bg-[#080F1A] overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-[#E2E8F0] font-semibold">{mode === "create" ? "New Pack" : "Edit Pack"}</h2>
                <button onClick={() => setMode("list")} className="text-[#64748B] hover:text-[#E2E8F0]">✕</button>
              </div>

              {error && <p className="text-red-400 text-xs mb-4 bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>}

              <div className="space-y-4">
                {mode === "create" && (
                  <Field label="Code (slug)" hint="e.g. my_new_pack">
                    <input value={form.code} onChange={e => upd("code", e.target.value)} placeholder="auto-generated if blank" className={INPUT} />
                  </Field>
                )}

                <Field label="Name *">
                  <input value={form.name} onChange={e => upd("name", e.target.value)} placeholder="e.g. Compliance Workforce" className={INPUT} />
                </Field>

                <Field label="Tagline">
                  <input value={form.marketingTagline} onChange={e => upd("marketingTagline", e.target.value)} placeholder="Short selling sentence" className={INPUT} />
                </Field>

                <Field label="Description">
                  <textarea value={form.description} onChange={e => upd("description", e.target.value)} rows={3} className={INPUT + " resize-none"} placeholder="Full description" />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Icon emoji">
                    <input value={form.iconEmoji} onChange={e => upd("iconEmoji", e.target.value)} placeholder="✅" className={INPUT} />
                  </Field>
                  <Field label="Color hex">
                    <div className="flex gap-2">
                      <input type="color" value={form.colorHex} onChange={e => upd("colorHex", e.target.value)} className="h-[38px] w-10 rounded border border-[#1E3A5F] bg-[#0B1829] cursor-pointer p-0.5" />
                      <input value={form.colorHex} onChange={e => upd("colorHex", e.target.value)} className={INPUT + " flex-1"} />
                    </div>
                  </Field>
                </div>

                <Field label="Tier">
                  <select value={form.tier} onChange={e => upd("tier", e.target.value as Pack["tier"])} className={INPUT}>
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </Field>

                <div className="border-t border-[#1E3A5F] pt-4">
                  <p className="text-xs text-[#64748B] uppercase tracking-wider mb-3">Pricing basis</p>
                  <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-[#1E3A5F] hover:border-[#00D4FF]/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={form.isFree}
                      onChange={e => upd("isFree", e.target.checked)}
                      className="h-4 w-4 rounded border-[#1E3A5F] accent-[#00D4FF]"
                    />
                    <div>
                      <p className="text-sm text-[#E2E8F0]">Free pack</p>
                      <p className="text-xs text-[#64748B]">Included at no charge. Paid packs use versioned prices (set via 💰 Pricing).</p>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Display order">
                    <input type="number" value={form.displayOrder} onChange={e => upd("displayOrder", e.target.value)} className={INPUT} />
                  </Field>
                  <div className="flex items-end pb-0.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.featured}
                        onChange={e => upd("featured", e.target.checked)}
                        className="rounded border-[#1E3A5F] accent-[#00D4FF] h-4 w-4"
                      />
                      <span className="text-sm text-[#94A3B8]">Featured</span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 py-2 bg-[#00D4FF] text-[#0B1829] font-semibold text-sm rounded-lg hover:bg-[#00B8D9] disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Saving…" : mode === "create" ? "Create Pack" : "Save Changes"}
                  </button>
                  <button onClick={() => setMode("list")} className="px-4 py-2 border border-[#1E3A5F] text-[#94A3B8] text-sm rounded-lg hover:border-[#00D4FF] transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pricing Versions panel */}
          {mode === "pricing" && selected && (
            <div className="w-[480px] shrink-0 border-l border-[#1E3A5F] bg-[#080F1A] overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-[#E2E8F0] font-semibold">Pricing — {selected.name}</h2>
                <button onClick={() => setMode("list")} className="text-[#64748B] hover:text-[#E2E8F0]">✕</button>
              </div>
              <p className="text-[#64748B] text-xs mb-5">
                Create a draft, review it, then activate. Activating supersedes the previous active version.
              </p>

              {priceError && (
                <p className="text-red-400 text-xs mb-4 bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2">{priceError}</p>
              )}

              {selected.isFree ? (
                <div className="text-sm text-[#64748B] bg-[#0B1829] border border-[#1E3A5F] rounded-xl px-4 py-3">
                  This is a free pack. Price versions are only for paid packs.
                </div>
              ) : (
                <>
                  {/* Version list */}
                  {pricingLoading ? (
                    <div className="text-[#64748B] text-sm">Loading versions…</div>
                  ) : priceVersions.length === 0 ? (
                    <div className="text-[#64748B] text-sm bg-[#0B1829] border border-[#1E3A5F] rounded-xl px-4 py-3">
                      No price versions yet. Create a draft below.
                    </div>
                  ) : (
                    <div className="space-y-3 mb-5">
                      {priceVersions.map(v => {
                        const vc = PRICE_STATUS_CONFIG[v.status] ?? PRICE_STATUS_CONFIG.draft;
                        return (
                          <div
                            key={v.id}
                            className={`rounded-xl border bg-[#0B1829] p-4 ${v.isCurrent && v.status === "active" ? "border-emerald-700/40" : "border-[#1E3A5F]"}`}
                          >
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${vc.cls}`}>{vc.label}</span>
                                {v.isCurrent && v.status === "active" && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/20 text-emerald-400 font-medium">Current</span>
                                )}
                                <span className="text-xs text-[#475569] font-mono">{v.currency}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {v.status === "draft" && (
                                  <button
                                    onClick={() => handlePriceAction(v.id, "activate")}
                                    className="text-xs px-2.5 py-1 rounded-lg bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 transition-colors"
                                  >
                                    Activate
                                  </button>
                                )}
                                {(v.status === "draft" || v.status === "active") && (
                                  <button
                                    onClick={() => handlePriceAction(v.id, "archive")}
                                    className="text-xs px-2.5 py-1 rounded-lg text-[#64748B] hover:text-red-400 hover:bg-red-900/10 transition-colors"
                                  >
                                    Archive
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div>
                                <p className="text-[#64748B] mb-0.5">Monthly</p>
                                <p className="text-[#E2E8F0] font-semibold">{fmtAUD(v.monthlyPriceCents)}</p>
                              </div>
                              <div>
                                <p className="text-[#64748B] mb-0.5">Annual</p>
                                <p className="text-[#E2E8F0] font-semibold">{fmtAUD(v.annualPriceCents)}</p>
                              </div>
                            </div>
                            {v.notes && <p className="text-[#64748B] text-xs mt-2 italic">{v.notes}</p>}
                            <p className="text-[#475569] text-xs mt-2">Created {new Date(v.createdAt).toLocaleDateString("en-AU")}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* New version form */}
                  {showNewPriceForm ? (
                    <div className="border border-violet-800/40 bg-violet-950/10 rounded-xl p-4">
                      <p className="text-[#E2E8F0] text-sm font-semibold mb-4">New draft version</p>
                      <div className="space-y-3">
                        <Field label="Currency">
                          <select value={priceForm.currency} onChange={e => updPrice("currency", e.target.value)} className={INPUT}>
                            <option value="AUD">AUD</option>
                            <option value="USD">USD</option>
                            <option value="NZD">NZD</option>
                          </select>
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Monthly (in dollars)" hint="e.g. 299">
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-sm">A$</span>
                              <input
                                type="number" min="0" step="0.01"
                                value={priceForm.monthlyPriceCents}
                                onChange={e => updPrice("monthlyPriceCents", e.target.value)}
                                placeholder="299.00"
                                className={INPUT + " pl-9"}
                              />
                            </div>
                          </Field>
                          <Field label="Annual (in dollars)" hint="e.g. 2870">
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-sm">A$</span>
                              <input
                                type="number" min="0" step="0.01"
                                value={priceForm.annualPriceCents}
                                onChange={e => updPrice("annualPriceCents", e.target.value)}
                                placeholder="2870.00"
                                className={INPUT + " pl-9"}
                              />
                            </div>
                          </Field>
                        </div>
                        <Field label="Notes (internal)" hint="optional">
                          <input value={priceForm.notes} onChange={e => updPrice("notes", e.target.value)} placeholder="e.g. Launch pricing" className={INPUT} />
                        </Field>
                        <div className="flex gap-2">
                          <button
                            onClick={handleCreatePriceVersion}
                            disabled={savingPrice}
                            className="flex-1 py-2 bg-violet-600 text-white font-semibold text-sm rounded-lg hover:bg-violet-500 disabled:opacity-50 transition-colors"
                          >
                            {savingPrice ? "Creating…" : "Create Draft"}
                          </button>
                          <button
                            onClick={() => { setShowNewPriceForm(false); setPriceError(""); }}
                            className="px-3 py-2 border border-[#1E3A5F] text-[#94A3B8] text-sm rounded-lg hover:border-[#00D4FF] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewPriceForm(true)}
                      className="w-full py-2 border border-dashed border-violet-800/50 text-violet-400 text-sm rounded-xl hover:bg-violet-900/10 transition-colors"
                    >
                      + New draft price version
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}

const INPUT = "w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-[#E2E8F0] text-sm focus:outline-none focus:border-[#00D4FF] transition-colors";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs text-[#94A3B8] mb-1">{label}{hint && <span className="ml-1 text-[#475569]">— {hint}</span>}</label>
      {children}
    </div>
  );
}
