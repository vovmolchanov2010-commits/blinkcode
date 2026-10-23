import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { displayName, timeAgo } from '../../lib/format';
import { PLACE_LABEL } from '../../lib/meet';
import type { Precision } from '../../lib/types';
import { api } from '../../services/client';
import { useFriends } from '../../state/friends';
import { useRealtime } from '../../state/realtime';
import { Avatar, Button, Card, Muted, Row, SectionTitle, Segmented } from '../../ui/components';
import { colors, spacing } from '../../ui/theme';

const PRECISION_HINT: Record<Precision, string> = {
  exact: 'Видит, где ты, с точностью до улицы.',
  approx: 'Видит только район (~1,5 км), без скорости и направления.',
  hidden: 'Не видит тебя на карте.',
};

export default function FriendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { friends, loading, reload } = useFriends();
  const { locations } = useRealtime();
  const [saving, setSaving] = useState(false);

  const friend = friends.find((f) => f.id === id);
  if (loading) return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />;
  if (!friend) {
    return (
      <View style={styles.content}>
        <Muted>Этого человека нет в друзьях.</Muted>
      </View>
    );
  }
  const location = locations[friend.id];

  async function update(patch: { precision?: Precision; isClose?: boolean }) {
    setSaving(true);
    try {
      await api.updateFriend(friend!.id, patch);
      await reload();
    } catch {
      Alert.alert('Не получилось', 'Проверь интернет и попробуй ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  function confirm(title: string, message: string, action: () => Promise<void>) {
    Alert.alert(title, message, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Да',
        style: 'destructive',
        onPress: () =>
          void action()
            .then(() => router.back())
            .catch(() => Alert.alert('Не получилось', 'Попробуй ещё раз.')),
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: displayName(friend) }} />
      <Row>
        <Avatar user={friend} size={56} />
        <View>
          <Text style={styles.name}>{displayName(friend)}</Text>
          {friend.username && <Muted>@{friend.username}</Muted>}
          <Muted>{location ? `На карте · ${timeAgo(location.ts)}` : 'Не на карте'}</Muted>
          {location?.place && <Muted>{PLACE_LABEL[location.place]}</Muted>}
        </View>
      </Row>

      {location && (
        <View style={{ marginTop: spacing.lg }}>
          <Button title={`Дойти до ${displayName(friend)}`} onPress={() => router.push(`/route/${friend.id}`)} />
        </View>
      )}

      <SectionTitle>Как {displayName(friend)} видит тебя</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Segmented<Precision>
          options={[
            { value: 'exact', label: 'Точно' },
            { value: 'approx', label: 'Примерно' },
            { value: 'hidden', label: 'Скрыто' },
          ]}
          value={friend.sharing.precision}
          onChange={(precision) => update({ precision })}
        />
        <Muted>{PRECISION_HINT[friend.sharing.precision]}</Muted>
      </Card>

      <SectionTitle>Близкий друг</SectionTitle>
      <Card>
        <Row>
          <Muted style={{ flex: 1 }}>
            Близкие друзья видят статус «дома» / «на работе» (если так настроено в «Дом и работа»).
          </Muted>
          <Switch value={friend.isClose} onValueChange={(isClose) => update({ isClose })} disabled={saving} />
        </Row>
      </Card>

      <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
        <Button
          title="Удалить из друзей"
          variant="secondary"
          onPress={() =>
            confirm('Удалить из друзей?', 'Вы перестанете видеть друг друга на карте.', () =>
              api.removeFriend(friend.id),
            )
          }
        />
        <Button
          title="Заблокировать"
          variant="danger"
          onPress={() =>
            confirm(
              'Заблокировать?',
              `${displayName(friend)} не сможет найти тебя и отправить заявку.`,
              () => api.block(friend.id),
            )
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
});
