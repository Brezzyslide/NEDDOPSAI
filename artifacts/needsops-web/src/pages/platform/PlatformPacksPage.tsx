/**
 * Platform Pack Builder — /platform/packs
 * Create, edit, publish, archive workforce packs and set pricing.
 */
import { useState, useEffect } from "react";
import PlatformShell from "@/components/layout/PlatformShell";
import { useAuthFetch } from "@/lib/api";

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
  priceMonthly: number | null;
  priceAnnual: number | null;
  priceMonthlyAud: string | null;
  priceAnnualAud: string | null;
  currency: string;
  displayOrder: number;
  featured: boolean;
  isPubliclyVisible: boolean;
  specialists: { code: string; displayName: string; icon: string; executionStatus: string }[];
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft:       { label: "Draft",       cls: "bg-[#1E3A5F] text-[#94A3B8]" },
  available:   { label: "Live",        cls: "bg-emerald-900/30 text-emerald-400" },
  coming_soon: { label: "Coming Soon", cls: "bg-amber-900/30 text-amber-400" },
  archived:    { label: "Archived",    cls: "bg-red-900/20 text-red-400" },
};

const TIER_LABELS = { starter: "Starter", professional: "Professional", enterprise: "Enterprise" };

const BLANK_FORM = {
  code: "", name: "", description: "", marketingTagline: "",
  iconEmoji: "", colorHex: "#00D4FF", industry: "ndis_provider",
  tier: "professional" as Pack["tier"], priceMonthly: "", priceAnnual: "",
  currency: "AUD", displayOrder: "99", featured: false,
};

export default function PlatformPacksPage() {
  const apiFetch = useAuthFetch();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Pack | null>(null);
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const loadPacks = async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/v1/platform/packs");
      const d = await r.json();
      setPacks(d.packs ?? []);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadPacks(); }, []);

  const flash = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(""), 3000); };

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
      priceMonthly: p.priceMonthlyAud ?? "",
      priceAnnual: p.priceAnnualAud ?? "",
      currency: p.currency,
      displayOrder: String(p.displayOrder),
      featured: p.featured,
    });
    setMode("edit");
    setError("");
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
        priceMonthly: form.priceMonthly ? Number(form.priceMonthly) : null,
        priceAnnual: form.priceAnnual ? Number(form.priceAnnual) : null,
        currency: form.currency,
        displayOrder: Number(form.displayOrder),
        featured: form.featured,
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

  const upd = (k: keyof typeof BLANK_FORM, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-[#1E3A5F] px-8 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#E2E8F0]">Pack Builder</h1>
            <p className="text-[#64748B] text-sm mt-0.5">Create and manage workforce packs. Set pricing, publish to the marketplace.</p>
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
                            <span>
                              {p.priceMonthlyAud != null && p.priceMonthly !== 0
                                ? `$${p.priceMonthlyAud}/mo`
                                : p.priceMonthly === 0
                                ? "Free"
                                : "No price set"}
                            </span>
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
                  <p className="text-xs text-[#64748B] uppercase tracking-wider mb-3">Pricing</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Monthly (AUD)" hint="Leave blank = free">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-sm">$</span>
                        <input type="number" min="0" step="0.01" value={form.priceMonthly} onChange={e => upd("priceMonthly", e.target.value)} placeholder="0.00" className={INPUT + " pl-7"} />
                      </div>
                    </Field>
                    <Field label="Annual (AUD)" hint="Leave blank = free">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-sm">$</span>
                        <input type="number" min="0" step="0.01" value={form.priceAnnual} onChange={e => upd("priceAnnual", e.target.value)} placeholder="0.00" className={INPUT + " pl-7"} />
                      </div>
                    </Field>
                  </div>
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
