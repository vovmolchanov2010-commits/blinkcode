import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PLACE_LABEL } from '../lib/meet';
import type { MyPlaces, PlaceKind, PlaceVisibility } from '../lib/types';
import { api } from '../services/client';
import { Button, Card, Muted, Row, SectionTitle, Segmented } from '../ui/components';
import { colors, spacing } from '../ui/theme';

const KINDS: PlaceKind[] = ['home', 'work'];

const VISIBILITY_HINT: Record<PlaceVisibility, string> = {
  all: 'Все друзья видят статус «дома» / «на работе».',
  close: 'Статус видят только близкие друзья (⭐ в настройках друга).',
  none: 'Статус не видит никто.',
};

/**
 * Дом и работа (фича 9). Друзья видят статус, а не адрес: пока ты в зоне места,
 * твоя позиция для всех размывается до района.
 */
export default function PlacesScreen() {
  const [data, setData] = useState<MyPlaces | null>(null);
  const [busy, setBusy] = useState<PlaceKind | null>(null);

  useEffect(() => {
    void api.myPlaces().then(setData).catch(() => Alert.alert('Нет связи', 'Проверь интернет.'));
  }, []);

  if (!data) return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />;

  async function setHere(kind: PlaceKind) {
    setBusy(kind);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Нет доступа к геолокации', 'Разреши доступ в настройках телефона.');
        return;
      }
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setData(await api.setPlace(kind, { lat: coords.latitude, lng: coords.longitude }));
    } catch {
      Alert.alert('Не получилось', 'Проверь интернет и геолокацию.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(kind: PlaceKind) {
    try {
      setData(await api.deletePlace(kind));
    } catch {
      Alert.alert('Не получилось', 'Проверь интернет.');
    }
  }

  async function setVisibility(visibility: PlaceVisibility) {
    try {
      setData(await api.setPlaceVisibility(visibility));
    } catch {
      Alert.alert('Не получилось', 'Проверь интернет.');
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Muted>
        Отметь дом и работу — друзья будут видеть статус, а не адрес. Пока ты внутри зоны (~150 м), твоя точка на
        карте у всех размывается до района.
      </Muted>

      {KINDS.map((kind) => {
        const place = data.places.find((p) => p.kind === kind);
        return (
          <View key={kind}>
            <SectionTitle>{PLACE_LABEL[kind]}</SectionTitle>
            <Card style={{ gap: spacing.md }}>
              <Text style={styles.label}>{place ? 'Отмечено' : 'Не отмечено'}</Text>
              <Row>
                <View style={{ flex: 1 }}>
                  <Button
                    title={kind === 'home' ? 'Я сейчас дома' : 'Я сейчас на работе'}
                    small
                    loading={busy === kind}
                    onPress={() => setHere(kind)}
                  />
                </View>
                {place && (
                  <View style={{ flex: 1 }}>
                    <Button title="Удалить" variant="secondary" small onPress={() => remove(kind)} />
                  </View>
                )}
              </Row>
            </Card>
          </View>
        );
      })}

      <SectionTitle>Кто видит статус</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Segmented<PlaceVisibility>
          options={[
            { value: 'all', label: 'Все' },
            { value: 'close', label: 'Близкие' },
            { value: 'none', label: 'Никто' },
          ]}
          value={data.visibility}
          onChange={setVisibility}
        />
        <Muted>{VISIBILITY_HINT[data.visibility]}</Muted>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
});
