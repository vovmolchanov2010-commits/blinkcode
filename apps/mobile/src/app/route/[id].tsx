import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, Vibration, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { displayName, distanceMeters, formatDistance, timeAgo } from '../../lib/format';
import { estimateEtaSec, formatDuration, MEET_RADIUS_M, ROUTE_ETA_INTERVAL_MS, yandexRouteUrl } from '../../lib/meet';
import type { RouteMode, RouteSession } from '../../lib/types';
import { api } from '../../services/client';
import { watchLocation } from '../../services/location';
import { useFriends } from '../../state/friends';
import { useRealtime } from '../../state/realtime';
import { Avatar, Button, Card, Muted, Row, Segmented } from '../../ui/components';
import { MapView, type MapViewRef, Marker, Polyline } from '../../ui/map';
import { colors, spacing } from '../../ui/theme';

/** Позиция друга старше этого — показываем «данные устарели». */
const STALE_MS = 2 * 60_000;

/**
 * «Дойти до друга»: пока экран открыт, идёт сессия маршрута — друг видит, что ты
 * идёшь, и ETA. Маршрут пока по прямой; пошаговую навигацию даёт Яндекс Карты.
 */
export default function RouteScreen() {
  const { id: friendId } = useLocalSearchParams<{ id: string }>();
  const { friends } = useFriends();
  const { locations, subscribe } = useRealtime();
  const mapRef = useRef<MapViewRef>(null);
  const [mode, setMode] = useState<RouteMode>('walk');
  const [session, setSession] = useState<RouteSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [arrived, setArrived] = useState(false);
  const lastEtaSent = useRef(0);
  const sessionRef = useRef<RouteSession | null>(null);

  const friend = friends.find((f) => f.id === friendId);
  const target = locations[friendId];

  // Старт сессии и частые обновления позиции; при уходе с экрана сессия завершается.
  useEffect(() => {
    let stopWatch: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const started = await api.startRoute(friendId, 'walk');
        if (cancelled) return void api.stopRoute(started.id, 'stopped').catch(() => {});
        sessionRef.current = started;
        setSession(started);
      } catch (err) {
        setError(
          err instanceof ApiError && err.code === 'target_location_hidden'
            ? 'Друг не показывает тебе свою геолокацию.'
            : 'Не удалось начать маршрут. Проверь интернет.',
        );
        return;
      }
      try {
        stopWatch = await watchLocation((location) =>
          setMyPosition({ lat: location.coords.latitude, lng: location.coords.longitude }),
        );
        if (cancelled) stopWatch();
      } catch {
        setError('Разреши доступ к геолокации, чтобы построить маршрут.');
      }
    })();
    return () => {
      cancelled = true;
      stopWatch?.();
      const current = sessionRef.current;
      if (current && !current.endedAt) void api.stopRoute(current.id, 'stopped').catch(() => {});
    };
  }, [friendId]);

  // Друг остановил маршрут («не надо ко мне идти»).
  useEffect(() => {
    if (!session) return;
    return subscribe((event) => {
      if (event.type !== 'route.updated' || event.routeId !== session.id) return;
      void api
        .route(session.id)
        .then((latest) => {
          if (!latest.endedAt || sessionRef.current?.endedAt) return;
          sessionRef.current = latest;
          Alert.alert('Маршрут завершён', `${friend ? displayName(friend) : 'Друг'} остановил(а) маршрут.`, [
            { text: 'Ок', onPress: () => router.back() },
          ]);
        })
        .catch(() => {});
    });
  }, [session, subscribe, friend]);

  const distance = myPosition && target ? distanceMeters(myPosition, target) : null;
  const etaSec = distance !== null ? estimateEtaSec(distance, mode) : null;

  // ETA другу — не чаще раза в 30 с; рядом (< 50 м) — завершаем встречей.
  useEffect(() => {
    if (!session || distance === null || etaSec === null || arrived) return;
    if (distance <= MEET_RADIUS_M) {
      setArrived(true);
      Vibration.vibrate([0, 200, 100, 200]);
      sessionRef.current = { ...session, endedAt: new Date().toISOString(), endReason: 'arrived' };
      void api.stopRoute(session.id, 'arrived').catch(() => {});
      return;
    }
    if (Date.now() - lastEtaSent.current < ROUTE_ETA_INTERVAL_MS) return;
    lastEtaSent.current = Date.now();
    void api.updateRoute(session.id, { etaSec, distanceM: distance, mode }).catch(() => {});
  }, [session, distance, etaSec, mode, arrived]);

  // Один раз подгоняем карту, чтобы были видны оба; дальше её двигает пользователь.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !myPosition || !target) return;
    fitted.current = true;
    mapRef.current?.fitToCoordinates(
      [
        { latitude: myPosition.lat, longitude: myPosition.lng },
        { latitude: target.lat, longitude: target.lng },
      ],
      { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true },
    );
  }, [myPosition, target]);

  function finish() {
    const current = sessionRef.current;
    if (current && !current.endedAt) {
      sessionRef.current = { ...current, endedAt: new Date().toISOString() };
      void api.stopRoute(current.id, 'stopped').catch(() => {});
    }
    router.back();
  }

  const name = friend ? displayName(friend) : 'друг';
  const stale = target ? Date.now() - target.ts > STALE_MS : false;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `Маршрут · ${name}` }} />
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation
        initialRegion={
          target ? { latitude: target.lat, longitude: target.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 } : undefined
        }
      >
        {target && friend && (
          <Marker coordinate={{ latitude: target.lat, longitude: target.lng }}>
            <Avatar user={friend} size={40} dimmed={target.precision === 'approx'} />
          </Marker>
        )}
        {target && myPosition && (
          <Polyline
            coordinates={[
              { latitude: myPosition.lat, longitude: myPosition.lng },
              { latitude: target.lat, longitude: target.lng },
            ]}
            strokeColor={colors.primary}
            strokeWidth={4}
            dashed
          />
        )}
      </MapView>

      <Card style={styles.sheet}>
        {error ? (
          <Muted>{error}</Muted>
        ) : arrived ? (
          <Text style={styles.big}>Вы рядом! 🎉</Text>
        ) : (
          <>
            <Row>
              {friend && <Avatar user={friend} size={44} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.big}>
                  {etaSec !== null ? formatDuration(etaSec) : 'Ищем вас обоих…'}
                  {distance !== null ? ` · ${formatDistance(distance)}` : ''}
                </Text>
                <Muted>
                  {session ? `${name} видит, что ты идёшь` : 'Начинаем…'}
                  {target && stale ? ` · данные друга устарели (${timeAgo(target.ts)})` : ''}
                </Muted>
                {target?.precision === 'approx' && <Muted>Друг делится примерной геолокацией — ведём к району.</Muted>}
              </View>
            </Row>
            <Segmented<RouteMode>
              options={[
                { value: 'walk', label: '🚶 Пешком' },
                { value: 'drive', label: '🚗 На машине' },
              ]}
              value={mode}
              onChange={(next) => {
                setMode(next);
                lastEtaSent.current = 0;
              }}
            />
          </>
        )}
        <Row>
          {target && !arrived && (
            <View style={{ flex: 1 }}>
              <Button
                title="Яндекс Карты"
                variant="secondary"
                onPress={() => void Linking.openURL(yandexRouteUrl(myPosition, target, mode))}
              />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Button title={arrived || error ? 'Готово' : 'Завершить'} onPress={finish} />
          </View>
        </Row>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  map: { flex: 1 },
  sheet: { margin: spacing.lg, gap: spacing.md },
  big: { fontSize: 20, fontWeight: '700', color: colors.text },
});
