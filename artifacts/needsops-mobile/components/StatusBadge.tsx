import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

type StatusVariant =
  | 'active'
  | 'inactive'
  | 'trial'
  | 'suspended'
  | 'operational'
  | 'degraded'
  | 'outage'
  | 'available'
  | 'coming_soon'
  | 'invited'
  // Specialist display states
  | 'dna_pending'
  | 'archived'
  | 'deprecated'
  | 'unavailable_for_plan';

interface StatusBadgeProps {
  status: StatusVariant;
  label?: string;
}

const STATUS_CONFIG: Record<StatusVariant, { label: string; color: string; dot?: boolean }> = {
  active: { label: 'Active', color: '#10b981', dot: true },
  inactive: { label: 'Inactive', color: '#6b7896' },
  trial: { label: 'Trial', color: '#f59e0b' },
  suspended: { label: 'Suspended', color: '#ef4444' },
  operational: { label: 'Operational', color: '#10b981', dot: true },
  degraded: { label: 'Degraded', color: '#f59e0b', dot: true },
  outage: { label: 'Outage', color: '#ef4444', dot: true },
  available: { label: 'Available', color: '#10b981' },
  coming_soon: { label: 'Coming Soon', color: '#f59e0b' },
  invited: { label: 'Invited', color: '#3b82f6' },
  // Specialist display states
  dna_pending: { label: 'In Development', color: '#3b82f6' },
  archived: { label: 'Archived', color: '#6b7896' },
  deprecated: { label: 'Deprecated', color: '#ef4444' },
  unavailable_for_plan: { label: 'Not in your plan', color: '#4A5568' },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const colors = useColors();
  const config = STATUS_CONFIG[status] ?? { label: status, color: colors.mutedForeground };
  const displayLabel = label ?? config.label;

  return (
    <View style={[styles.badge, { backgroundColor: config.color + '20', borderColor: config.color + '40' }]}>
      {config.dot ? (
        <View style={[styles.dot, { backgroundColor: config.color }]} />
      ) : null}
      <Text style={[styles.label, { color: config.color }]}>{displayLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
