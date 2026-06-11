import React, { useState } from 'react'
import {
  View, Text, FlatList, StyleSheet, Pressable,
  RefreshControl, ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../src/api/client'
import { AlertItem } from '../../src/components/AlertItem'
import { colors, spacing, radius } from '../../src/theme'
import type { Alert } from '../../src/api/types'

type Filter = 'open' | 'all'

export default function AlertsScreen() {
  const [filter, setFilter] = useState<Filter>('open')
  const qc = useQueryClient()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['alerts', filter],
    queryFn: () => api<{ alerts: Alert[] }>(`/v1/alerts?status=${filter}`),
  })

  const ackMutation = useMutation({
    mutationFn: (id: string) => api(`/v1/alerts/${id}/ack`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const alerts = data?.alerts ?? []

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Filter tabs */}
      <View style={styles.filters}>
        {(['open', 'all'] as Filter[]).map(f => (
          <Pressable key={f} style={[styles.filterBtn, filter === f && styles.filterActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'open' ? 'Open' : 'All'}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={alerts}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.accent} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <AlertItem
            alert={item}
            onPress={() => router.push(`/sites/${item.site_id}` as never)}
            onAck={item.resolved_at ? undefined : () => ackMutation.mutate(item.id)}
          />
        )}
        ListEmptyComponent={
          isLoading
            ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
            : <Text style={styles.empty}>
                {filter === 'open' ? 'No open alerts — all clear!' : 'No alerts yet.'}
              </Text>
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  filters: { flexDirection: 'row', padding: spacing.md, gap: spacing.sm },
  filterBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  filterActive: { backgroundColor: colors.accent },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  filterTextActive: { color: colors.text },
  list: { paddingTop: spacing.xs, paddingBottom: spacing.xl },
  empty: { textAlign: 'center', color: colors.muted, marginTop: spacing.xl, padding: spacing.md },
})
