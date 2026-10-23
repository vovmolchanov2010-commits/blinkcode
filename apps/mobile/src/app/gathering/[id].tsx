import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { displayName } from '../../lib/format';
import {
  CHIP_LABEL,
  formatClock,
  formatWhen,
  isLate,
  participantStatus,
  sortParticipants,
  yandexRouteUrl,
} from '../../lib/meet';
import type { Chip, Gathering } from '../../lib/types';
import { api } from '../../services/client';
import { useMe } from '../../state/auth';
import { useGathering } from '../../state/gatherings';
import { useRealtime } from '../../state/realtime';
import { Avatar, Button, Card, Input, Muted, Pill, Row, SectionTitle } from '../../ui/components';
import { Circle, MapView, Marker } from '../../ui/map';
import { colors, radius, spacing } from '../../ui/theme';

const CHIPS: Chip[] = ['leaving', 'on_the_way', 'stuck', 'late', 'arrived'];
const ETA_PRESETS = [5, 15, 30];

export default function GatheringScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const { locations } = useRealtime();
  const { gathering, setGathering } = useGathering(id);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const commentLoaded = useRef(false);

  const mine = gathering && gathering !== 'missing' ? gathering.participants.find((p) => p.user.id === me?.id) : null;

  // Комментарий подставляем один раз — дальше поле принадлежит пользователю.
  useEffect(() => {
    if (mine && !commentLoaded.current) {
      commentLoaded.current = true;
      setComment(mine.comment ?? '');
    }
  }, [mine]);

  if (gathering === null) return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />;
  if (gathering === 'missing' || !mine) {
    return (
      <View style={styles.content}>
        <Muted>Сбор не найден.</Muted>
      </View>
    );
  }

  const g: Gathering = gathering;
  const isOwner = g.ownerId === me?.id;
  const open = g.status === 'active';
  const late = mine.etaSource === 'auto' && isLate(mine, g.startsAt) && mine.chip !== 'late';

  async function run(action: () => Promise<Gathering>) {
    setBusy(true);
    try {
      setGathering(await action());
    } catch {
      Alert.alert('Не получилось', 'Проверь интернет и попробуй ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (status: Parameters<typeof api.setGatheringStatus>[1]) =>
    run(() => api.setGatheringStatus(g.id, status));

  function moveBy(minutes: number) {
    const startsAt = new Date(Date.parse(g.startsAt) + minutes * 60_000).toISOString();
    void run(() => api.updateGathering(g.id, { startsAt }));
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: g.title }} />

      <View style={styles.mapBox}>
        <MapView
          style={StyleSheet.absoluteFill}
          initialRegion={{ latitude: g.lat, longitude: g.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
          showsUserLocation
        >
          <Circle
            center={{ latitude: g.lat, longitude: g.lng }}
            radius={100}
            strokeColor={colors.primary}
            fillColor="rgba(91,75,255,0.12)"
          />
          <Marker coordinate={{ latitude: g.lat, longitude: g.lng }} />
          {g.participants.map((p) => {
            const location = locations[p.user.id];
            if (!location || p.rsvp !== 'going') return null;
            return (
              <Marker key={p.user.id} coordinate={{ latitude: location.lat, longitude: location.lng }}>
                <Avatar user={p.user} size={32} dimmed={location.precision === 'approx'} />
              </Marker>
            );
          })}
        </MapView>
      </View>

      <Text style={styles.when}>{formatWhen(g.startsAt)}</Text>
      {g.placeName && <Muted>{g.placeName}</Muted>}
      {g.status === 'closed' && <Muted>Сбор закрыт организатором.</Muted>}
      {g.status === 'ended' && <Muted>Сбор закончился.</Muted>}

      {open && (
        <>
          <SectionTitle>Ты</SectionTitle>
          <Card style={{ gap: spacing.md }}>
            {mine.rsvp !== 'going' ? (
              <>
                <Muted>{mine.rsvp === 'declined' ? 'Ты ответил(а), что не сможешь.' : 'Пойдёшь?'}</Muted>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Button title="Иду" onPress={() => setStatus({ rsvp: 'going' })} loading={busy} />
                  </View>
                  {mine.rsvp === 'pending' && (
                    <View style={{ flex: 1 }}>
                      <Button title="Не смогу" variant="secondary" onPress={() => setStatus({ rsvp: 'declined' })} />
                    </View>
                  )}
                </Row>
              </>
            ) : (
              <>
                <Text style={styles.label}>{participantStatus(mine, g.startsAt)}</Text>
                {late && (
                  <Card style={styles.lateHint}>
                    <Text style={styles.label}>Похоже, опаздываешь. Сообщить?</Text>
                    <Button
                      title={`Опоздаю, буду в ${formatClock(mine.etaAt!)}`}
                      small
                      onPress={() =>
                        setStatus({
                          chip: 'late',
                          etaMinutes: Math.max(0, Math.round((Date.parse(mine.etaAt!) - Date.now()) / 60_000)),
                        })
                      }
                    />
                  </Card>
                )}
                <View style={styles.wrap}>
                  {CHIPS.map((chip) => (
                    <Pill
                      key={chip}
                      label={CHIP_LABEL[chip]}
                      selected={mine.chip === chip}
                      disabled={busy}
                      onPress={() => setStatus({ chip: mine.chip === chip ? null : chip })}
                    />
                  ))}
                </View>
                <Muted>Буду через:</Muted>
                <View style={styles.wrap}>
                  {ETA_PRESETS.map((minutes) => (
                    <Pill key={minutes} label={`${minutes} мин`} disabled={busy} onPress={() => setStatus({ etaMinutes: minutes })} />
                  ))}
                </View>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Input value={comment} onChangeText={setComment} placeholder="Комментарий" maxLength={140} />
                  </View>
                  <Button
                    title="ОК"
                    small
                    disabled={busy || comment.trim() === (mine.comment ?? '')}
                    onPress={() => setStatus({ comment: comment.trim() || null })}
                  />
                </Row>
                <Muted>
                  Пока ты делишься геолокацией, время прибытия считается само, а «На месте» ставится в 100 м от точки.
                </Muted>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Маршрут"
                      variant="secondary"
                      small
                      onPress={() => void Linking.openURL(yandexRouteUrl(null, g, 'walk'))}
                    />
                  </View>
                  {!isOwner && (
                    <View style={{ flex: 1 }}>
                      <Button title="Не смогу" variant="secondary" small onPress={() => setStatus({ rsvp: 'declined' })} />
                    </View>
                  )}
                </Row>
              </>
            )}
          </Card>
        </>
      )}

      <SectionTitle>Участники</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        {sortParticipants(g.participants).map((p) => (
          <Row key={p.user.id}>
            <Avatar user={p.user} size={36} dimmed={p.rsvp === 'declined'} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {displayName(p.user)}
                {p.user.id === g.ownerId ? ' · организатор' : ''}
              </Text>
              <Muted style={isLate(p, g.startsAt) ? { color: colors.danger } : undefined}>
                {participantStatus(p, g.startsAt)}
              </Muted>
              {p.comment && <Text style={styles.comment}>«{p.comment}»</Text>}
            </View>
          </Row>
        ))}
      </Card>

      {isOwner && open && (
        <>
          <SectionTitle>Организатору</SectionTitle>
          <Card style={{ gap: spacing.md }}>
            <Muted>Перенести — все получат уведомление со старым и новым временем.</Muted>
            <Row>
              <View style={{ flex: 1 }}>
                <Button title="+15 мин" variant="secondary" small onPress={() => moveBy(15)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="+30 мин" variant="secondary" small onPress={() => moveBy(30)} />
              </View>
            </Row>
            <Button
              title="Закрыть сбор"
              variant="danger"
              onPress={() =>
                Alert.alert('Закрыть сбор?', 'Участники больше не смогут менять статусы.', [
                  { text: 'Отмена', style: 'cancel' },
                  {
                    text: 'Закрыть',
                    style: 'destructive',
                    onPress: () => void run(() => api.closeGathering(g.id)).then(() => router.back()),
                  },
                ])
              }
            />
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  mapBox: { height: 240, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.md },
  when: { fontSize: 20, fontWeight: '700', color: colors.text },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  comment: { fontSize: 14, color: colors.text, marginTop: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  lateHint: { backgroundColor: '#FFF4E5', borderColor: '#FFD8A8', gap: spacing.sm },
});
