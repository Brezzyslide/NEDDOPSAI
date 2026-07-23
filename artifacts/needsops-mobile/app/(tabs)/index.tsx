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
import { useGetDashboardSummary, useGetSystemStatus } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { MetricCard } from '@/components/MetricCard';
import { StatusBadge } from '@/components/StatusBadge';
import { SectionHeader } from '@/components/SectionHeader';

export default function CommandCentreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
    isRefetching: summaryRefetching,
  } = useGetDashboardSummary();

  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
    isRefetching: statusRefetching,
  } = useGetSystemStatus();

  const isRefreshing = summaryRefetching || statusRefetching;

  const handleRefresh = () => {
    refetchSummary();
    refetchStatus();
  };

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
        <Text style={[styles.headerEyebrow, { color: colors.primary }]}>
          AI COMMAND CENTRE
        </Text>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          NeedsOps AI+
        </Text>
        <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
          Sprint 0 · Foundation
        </Text>
      </View>

      {/* Overall status pill */}
      {status ? (
        <View style={[styles.statusPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <StatusBadge
            status={status.overall as 'operational' | 'degraded' | 'outage'}
          />
          <Text style={[styles.statusPillText, { color: colors.mutedForeground }]}>
            Platform {status.overall}
          </Text>
        </View>
      ) : null}

      {/* Metrics */}
      <SectionHeader title="Platform Metrics" subtitle="Live from API" />
      {summaryLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
      ) : summary ? (
        <>
          <View style={styles.metricsRow}>
            <MetricCard
              label="Organizations"
              value={summary.totalOrganizations}
              subtitle={`${summary.activeOrganizations} active`}
              accent
            />
            <MetricCard
              label="Users"
              value={summary.totalUsers}
              subtitle="across all orgs"
            />
          </View>
          <View style={styles.metricsRow}>
            <MetricCard
              label="Workforce Packs"
              value={summary.workforcePacksAvailable}
              subtitle="available"
              accent
            />
            <MetricCard
              label="Platform"
              value={`v${summary.platformVersion}`}
              subtitle="Sprint 0"
            />
          </View>
        </>
      ) : null}

      {/* Service health */}
      <View style={styles.sectionSpacer} />
      <SectionHeader title="Service Health" />
      {statusLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
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
              <Text style={[styles.serviceName, { color: colors.foreground }]}>{svc.name}</Text>
              <View style={styles.serviceRight}>
                {svc.latencyMs != null ? (
                  <Text style={[styles.latency, { color: colors.mutedForeground }]}>
                    {svc.latencyMs}ms
                  </Text>
                ) : null}
                <StatusBadge status={svc.status as 'operational' | 'degraded' | 'outage'} />
              </View>
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
  header: { marginBottom: 24 },
  headerEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 24,
  },
  statusPillText: { fontSize: 13, fontWeight: '500' },
  metricsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  sectionSpacer: { height: 12 },
  servicesCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  serviceName: { fontSize: 14, fontWeight: '500' },
  serviceRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  latency: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});
