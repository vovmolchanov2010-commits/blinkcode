import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { displayName } from '../../lib/format';
import { defaultStartTime, formatWhen } from '../../lib/meet';
import { api } from '../../services/client';
import { useFriends } from '../../state/friends';
import { Avatar, Button, Card, Input, Muted, Pill, Row, SectionTitle } from '../../ui/components';
import { MapView, type MapViewRef, type Region } from '../../ui/map';
import { colors, radius, spacing } from '../../ui/theme';

const MOSCOW: Region = { latitude: 55.7558, longitude: 37.6173, latitudeDelta: 0.02, longitudeDelta: 0.02 };
const MINUTE = 60_000;

/** Сбор за три шага: точка, время, кого звать. */
export default function NewGatheringScreen() {
  const { friends } = useFriends();
  const mapRef = useRef<MapViewRef>(null);
  const [title, setTitle] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [center, setCenter] = useState({ lat: MOSCOW.latitude, lng: MOSCOW.longitude });
  const [startsAt, setStartsAt] = useState(() => defaultStartTime());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void goToMyLocation();
  }, []);

  async function goToMyLocation() {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return;
    const location =
      (await Location.getLastKnownPositionAsync()) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
    if (!location) return;
    const { latitude, longitude } = location.coords;
    setCenter({ lat: latitude, lng: longitude });
    mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
  }

  function shiftTime(deltaMs: number) {
    const next = new Date(startsAt.getTime() + deltaMs);
    if (next.getTime() > Date.now()) setStartsAt(next);
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function create() {
    setSaving(true);
    try {
      const gathering = await api.createGathering({
        title: title.trim() || 'Встреча',
        lat: center.lat,
        lng: center.lng,
        placeName: placeName.trim() || undefined,
        startsAt: startsAt.toISOString(),
        participantIds: [...selected],
      });
      router.replace(`/gathering/${gathering.id}`);
    } catch {
      Alert.alert('Не получилось', 'Проверь интернет и попробуй ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Input value={title} onChangeText={setTitle} placeholder="Куда идём? Например, «Бар на Покровке»" maxLength={80} />

      <SectionTitle>Где</SectionTitle>
      <View style={styles.mapBox}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={MOSCOW}
          showsUserLocation
          onRegionChangeComplete={(center) => setCenter({ lat: center.latitude, lng: center.longitude })}
        />
        {/* Точка сбора — центр карты: двигай карту, а не булавку. */}
        <View pointerEvents="none" style={styles.pinWrap}>
          <Text style={styles.pin}>📍</Text>
        </View>
      </View>
      <Row style={{ marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Input value={placeName} onChangeText={setPlaceName} placeholder="Название места (необязательно)" maxLength={120} />
        </View>
        <Button title="Я здесь" variant="secondary" small onPress={goToMyLocation} />
      </Row>

      <SectionTitle>Когда</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Text style={styles.when}>{formatWhen(startsAt.toISOString())}</Text>
        <Row style={{ flexWrap: 'wrap', gap: spacing.sm }}>
          <Pill label="−15 мин" onPress={() => shiftTime(-15 * MINUTE)} />
          <Pill label="+15 мин" onPress={() => shiftTime(15 * MINUTE)} />
          <Pill label="+1 ч" onPress={() => shiftTime(60 * MINUTE)} />
          <Pill label="Через 30 мин" onPress={() => setStartsAt(defaultStartTime())} />
        </Row>
      </Card>

      <SectionTitle>Кого зовём{selected.size ? ` · ${selected.size}` : ''}</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        {friends.length === 0 && <Muted>Сначала добавь друзей во вкладке «Друзья».</Muted>}
        {friends.map((friend) => (
          <Row key={friend.id}>
            <Avatar user={friend} size={36} />
            <Text style={styles.name}>{displayName(friend)}</Text>
            <Pill label={selected.has(friend.id) ? 'Зовём ✓' : 'Позвать'} selected={selected.has(friend.id)} onPress={() => toggle(friend.id)} />
          </Row>
        ))}
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button title="Собрать" onPress={create} loading={saving} disabled={selected.size === 0} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  mapBox: { height: 220, borderRadius: radius.md, overflow: 'hidden' },
  pinWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  // Остриё булавки — в центре карты.
  pin: { fontSize: 36, marginBottom: 36 },
  when: { fontSize: 20, fontWeight: '700', color: colors.text },
  name: { flex: 1, fontSize: 16, color: colors.text },
});
