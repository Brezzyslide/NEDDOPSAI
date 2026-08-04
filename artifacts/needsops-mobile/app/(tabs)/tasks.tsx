/**
 * Tasks screen — Task #37
 * Updated to use useOrgContext() instead of global.__needsops_org_slug.
 * Task state model uses currentState + server TaskState values.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import { useOrgContext } from '@/contexts/OrgContext';
import { SpecialistMessageBubble } from '@/components/SpecialistMessageBubble';

// ─── Task state model (mirrors server TaskState enum) ────────────────────────

const STATES: { key: string; label: string; colour: string }[] = [
  { key: 'draft',              label: 'Draft',            colour: '#6b7280' },
  { key: 'queued',             label: 'Queued',           colour: '#3b82f6' },
  { key: 'planning',           label: 'Planning',         colour: '#60a5fa' },
  { key: 'awaiting_approval',  label: 'Awaiting Approval', colour: '#FCD34D' },
  { key: 'approved',           label: 'Approved',         colour: '#10B981' },
  { key: 'executing',          label: 'Executing',        colour: '#8b5cf6' },
  { key: 'completed',          label: 'Completed',        colour: '#34d399' },
  { key: 'cancelled',          label: 'Cancelled',        colour: '#6b7280' },
  { key: 'failed',             label: 'Failed',           colour: '#F87171' },
];

function stateStyle(currentState: string) {
  return STATES.find(s => s.key === currentState) ?? { label: currentState.replace(/_/g, ' '), colour: '#6b7280' };
}

// ─── Specialist messages sub-component ───────────────────────────────────────

function TaskSpecialistMessages({ orgSlug, taskId }: { orgSlug: string; taskId: string }) {
  const apiFetch = useAuthenticatedFetch();

  const { data, isLoading } = useQuery({
    queryKey: ['task-workroom-messages', orgSlug, taskId],
    queryFn: async () => {
      const res = await apiFetch(`/v1/organisations/${orgSlug}/tasks/${taskId}/workroom`);
      if (!res.ok) return { messages: [] };
      return res.json();
    },
    staleTime: 60_000,
  });

  const messages: any[] = data?.messages ?? [];

  if (isLoading) {
    return <ActivityIndicator style={{ marginVertical: 8 }} />;
  }

  if (messages.length === 0) {
    return null;
  }

  return (
    <View style={{ marginTop: 8, gap: 4 }}>
      {messages.slice(-3).map((m: any) => (
        <SpecialistMessageBubble key={m.id} msg={m} />
      ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TasksScreen() {
  const colors   = useColors();
  const apiFetch = useAuthenticatedFetch();
  const { selectedOrg, needsSelection } = useOrgContext();
  const orgSlug = selectedOrg?.slug;

  const [activeState,    setActiveState]    = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['mobile-tasks', orgSlug, activeState],
    queryFn: async () => {
      if (!orgSlug) return { tasks: [] };
      const stateParam = activeState ? `?state=${activeState}` : '';
      const res = await apiFetch(`/v1/organisations/${orgSlug}/tasks${stateParam}`);
      if (!res.ok) return { tasks: [] };
      return res.json();
    },
    enabled: !!orgSlug,
    refetchInterval: 30_000,
  });

  const tasks: any[] = data?.tasks ?? [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>AI WORKFORCE</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Task Centre</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Tasks managed by your AI workforce
          </Text>
        </View>

        {!orgSlug && (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {needsSelection
                ? 'Select an organisation from the Organisations tab to view tasks.'
                : 'No organisation connected yet. Visit the Organisations tab to get started.'}
            </Text>
          </View>
        )}

        {orgSlug && (
          <>
            {/* State filter chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              <TouchableOpacity
                onPress={() => setActiveState(null)}
                style={[
                  styles.chip,
                  {
                    borderColor:       activeState === null ? colors.primary : colors.border,
                    backgroundColor:   activeState === null ? colors.primary + '22' : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: activeState === null ? colors.primary : colors.mutedForeground }]}>
                  All
                </Text>
              </TouchableOpacity>
              {STATES.map(s => (
                <TouchableOpacity
                  key={s.key}
                  onPress={() => setActiveState(s.key)}
                  style={[
                    styles.chip,
                    {
                      borderColor:     activeState === s.key ? s.colour : colors.border,
                      backgroundColor: activeState === s.key ? s.colour + '22' : 'transparent',
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: activeState === s.key ? s.colour : colors.mutedForeground }]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
            ) : isError ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.emptyText, { color: '#F87171' }]}>Failed to load tasks.</Text>
              </View>
            ) : tasks.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  {activeState ? `No ${activeState.replace(/_/g, ' ')} tasks.` : 'No tasks found.'}
                </Text>
              </View>
            ) : (
              <View style={styles.list}>
                {tasks.map((task: any) => {
                  const s = stateStyle(task.currentState ?? '');
                  const isExpanded   = expandedTaskId === task.id;
                  // Show workroom messages for active work states
                  const showMessages = ['planning', 'awaiting_approval', 'executing'].includes(
                    task.currentState ?? '',
                  );

                  return (
                    <TouchableOpacity
                      key={task.id}
                      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.cardTop}>
                        <View style={[styles.badge, { backgroundColor: s.colour + '22' }]}>
                          <Text style={[styles.badgeText, { color: s.colour }]}>{s.label}</Text>
                        </View>
                        {task.specialist && (
                          <Text style={[styles.specialist, { color: colors.mutedForeground }]}>
                            {(task.specialist as string).replace(/_/g, ' ')}
                          </Text>
                        )}
                      </View>
                      <Text style={[styles.taskName, { color: colors.foreground }]}>
                        {task.title ?? task.description ?? 'Untitled task'}
                      </Text>
                      {task.description && task.title && (
                        <Text
                          style={[styles.taskDesc, { color: colors.mutedForeground }]}
                          numberOfLines={isExpanded ? undefined : 2}
                        >
                          {task.description}
                        </Text>
                      )}
                      {task.createdAt && (
                        <Text style={[styles.date, { color: colors.mutedForeground }]}>
                          {new Date(task.createdAt).toLocaleDateString('en-AU')}
                        </Text>
                      )}
                      {isExpanded && orgSlug && showMessages && (
                        <TaskSpecialistMessages orgSlug={orgSlug} taskId={task.id} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  scroll:    { flex: 1 },
  content:   { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  header:    { marginBottom: 20 },
  eyebrow:   { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  title:     { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle:  { fontSize: 13, marginTop: 4 },
  chips:     { marginBottom: 16, flexGrow: 0 },
  chip:      { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  chipText:  { fontSize: 12, fontWeight: '600' },
  list:      { gap: 10 },
  card:      { borderRadius: 12, borderWidth: 1, padding: 14, gap: 6 },
  cardTop:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge:     { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  specialist:{ fontSize: 12, textTransform: 'capitalize' },
  taskName:  { fontSize: 14, fontWeight: '600' },
  taskDesc:  { fontSize: 13, lineHeight: 18 },
  date:      { fontSize: 12 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 13, textAlign: 'center' },
});
