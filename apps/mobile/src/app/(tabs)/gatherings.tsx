import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatWhen, participantStatus, summary } from '../../lib/meet';
import { useMe } from '../../state/auth';
import { useGatherings } from '../../state/gatherings';
import { Button, Card, ErrorText, Muted } from '../../ui/components';
import { colors, spacing } from '../../ui/theme';

export default function GatheringsScreen() {
  const me = useMe();
  const { gatherings, loading, error, reload } = useGatherings();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Button title="Собрать друзей" onPress={() => router.push('/gathering/new')} />
      {error && <ErrorText>{error}</ErrorText>}

      {!loading && gatherings.length === 0 && (
        <Card style={{ marginTop: spacing.lg }}>
          <Muted>
            Поставь точку и время — друзья ответят «иду» и будут видеть, кто где и через сколько будет.
          </Muted>
        </Card>
      )}

      {gatherings.map((gathering) => {
        const counts = summary(gathering);
        const mine = gathering.participants.find((p) => p.user.id === me?.id);
        return (
          <Pressable key={gathering.id} onPress={() => router.push(`/gathering/${gathering.id}`)}>
            <Card style={styles.card}>
              <Text style={styles.title}>{gathering.title}</Text>
              <Muted>
                {formatWhen(gathering.startsAt)}
                {gathering.placeName ? ` · ${gathering.placeName}` : ''}
              </Muted>
              <View style={styles.counts}>
                <Text style={styles.count}>✅ {counts.arrived} на месте</Text>
                <Text style={styles.count}>🚶 {counts.going} в пути</Text>
                {counts.pending > 0 && <Text style={styles.count}>⏳ {counts.pending} не ответили</Text>}
              </View>
              {mine && <Muted>Ты: {participantStatus(mine, gathering.startsAt)}</Muted>}
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  card: { marginTop: spacing.lg, gap: spacing.xs },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginVertical: spacing.xs },
  count: { fontSize: 14, color: colors.text },
});
