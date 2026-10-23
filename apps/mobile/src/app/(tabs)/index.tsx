import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { displayName, distanceMeters, formatDistance, timeAgo } from '../../lib/format';
import { formatDuration, PLACE_LABEL } from '../../lib/meet';
import type { Friend, VisibleLocation } from '../../lib/types';
import { api } from '../../services/client';
import {
  getLocationPermission,
  isSharingDisabledByUser,
  type LocationPermission,
  requestLocationPermission,
  sendCurrentLocation,
  startSharingLocation,
} from '../../services/location';
import { useMe } from '../../state/auth';
import { useFriends } from '../../state/friends';
import { useGatherings } from '../../state/gatherings';
import { useRealtime } from '../../state/realtime';
import { useRoutes } from '../../state/routes';
import { Avatar, Button, Card, Muted, Row } from '../../ui/components';
import { colors, radius, spacing } from '../../ui/theme';

const MOSCOW: Region = { latitude: 55.7558, longitude: 37.6173, latitudeDelta: 0.15, longitudeDelta: 0.15 };

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const { friends } = useFriends();
  const { locations, status } = useRealtime();
  const { routes, reload: reloadRoutes } = useRoutes();
  const { gatherings } = useGatherings();
  const mapRef = useRef<MapView>(null);
  const [permission, setPermission] = useState<LocationPermission | null>(null);
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // При открытии: проверяем разрешения, отправляем свежую позицию и включаем фоновые обновления.
  useEffect(() => {
    void (async () => {
      const current = await getLocationPermission();
      setPermission(current);
      if (current !== 'denied') await startTracking();
    })();
  }, []);

  async function startTracking() {
    const location = await sendCurrentLocation().catch(() => null);
    if (location) {
      const position = { lat: location.coords.latitude, lng: location.coords.longitude };
      setMyPosition(position);
      mapRef.current?.animateToRegion({
        latitude: position.lat,
        longitude: position.lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    }
    if (!(await isSharingDisabledByUser())) await startSharingLocation().catch(() => {});
  }

  async function askPermission() {
    const result = await requestLocationPermission();
    setPermission(result);
    if (result !== 'denied') await startTracking();
  }

  // Профили друзей приходят из API, позиции — из real-time канала.
  const visibleFriends = useMemo(
    () =>
      friends
        .map((friend) => ({ friend, location: locations[friend.id] ?? null }))
        .filter((item): item is { friend: Friend; location: VisibleLocation } => item.location !== null),
    [friends, locations],
  );
  const selected = visibleFriends.find((item) => item.friend.id === selectedId) ?? null;
  const ghost = me?.ghostUntil ? new Date(me.ghostUntil) > new Date() : false;
  const incoming = routes.filter((r) => r.target.id === me?.id);
  const outgoing = routes.find((r) => r.requester.id === me?.id) ?? null;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={MOSCOW}
        showsUserLocation={permission !== null && permission !== 'denied'}
        showsMyLocationButton
        onPress={() => setSelectedId(null)}
      >
        {visibleFriends.map(({ friend, location }) => (
          <Marker
            key={friend.id}
            coordinate={{ latitude: location.lat, longitude: location.lng }}
            onPress={(event) => {
              event.stopPropagation();
              setSelectedId(friend.id);
            }}
            tracksViewChanges={false}
          >
            <View style={[styles.marker, location.precision === 'approx' && styles.markerApprox]}>
              <Avatar user={friend} size={40} dimmed={location.precision === 'approx'} />
              {location.place && <Text style={styles.placeBadge}>{location.place === 'home' ? '🏠' : '💼'}</Text>}
            </View>
          </Marker>
        ))}
        {gatherings.map((gathering) => (
          <Marker
            key={gathering.id}
            coordinate={{ latitude: gathering.lat, longitude: gathering.lng }}
            onPress={(event) => {
              event.stopPropagation();
              router.push(`/gathering/${gathering.id}`);
            }}
            tracksViewChanges={false}
          >
            <Text style={styles.gatheringPin}>🎉</Text>
          </Marker>
        ))}
      </MapView>

      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        {status !== 'open' && (
          <View style={styles.pill}>
            <Text style={styles.pillText}>{status === 'connecting' ? 'Подключаемся…' : 'Нет связи'}</Text>
          </View>
        )}
        {ghost && (
          <View style={[styles.pill, { backgroundColor: colors.ghost }]}>
            <Text style={[styles.pillText, { color: colors.primaryText }]}>👻 Режим «призрак»</Text>
          </View>
        )}
        {permission === 'denied' && (
          <Card style={styles.banner}>
            <Text style={styles.bannerTitle}>Включи геолокацию</Text>
            <Muted>Иначе друзья не увидят тебя на карте. Точность для каждого друга можно настроить.</Muted>
            <View style={{ marginTop: spacing.md }}>
              <Button title="Разрешить" onPress={askPermission} small />
            </View>
          </Card>
        )}
        {permission === 'foreground' && (
          <Card style={styles.banner}>
            <Muted>
              Друзья видят тебя, только пока приложение открыто. Разреши доступ к геолокации «Всегда» в
              настройках телефона.
            </Muted>
          </Card>
        )}
        {incoming.map((route) => (
          <Card key={route.id} style={styles.banner}>
            <Row>
              <Avatar user={route.requester} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>{displayName(route.requester)} идёт к тебе</Text>
                <Muted>
                  {route.etaAt
                    ? `будет через ${formatDuration((Date.parse(route.etaAt) - Date.now()) / 1000)}`
                    : 'считаем время…'}
                </Muted>
              </View>
              <Button
                title="Стоп"
                variant="secondary"
                small
                onPress={() => void api.stopRoute(route.id, 'stopped').then(reloadRoutes, () => {})}
              />
            </Row>
          </Card>
        ))}
        {outgoing && (
          <Pressable style={styles.banner} onPress={() => router.push(`/route/${outgoing.target.id}`)}>
            <Card>
              <Muted>Ты идёшь к {displayName(outgoing.target)} · открыть маршрут</Muted>
            </Card>
          </Pressable>
        )}
        {!ghost && permission !== 'denied' && visibleFriends.length === 0 && friends.length === 0 && (
          <Card style={styles.banner}>
            <Muted>Добавь друзей во вкладке «Друзья», чтобы видеть их на карте.</Muted>
          </Card>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="SOS"
        onPress={() => router.push('/sos')}
        style={[styles.sos, { top: insets.top + spacing.sm }]}
      >
        <Text style={styles.sosText}>SOS</Text>
      </Pressable>

      {selected && (
        <Card style={[styles.sheet, { marginBottom: spacing.lg }]}>
          <Row>
            <Avatar user={selected.friend} size={48} dimmed={selected.location.precision === 'approx'} />
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetName}>{displayName(selected.friend)}</Text>
              <Muted>
                {timeAgo(selected.location.ts)}
                {myPosition ? ` · ${formatDistance(distanceMeters(myPosition, selected.location))}` : ''}
                {selected.location.battery !== undefined ? ` · 🔋 ${selected.location.battery}%` : ''}
              </Muted>
              {selected.location.place ? (
                <Muted>{PLACE_LABEL[selected.location.place]}</Muted>
              ) : (
                selected.location.precision === 'approx' && <Muted>Делится примерной геолокацией</Muted>
              )}
            </View>
          </Row>
          <Row style={{ marginTop: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button title="Дойти" small onPress={() => router.push(`/route/${selected.friend.id}`)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Настройки"
                variant="secondary"
                small
                onPress={() => router.push(`/friend/${selected.friend.id}`)}
              />
            </View>
          </Row>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Справа — место под кнопку SOS.
  top: { position: 'absolute', left: spacing.lg, right: spacing.lg + 52 + spacing.sm, top: 0, gap: spacing.sm, alignItems: 'center' },
  pill: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.round,
  },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.text },
  banner: { alignSelf: 'stretch' },
  bannerTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  marker: { padding: 2, borderRadius: radius.round, backgroundColor: colors.surface },
  markerApprox: { opacity: 0.85 },
  sheet: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 0 },
  sheetName: { fontSize: 18, fontWeight: '600', color: colors.text },
  placeBadge: { position: 'absolute', right: -6, bottom: -6, fontSize: 16 },
  gatheringPin: { fontSize: 30 },
  sos: {
    position: 'absolute',
    right: spacing.lg,
    width: 52,
    height: 52,
    borderRadius: radius.round,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosText: { color: colors.primaryText, fontWeight: '800', fontSize: 15 },
});
