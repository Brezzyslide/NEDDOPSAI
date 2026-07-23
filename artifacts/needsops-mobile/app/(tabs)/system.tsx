import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetSystemStatus, useHealthCheck, useGetDashboardSummary } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { StatusBadge } from '@/components/StatusBadge';
import { SectionHeader } from '@/components/SectionHeader';

export default function SystemScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data: status, isLoading: statusLoading, refetch: refetchStatus, isRefetching: statusRefetching } = useGetSystemStatus();
  const { data: health, isLoading: healthLoading, refetch: refetchHealth, isRefetching: healthRefetching } = useHealthCheck();
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary, isRefetching: summaryRefetching } = useGetDashboardSummary();

  const isRefreshing = statusRefetching || healthRefetching || summaryRefetching;

  const handleRefresh = () => {
    refetchStatus();
    refetchHealth();
    refetchSummary();
  };

  const overallColor =
    status?.overall === 'operational'
      ? '#10b981'
      : status?.overall === 'degraded'
      ? '#f59e0b'
      : '#ef4444';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>SYSTEM TELEMETRY</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>System Status</Text>
      </View>

      {/* Overall status banner */}
      {statusLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginBottom: 24 }} />
      ) : status ? (
        <View
          style={[
            styles.overallBanner,
            { backgroundColor: overallColor + '15', borderColor: overallColor + '40' },
          ]}
        >
          <View style={[styles.overallDot, { backgroundColor: overallColor }]} />
          <View>
            <Text style={[styles.overallLabel, { color: colors.mutedForeground }]}>
              Overall Platform Status
            </Text>
            <Text style={[styles.overallValue, { color: overallColor }]}>
              {status.overall.charAt(0).toUpperCase() + status.overall.slice(1)}
            </Text>
          </View>
          <Text style={[styles.overallTime, { color: colors.mutedForeground }]}>
            {new Date(status.updatedAt).toLocaleTimeString()}
          </Text>
        </View>
      ) : null}

      {/* Health check */}
      <SectionHeader title="API Health" />
      <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>API Server</Text>
          {healthLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <StatusBadge status={health ? 'operational' : 'outage'} />
          )}
        </View>
        {health ? (
          <View style={[styles.infoRow, { borderTopColor: colors.border, borderTopWidth: 1, marginTop: 0 }]}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Response</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>{health.status}</Text>
          </View>
        ) : null}
      </View>

      {/* Services */}
      <View style={styles.sectionSpacer} />
      <SectionHeader title="Services" />
      {statusLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : status ? (
        <View style={[styles.servicesCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {status.services.map((svc, i) => (
            <View
              key={svc.name}
              style={[
                styles.serviceRow,
                i < status.services.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 },
              ]}
            >
              <View>
                <Text style={[styles.serviceName, { color: colors.foreground }]}>{svc.name}</Text>
                {svc.latencyMs != null ? (
                  <Text style={[styles.latency, { color: colors.mutedForeground }]}>
                    {svc.latencyMs}ms response
                  </Text>
                ) : null}
              </View>
              <StatusBadge status={svc.status as 'operational' | 'degraded' | 'outage'} />
            </View>
          ))}
        </View>
      ) : null}

      {/* Platform info */}
      <View style={styles.sectionSpacer} />
      <SectionHeader title="Platform Info" />
      {summaryLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : summary ? (
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { label: 'Version', value: `v${summary.platformVersion}` },
            { label: 'Sprint', value: 'Sprint 0 — Foundation' },
            { label: 'Last Updated', value: new Date(summary.lastUpdated).toLocaleString() },
          ].map((row, i, arr) => (
            <View
              key={row.label}
              style={[
                styles.infoRow,
                i < arr.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 },
              ]}
            >
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 0 },
  header: { marginBottom: 20 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
  overallBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  overallDot: { width: 10, height: 10, borderRadius: 5 },
  overallLabel: { fontSize: 11, fontWeight: '500', letterSpacing: 0.3 },
  overallValue: { fontSize: 18, fontWeight: '700', marginTop: 2 },
  overallTime: { marginLeft: 'auto', fontSize: 11 },
  sectionSpacer: { height: 12 },
  infoCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: '500' },
  servicesCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  serviceName: { fontSize: 14, fontWeight: '600' },
  latency: { fontSize: 11, marginTop: 2 },
});
