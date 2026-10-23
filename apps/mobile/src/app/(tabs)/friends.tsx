import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { displayName, timeAgo } from '../../lib/format';
import type { Precision, PublicProfile } from '../../lib/types';
import { api } from '../../services/client';
import { useMe } from '../../state/auth';
import { useFriends } from '../../state/friends';
import { useRealtime } from '../../state/realtime';
import { Avatar, Button, Card, ErrorText, Input, Muted, Row, SectionTitle } from '../../ui/components';
import { colors, spacing } from '../../ui/theme';

const PRECISION_LABEL: Record<Precision, string> = {
  exact: 'видит точно',
  approx: 'видит примерно',
  hidden: 'не видит',
};

export default function FriendsScreen() {
  const me = useMe();
  const { friends, requests, loading, error, reload } = useFriends();
  const { locations } = useRealtime();
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
      keyboardShouldPersistTaps="handled"
    >
      <AddFriend onAdded={reload} />
      {me?.username && <Muted style={{ marginTop: spacing.sm }}>Твой ник: @{me.username}</Muted>}
      {error && <ErrorText>{error}</ErrorText>}

      {requests.incoming.length > 0 && (
        <>
          <SectionTitle>Заявки в друзья</SectionTitle>
          <Card style={styles.list}>
            {requests.incoming.map((user) => (
              <RequestRow key={user.id} user={user} onDone={reload} incoming />
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Друзья{friends.length ? ` · ${friends.length}` : ''}</SectionTitle>
      <Card style={styles.list}>
        {!loading && friends.length === 0 && <Muted>Пока никого. Найди друзей по нику.</Muted>}
        {friends.map((friend) => {
          const location = locations[friend.id];
          return (
            <Pressable key={friend.id} onPress={() => router.push(`/friend/${friend.id}`)}>
              <Row style={styles.item}>
                <Avatar user={friend} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {displayName(friend)}
                    {friend.isClose ? ' ⭐' : ''}
                  </Text>
                  <Muted>
                    {location ? `на карте · ${timeAgo(location.ts)}` : 'не на карте'} · тебя{' '}
                    {PRECISION_LABEL[friend.sharing.precision]}
                  </Muted>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Row>
            </Pressable>
          );
        })}
      </Card>

      {requests.outgoing.length > 0 && (
        <>
          <SectionTitle>Отправленные заявки</SectionTitle>
          <Card style={styles.list}>
            {requests.outgoing.map((user) => (
              <RequestRow key={user.id} user={user} onDone={reload} />
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function AddFriend({ onAdded }: { onAdded: () => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<PublicProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    const username = query.trim().replace(/^@/, '').toLowerCase();
    if (!username) return;
    setBusy(true);
    setFound(null);
    setMessage(null);
    try {
      setFound(await api.findByUsername(username));
    } catch (err) {
      setMessage(err instanceof ApiError && err.status === 404 ? 'Никого не нашли.' : 'Не удалось выполнить поиск.');
    } finally {
      setBusy(false);
    }
  }

  async function add(user: PublicProfile) {
    setBusy(true);
    try {
      const { status } = await api.sendFriendRequest(user.id);
      setMessage(status === 'accepted' ? `${displayName(user)} теперь в друзьях!` : 'Заявка отправлена.');
      setFound(null);
      setQuery('');
      await onAdded();
    } catch (err) {
      setMessage(
        err instanceof ApiError && err.code === 'already_friends' ? 'Вы уже друзья.' : 'Не удалось отправить заявку.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Row>
        <View style={{ flex: 1 }}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Ник друга"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={search}
          />
        </View>
        <Button title="Найти" onPress={search} loading={busy && !found} small />
      </Row>
      {found && (
        <Card>
          <Row>
            <Avatar user={found} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{displayName(found)}</Text>
              {found.username && <Muted>@{found.username}</Muted>}
            </View>
            <Button title="Добавить" onPress={() => add(found)} loading={busy} small />
          </Row>
        </Card>
      )}
      {message && <Muted>{message}</Muted>}
    </View>
  );
}

function RequestRow({
  user,
  incoming = false,
  onDone,
}: {
  user: PublicProfile;
  incoming?: boolean;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row style={styles.item}>
      <Avatar user={user} />
      <Text style={[styles.name, { flex: 1 }]}>{displayName(user)}</Text>
      {incoming && (
        <Button title="Принять" small disabled={busy} onPress={() => run(() => api.acceptFriendRequest(user.id))} />
      )}
      <Button
        title={incoming ? 'Нет' : 'Отменить'}
        variant="secondary"
        small
        disabled={busy}
        onPress={() => run(() => api.deleteFriendRequest(user.id))}
      />
    </Row>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  list: { paddingVertical: spacing.sm, gap: spacing.xs },
  item: { paddingVertical: spacing.sm },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  chevron: { fontSize: 24, color: colors.textMuted },
});
