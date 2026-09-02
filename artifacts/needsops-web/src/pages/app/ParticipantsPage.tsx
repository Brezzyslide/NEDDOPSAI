import { useMemo, useState } from "react";
import { Show } from "@clerk/react";
import { Redirect, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";
import { useOrgRole } from "@/hooks/useOrgRole";

type Participant = {
  id: string;
  displayName: string;
  preferredName?: string | null;
  externalParticipantId?: string | null;
  status: "active" | "inactive" | "archived";
};

type ParticipantSource = {
  id: string;
  title?: string | null;
  originalFileName?: string | null;
  status?: string;
};

const STATUS_OPTIONS = ["active", "inactive", "archived"] as const;

function sourceLabel(source: ParticipantSource) {
  return source.title || source.originalFileName || source.id;
}

export default function ParticipantsPage() {
  const { slug } = useParams<{ slug: string }>();
  const apiFetch = useAuthFetch();
  const qc = useQueryClient();
  const { isKnowledgeAdmin } = useOrgRole(slug);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    displayName: "",
    preferredName: "",
    externalParticipantId: "",
    status: "active",
  });

  const participantsQuery = useQuery({
    queryKey: ["participants", slug, query, status],
    enabled: !!slug,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      const res = await apiFetch(`/v1/organisations/${slug}/participants?${params.toString()}`);
      return res.json();
    },
  });

  const unlinkedQuery = useQuery({
    queryKey: ["participant-unlinked-sources", slug],
    enabled: !!slug,
    queryFn: async () => {
      const res = await apiFetch(`/v1/organisations/${slug}/participants/unlinked-sources`);
      return res.json();
    },
  });

  const selectedSourcesQuery = useQuery({
    queryKey: ["participant-sources", slug, selectedId],
    enabled: !!slug && !!selectedId,
    queryFn: async () => {
      const res = await apiFetch(`/v1/organisations/${slug}/participants/${selectedId}/sources`);
      return res.json();
    },
  });

  const createParticipant = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/v1/organisations/${slug}/participants`, {
        method: "POST",
        body: JSON.stringify({
          displayName: form.displayName,
          preferredName: form.preferredName || null,
          externalParticipantId: form.externalParticipantId || null,
          status: form.status,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not create participant.");
      return body;
    },
    onSuccess: (body) => {
      qc.invalidateQueries({ queryKey: ["participants", slug] });
      setSelectedId(body.participant.id);
      setForm({ displayName: "", preferredName: "", externalParticipantId: "", status: "active" });
    },
  });

  const updateParticipant = useMutation({
    mutationFn: async (participant: Participant) => {
      const res = await apiFetch(`/v1/organisations/${slug}/participants/${participant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: participant.status === "active" ? "inactive" : "active" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not update participant.");
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["participants", slug] }),
  });

  const deleteParticipant = useMutation({
    mutationFn: async (participantId: string) => {
      const res = await apiFetch(`/v1/organisations/${slug}/participants/${participantId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not archive participant.");
      return body;
    },
    onSuccess: (body) => {
      qc.invalidateQueries({ queryKey: ["participants", slug] });
      if (selectedId === body.participant.id) setSelectedId(null);
      const taskCount = body.boundTasks?.length ?? 0;
      const sourceCount = body.linkedSources?.length ?? 0;
      if (taskCount > 0 || sourceCount > 0) {
        alert(`Participant archived. Existing references remain visible: ${taskCount} task binding(s), ${sourceCount} linked source(s).`);
      }
    },
  });

  const linkSource = useMutation({
    mutationFn: async (sourceId: string) => {
      const res = await apiFetch(`/v1/organisations/${slug}/participants/${selectedId}/sources/${sourceId}`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not link source.");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participant-sources", slug, selectedId] });
      qc.invalidateQueries({ queryKey: ["participant-unlinked-sources", slug] });
    },
  });

  const unlinkSource = useMutation({
    mutationFn: async (sourceId: string) => {
      const res = await apiFetch(`/v1/organisations/${slug}/participants/${selectedId}/sources/${sourceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "Could not unlink source.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participant-sources", slug, selectedId] });
      qc.invalidateQueries({ queryKey: ["participant-unlinked-sources", slug] });
    },
  });

  const participants: Participant[] = participantsQuery.data?.participants ?? [];
  const selectedParticipant = useMemo(
    () => participants.find(participant => participant.id === selectedId) ?? null,
    [participants, selectedId],
  );
  const unlinkedSources: ParticipantSource[] = unlinkedQuery.data?.sources ?? [];
  const selectedSources: ParticipantSource[] = selectedSourcesQuery.data?.sources ?? [];

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-7xl">
          <div className="flex items-start justify-between gap-6 mb-8">
            <div>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Participants</h1>
              <p className="text-[#64748B] text-sm mt-1">
                Identity records for task binding and participant-document scoping.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
            <div className="space-y-4">
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
                <div className="flex flex-col md:flex-row gap-3">
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search participants"
                    className="flex-1 bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder:text-[#64748B] outline-none focus:border-[#00D4FF]"
                  />
                  <select
                    value={status}
                    onChange={event => setStatus(event.target.value)}
                    className="bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] outline-none focus:border-[#00D4FF]"
                  >
                    {STATUS_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
              </div>

              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-hidden">
                {participantsQuery.isLoading ? (
                  <div className="px-6 py-8 text-[#64748B] text-sm">Loading...</div>
                ) : participants.length === 0 ? (
                  <div className="px-6 py-8 text-[#64748B] text-sm">No participants found.</div>
                ) : participants.map(participant => (
                  <button
                    key={participant.id}
                    onClick={() => setSelectedId(participant.id)}
                    className={`w-full text-left px-6 py-4 border-b border-[#1E3A5F] last:border-0 hover:bg-[#0B1829] transition-colors ${
                      selectedId === participant.id ? "bg-[#00D4FF]/5" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[#E2E8F0] text-sm font-semibold truncate">{participant.displayName}</p>
                        <p className="text-[#64748B] text-xs mt-0.5">
                          {participant.preferredName ? `Preferred: ${participant.preferredName}` : "No preferred name"}
                          {participant.externalParticipantId ? ` · ID ${participant.externalParticipantId}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[#1E3A5F] px-2 py-0.5 text-xs text-[#94A3B8]">
                        {participant.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
                <h2 className="text-[#E2E8F0] font-semibold text-sm mb-3">Add participant</h2>
                {isKnowledgeAdmin ? (
                  <form
                    className="space-y-3"
                    onSubmit={event => {
                      event.preventDefault();
                      createParticipant.mutate();
                    }}
                  >
                    <input
                      value={form.displayName}
                      onChange={event => setForm(prev => ({ ...prev, displayName: event.target.value }))}
                      placeholder="Display name"
                      className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder:text-[#64748B] outline-none focus:border-[#00D4FF]"
                    />
                    <input
                      value={form.preferredName}
                      onChange={event => setForm(prev => ({ ...prev, preferredName: event.target.value }))}
                      placeholder="Preferred name"
                      className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder:text-[#64748B] outline-none focus:border-[#00D4FF]"
                    />
                    <input
                      value={form.externalParticipantId}
                      onChange={event => setForm(prev => ({ ...prev, externalParticipantId: event.target.value }))}
                      placeholder="External participant ID"
                      className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder:text-[#64748B] outline-none focus:border-[#00D4FF]"
                    />
                    <button
                      type="submit"
                      disabled={createParticipant.isPending || form.displayName.trim().length < 2}
                      className="w-full px-3 py-2 rounded-lg bg-[#00D4FF] text-[#0B1829] text-sm font-semibold hover:bg-[#00B8D9] disabled:opacity-50"
                    >
                      {createParticipant.isPending ? "Adding..." : "Add participant"}
                    </button>
                    {createParticipant.error && (
                      <p className="text-red-400 text-xs">{createParticipant.error.message}</p>
                    )}
                  </form>
                ) : (
                  <p className="text-[#64748B] text-sm">Owner or administrator role required.</p>
                )}
              </div>

              {selectedParticipant && (
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-[#E2E8F0] font-semibold text-sm">{selectedParticipant.displayName}</h2>
                      <p className="text-[#64748B] text-xs mt-0.5">Linked participant documents</p>
                    </div>
                    {isKnowledgeAdmin && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateParticipant.mutate(selectedParticipant)}
                          className="text-xs text-[#00D4FF] hover:text-[#00B8D9]"
                        >
                          {selectedParticipant.status === "active" ? "Mark inactive" : "Mark active"}
                        </button>
                        <button
                          onClick={() => deleteParticipant.mutate(selectedParticipant.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Archive
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 mb-4">
                    {selectedSources.length === 0 ? (
                      <p className="text-[#64748B] text-xs">No linked sources.</p>
                    ) : selectedSources.map(source => (
                      <div key={source.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2">
                        <span className="min-w-0 text-[#E2E8F0] text-xs truncate">{sourceLabel(source)}</span>
                        {isKnowledgeAdmin && (
                          <button
                            onClick={() => unlinkSource.mutate(source.id)}
                            className="shrink-0 text-xs text-red-400 hover:text-red-300"
                          >
                            Unlink
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {isKnowledgeAdmin && (
                    <div>
                      <p className="text-[#64748B] text-xs mb-2">Unlinked participant documents</p>
                      {unlinkedSources.length === 0 ? (
                        <p className="text-[#64748B] text-xs">No unlinked participant documents.</p>
                      ) : (
                        <div className="space-y-2">
                          {unlinkedSources.map(source => (
                            <button
                              key={source.id}
                              onClick={() => linkSource.mutate(source.id)}
                              className="w-full text-left rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2 text-xs text-[#E2E8F0] hover:border-[#00D4FF]/40"
                            >
                              {sourceLabel(source)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </AppShell>
    </>
  );
}
