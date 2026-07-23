import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';

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

export default function TasksScreen() {
  const colors = useColors();
  const [activeState, setActiveState] = useState<string | null>(null);

  // Placeholder tasks — replaced with real API calls when an org context is wired into mobile
  const PLACEHOLDER_TASKS = [
    { id: '1', title: 'Review NDIS Compliance Policy', currentState: 'awaiting_approval', priority: 'high', createdAt: new Date().toISOString() },
    { id: '2', title: 'Prepare Q2 Budget Summary', currentState: 'planning', priority: 'normal', createdAt: new Date().toISOString() },
    { id: '3', title: 'Staff Compliance Check — July', currentState: 'queued', priority: 'normal', createdAt: new Date().toISOString() },
    { id: '4', title: 'Incident Review — Case #4412', currentState: 'completed', priority: 'urgent', createdAt: new Date(Date.now() - 86400000).toISOString() },
  ];

  const filtered = activeState
    ? PLACEHOLDER_TASKS.filter(t => t.currentState === activeState)
    : PLACEHOLDER_TASKS;

  const STATES = ['queued', 'planning', 'awaiting_approval', 'completed'];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>AI WORKFORCE</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Task Centre</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Tasks managed by your AI workforce
          </Text>
        </View>

        {/* State filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          <TouchableOpacity
            onPress={() => setActiveState(null)}
            style={[
              styles.chip,
              { borderColor: colors.border, backgroundColor: activeState === null ? colors.primary + '22' : 'transparent' },
            ]}
          >
            <Text style={[styles.chipText, { color: activeState === null ? colors.primary : colors.mutedForeground }]}>
              All
            </Text>
          </TouchableOpacity>
          {STATES.map(s => (
            <TouchableOpacity
              key={s}
              onPress={() => setActiveState(activeState === s ? null : s)}
              style={[
                styles.chip,
                {
                  borderColor: activeState === s ? STATE_COLOUR[s] ?? colors.border : colors.border,
                  backgroundColor: activeState === s ? (STATE_COLOUR[s] ?? colors.primary) + '22' : 'transparent',
                },
              ]}
            >
              <Text style={[styles.chipText, { color: activeState === s ? STATE_COLOUR[s] ?? colors.primary : colors.mutedForeground }]}>
                {s.replace(/_/g, ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Task cards */}
        <View style={styles.taskList}>
          {filtered.map(task => (
            <View key={task.id} style={[styles.taskCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.taskRow}>
                <View style={[styles.stateDot, { backgroundColor: STATE_COLOUR[task.currentState] ?? colors.primary }]} />
                <View style={styles.taskInfo}>
                  <Text style={[styles.taskTitle, { color: colors.foreground }]}>{task.title}</Text>
                  <View style={styles.taskMeta}>
                    <Text style={[styles.taskState, { color: STATE_COLOUR[task.currentState] ?? colors.mutedForeground }]}>
                      {task.currentState.replace(/_/g, ' ')}
                    </Text>
                    <Text style={[styles.taskDot, { color: colors.mutedForeground }]}> · </Text>
                    <Text style={[styles.taskPriority, {
                      color: task.priority === 'urgent' ? '#F87171' : task.priority === 'high' ? '#FCD34D' : colors.mutedForeground
                    }]}>
                      {task.priority}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>

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
  chip: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
  },
  chipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  taskList: { gap: 10 },
  taskCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stateDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  taskInfo: { flex: 1 },
  taskTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  taskMeta: { flexDirection: 'row', alignItems: 'center' },
  taskState: { fontSize: 12, textTransform: 'capitalize' },
  taskDot: { fontSize: 12 },
  taskPriority: { fontSize: 12, textTransform: 'capitalize' },
});
