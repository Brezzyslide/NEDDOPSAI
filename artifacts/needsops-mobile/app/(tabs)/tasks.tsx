/**
 * Tasks screen — Sprint 9
 * Replaced placeholder data with real API calls via the workspace API client.
 * Org slug is read from the org selection stored in the organisations screen.
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

const STATE_COLOUR: Record<string, string> = {
  draft:             '#64748B',
  queued:            '#60A5FA',
  planning:          '#A78BFA',
  awaiting_approval: '#FCD34D',
  approved:          '#34D399',
  executing:         '#818CF8',
  completed:         '#10B981',
  cancelled:         '#64748B',
  failed:            '#F87171',
};

const STATE_ICON: Record<string, string> = {
  draft: '◎', queued: '⏳', planning: '🧠', awaiting_approval: '⚠',
  approved: '✓', executing: '⚡', completed: '✅', cancelled: '✕', failed: '✕',
};

const STATES = ['queued', 'planning', 'awaiting_approval', 'executing', 'completed'];

export default function TasksScreen() {
  const colors = useColors();
  const [activeState, setActiveState] = useState<string | null>(null);
  const apiFetch = useAuthenticatedFetch();

  // Read selected org slug from global store (set in organisations screen)
  const orgSlug = (global as any).__needsops_org_slug as string | undefined;

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
              Select an organisation from the Organisations tab to view tasks.
            </Text>
          </View>
        )}

        {orgSlug && (
          <>
            {/* State filter chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              <TouchableOpacity
                onPress={() => setActiveState(null)}
                style={[styles.chip, { borderColor: colors.border, backgroundColor: activeState === null ? colors.primary + '22' : 'transparent' }]}
              >
                <Text style={[styles.chipText, { color: activeState === null ? colors.primary : colors.mutedForeground }]}>All</Text>
              </TouchableOpacity>
              {STATES.map(s => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setActiveState(activeState === s ? null : s)}
                  style={[styles.chip, {
                    borderColor: activeState === s ? STATE_COLOUR[s] ?? colors.border : colors.border,
                    backgroundColor: activeState === s ? (STATE_COLOUR[s] ?? colors.primary) + '22' : 'transparent',
                  }]}
                >
                  <Text style={[styles.chipText, { color: activeState === s ? STATE_COLOUR[s] ?? colors.primary : colors.mutedForeground }]}>
                    {s.replace(/_/g, ' ')}
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
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No tasks found.</Text>
              </View>
            ) : (
              <View style={styles.taskList}>
                {tasks.map((task: any) => (
                  <View key={task.id} style={[styles.taskCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.taskRow}>
                      <Text style={[styles.stateIcon, { color: STATE_COLOUR[task.currentState] ?? colors.primary }]}>
                        {STATE_ICON[task.currentState] ?? '◎'}
                      </Text>
                      <View style={styles.taskInfo}>
                        <Text style={[styles.taskTitle, { color: colors.foreground }]}>{task.title}</Text>
                        <View style={styles.taskMeta}>
                          <Text style={[styles.taskState, { color: STATE_COLOUR[task.currentState] ?? colors.mutedForeground }]}>
                            {task.currentState.replace(/_/g, ' ')}
                          </Text>
                          <Text style={[styles.taskDot, { color: colors.mutedForeground }]}> · </Text>
                          <Text style={[styles.taskPriority, {
                            color: task.priority === 'urgent' ? '#F87171'
                              : task.priority === 'high' ? '#FCD34D'
                              : colors.mutedForeground
                          }]}>
                            {task.priority}
                          </Text>
                        </View>
                        <Text style={[styles.taskDate, { color: colors.mutedForeground }]}>
                          {new Date(task.createdAt).toLocaleDateString('en-AU')}
                        </Text>
                      </View>
                    </View>
                    {task.currentState === 'awaiting_approval' && (
                      <View style={[styles.approvalBadge, { backgroundColor: '#FCD34D22', borderColor: '#FCD34D44' }]}>
                        <Text style={{ color: '#FCD34D', fontSize: 11, fontWeight: '600' }}>
                          ⚠ Awaiting your approval — open web portal to review
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
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
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  header: { marginBottom: 20 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, marginTop: 4 },
  chips: { marginBottom: 16, flexGrow: 0 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  chipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  taskList: { gap: 10 },
  taskCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stateIcon: { fontSize: 16, width: 20, textAlign: 'center', marginTop: 2 },
  taskInfo: { flex: 1 },
  taskTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  taskMeta: { flexDirection: 'row', alignItems: 'center' },
  taskState: { fontSize: 12, textTransform: 'capitalize' },
  taskDot: { fontSize: 12 },
  taskPriority: { fontSize: 12, textTransform: 'capitalize' },
  taskDate: { fontSize: 11, marginTop: 2 },
  approvalBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 13, textAlign: 'center' },
});
