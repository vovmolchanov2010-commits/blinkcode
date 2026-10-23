import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { api } from '../../services/client';
import {
  isSharingLocation,
  requestLocationPermission,
  setSharingDisabledByUser,
  startSharingLocation,
  stopSharingLocation,
} from '../../services/location';
import { useAuth, useMe } from '../../state/auth';
import { Avatar, Button, Card, ErrorText, Input, Muted, Row, SectionTitle } from '../../ui/components';
import { colors, spacing } from '../../ui/theme';

function endOfToday(): Date {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

export default function ProfileScreen() {
  const me = useMe();
  const { setMe, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [username, setUsername] = useState(me?.username ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      void isSharingLocation().then(setSharing);
    }, []),
  );

  if (!me) return null;
  const ghostUntil = me.ghostUntil ? new Date(me.ghostUntil) : null;
  const ghostActive = ghostUntil !== null && ghostUntil > new Date();

  async function saveProfile() {
    setSaving(true);
    setError(null);
    try {
      setMe(await api.updateMe({ displayName: displayName.trim(), username }));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'username_taken'
          ? 'Этот ник уже занят.'
          : 'Не получилось сохранить. Ник: 3–24 символа — латиница, цифры, «_» или «.».',
      );
    } finally {
      setSaving(false);
    }
  }

  async function setGhost(until: Date | undefined | null) {
    try {
      setMe(until === null ? await api.disableGhost() : await api.enableGhost(until));
    } catch {
      Alert.alert('Не получилось', 'Проверь интернет и попробуй ещё раз.');
    }
  }

  async function toggleSharing(enabled: boolean) {
    try {
      if (enabled) {
        const permission = await requestLocationPermission();
        if (permission === 'denied') {
          Alert.alert('Нет доступа к геолокации', 'Разреши доступ в настройках телефона.');
          return;
        }
        await setSharingDisabledByUser(false);
        await startSharingLocation();
      } else {
        await setSharingDisabledByUser(true);
        await stopSharingLocation();
      }
    } catch {
      Alert.alert('Не получилось', 'Проверь, что доступ к геолокации разрешён «Всегда».');
    } finally {
      setSharing(await isSharingLocation());
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Row>
        <Avatar user={me} size={56} />
        <View>
          <Text style={styles.name}>{me.displayName ?? 'Без имени'}</Text>
          <Muted>{me.phone}</Muted>
        </View>
      </Row>

      <SectionTitle>Геолокация</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Row>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Делиться геолокацией</Text>
            <Muted>Точность для каждого друга — в его настройках.</Muted>
          </View>
          <Switch value={sharing ?? false} onValueChange={toggleSharing} disabled={sharing === null} />
        </Row>
      </Card>

      <SectionTitle>Безопасность и места</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Button title="🏠 Дом и работа" variant="secondary" onPress={() => router.push('/places')} />
        <Button title="🆘 SOS: контакты и PIN" variant="secondary" onPress={() => router.push('/sos/setup')} />
      </Card>

      <SectionTitle>Режим «призрак»</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        {ghostActive ? (
          <>
            <Text style={styles.label}>
              👻 Друзья тебя не видят
              {ghostUntil.getFullYear() < 9999
                ? ` до ${ghostUntil.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </Text>
            <Button title="Выключить" variant="secondary" onPress={() => setGhost(null)} />
          </>
        ) : (
          <>
            <Muted>Спрятаться от всех друзей на время. Они просто перестанут видеть тебя на карте.</Muted>
            <Row>
              <View style={{ flex: 1 }}>
                <Button title="1 час" variant="secondary" small onPress={() => setGhost(new Date(Date.now() + 3_600_000))} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="До конца дня" variant="secondary" small onPress={() => setGhost(endOfToday())} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Пока не выключу" variant="secondary" small onPress={() => setGhost(undefined)} />
              </View>
            </Row>
          </>
        )}
      </Card>

      <SectionTitle>Профиль</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Input value={displayName} onChangeText={setDisplayName} placeholder="Имя" maxLength={50} />
        <Input
          value={username}
          onChangeText={(value) => setUsername(value.toLowerCase().replace(/\s/g, ''))}
          placeholder="ник"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
        />
        {error && <ErrorText>{error}</ErrorText>}
        <Button title="Сохранить" onPress={saveProfile} loading={saving} />
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button
          title="Выйти"
          variant="danger"
          onPress={() =>
            Alert.alert('Выйти из аккаунта?', 'Друзья перестанут видеть тебя на карте.', [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Выйти', style: 'destructive', onPress: () => void signOut() },
            ])
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
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
});
