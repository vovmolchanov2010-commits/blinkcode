import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, Text, Vibration, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { displayName } from '../../lib/format';
import { formatClock } from '../../lib/meet';
import type { SosStatus } from '../../lib/types';
import { api } from '../../services/client';
import { isSharingDisabledByUser, startSharingLocation, watchLocation } from '../../services/location';
import { Button, Card, ErrorText, Input, Muted, Row, SectionTitle } from '../../ui/components';
import { colors, radius, spacing } from '../../ui/theme';

const HOLD_SECONDS = 3;

export default function SosScreen() {
  const [status, setStatus] = useState<SosStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [test, setTest] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await api.sosStatus());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const active = status?.active ?? null;
  const activeId = active?.id;
  const expiresAt = active?.expiresAt;

  // Пока идёт SOS и экран открыт — позиция раз в 5 с; в фоне — обычная задача.
  useEffect(() => {
    if (!activeId || !expiresAt) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void watchLocation(() => {})
      .then((fn) => {
        if (cancelled) fn();
        else stop = fn;
      })
      .catch(() => {});
    void isSharingDisabledByUser().then((disabled) => {
      if (!disabled) void startSharingLocation().catch(() => {});
    });
    // Трансляция кончилась сама — обновляем экран.
    const expiresIn = Date.parse(expiresAt) - Date.now();
    const expiry = setTimeout(() => void reload(), Math.max(0, expiresIn) + 1000);
    return () => {
      cancelled = true;
      stop?.();
      clearTimeout(expiry);
    };
  }, [activeId, expiresAt, reload]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  function startHold() {
    if (starting || timer.current) return;
    let left = HOLD_SECONDS;
    setCountdown(left);
    Vibration.vibrate(80);
    timer.current = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setCountdown(left);
        Vibration.vibrate(80);
        return;
      }
      cancelHold();
      void activate();
    }, 1000);
  }

  function cancelHold() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setCountdown(null);
  }

  async function activate() {
    setStarting(true);
    Vibration.vibrate([0, 300, 150, 300]);
    try {
      const result = await api.startSos(test);
      setLink(result.url);
      if (result.smsFailed > 0) {
        Alert.alert('Не все SMS ушли', 'Отправь ссылку вручную или позвони 112.', [
          { text: 'Поделиться ссылкой', onPress: () => void Share.share({ message: result.url }) },
          { text: 'Ок' },
        ]);
      }
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'sos_already_active') return void reload();
      Alert.alert(
        'SOS не отправлен',
        err instanceof ApiError ? 'Попробуй ещё раз.' : 'Нет связи с сервером. Позвони 112.',
        [
          { text: 'Позвонить 112', onPress: () => void Linking.openURL('tel:112') },
          { text: 'Ок' },
        ],
      );
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    setCancelError(null);
    try {
      await api.cancelSos(pin);
      setPin('');
      setLink(null);
      await reload();
    } catch (err) {
      setCancelError(
        err instanceof ApiError && err.code === 'wrong_pin'
          ? 'Неверный PIN.'
          : err instanceof ApiError && err.code === 'too_many_attempts'
            ? 'Слишком много попыток. Трансляция закончится сама.'
            : 'Не получилось. Проверь интернет.',
      );
    }
  }

  async function extend() {
    try {
      await api.extendSos();
      await reload();
    } catch {
      Alert.alert('Не получилось', 'Проверь интернет.');
    }
  }

  const ready = status !== null && status.hasPin && status.contacts.length > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Button title="📞 Позвонить 112" variant="danger" onPress={() => void Linking.openURL('tel:112')} />
      <Muted style={{ marginTop: spacing.sm }}>
        Blink не экстренная служба. SOS отправляет доверенным контактам SMS со ссылкой, по которой 15 минут видно,
        где ты.
      </Muted>
      {loadError && <ErrorText>Нет связи с сервером. При опасности звони 112.</ErrorText>}

      {status && !ready && (
        <Card style={{ marginTop: spacing.xl, gap: spacing.md }}>
          <Text style={styles.label}>Сначала настрой SOS</Text>
          <Muted>Выбери до трёх доверенных контактов и PIN для отмены.</Muted>
          <Button title="Настроить" onPress={() => router.push('/sos/setup')} />
        </Card>
      )}

      {ready && !active && (
        <View style={styles.center}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Удерживай три секунды, чтобы отправить SOS"
            onPressIn={startHold}
            onPressOut={cancelHold}
            disabled={starting}
            style={[styles.sosButton, countdown !== null && styles.sosButtonHeld, test && styles.sosButtonTest]}
          >
            <Text style={styles.sosText}>{countdown ?? (starting ? '…' : 'SOS')}</Text>
          </Pressable>
          <Muted>Удерживай {HOLD_SECONDS} секунды</Muted>
          <Row style={{ marginTop: spacing.lg }}>
            <Text style={styles.label}>Тестовый режим</Text>
            <Switch value={test} onValueChange={setTest} />
          </Row>
          <Muted style={{ textAlign: 'center' }}>Контакты получат сообщение с пометкой «ТЕСТ».</Muted>
        </View>
      )}

      {active && (
        <>
          <Card style={[styles.activeCard, active.isTest && { backgroundColor: colors.primary }]}>
            <Text style={styles.activeTitle}>{active.isTest ? 'Тест SOS' : 'SOS активен'}</Text>
            <Text style={styles.activeText}>Трансляция до {formatClock(active.expiresAt)}</Text>
          </Card>
          <Row style={{ marginTop: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button title="+15 минут" variant="secondary" onPress={extend} />
            </View>
            {link && (
              <View style={{ flex: 1 }}>
                <Button title="Поделиться" variant="secondary" onPress={() => void Share.share({ message: link })} />
              </View>
            )}
          </Row>

          <SectionTitle>Получили ссылку</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            {status!.contacts.map((c) => (
              <Text key={c.position} style={styles.contact}>
                {c.user ? displayName(c.user) : `${c.name} · ${c.phone}`}
              </Text>
            ))}
          </Card>

          <SectionTitle>Отмена</SectionTitle>
          <Card style={{ gap: spacing.md }}>
            <Muted>Отменить можно только PIN-кодом. Контакты получат «Отменено».</Muted>
            <Input
              value={pin}
              onChangeText={(v) => setPin(v.replace(/\D/g, ''))}
              placeholder="PIN"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
            />
            {cancelError && <ErrorText>{cancelError}</ErrorText>}
            <Button title="Отменить SOS" variant="secondary" onPress={cancel} disabled={pin.length < 4} />
          </Card>
        </>
      )}

      {ready && !active && (
        <View style={{ marginTop: spacing.xl }}>
          <Button title="Контакты и PIN" variant="secondary" onPress={() => router.push('/sos/setup')} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  center: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.sm },
  sosButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosButtonHeld: { transform: [{ scale: 1.08 }], opacity: 0.85 },
  sosButtonTest: { backgroundColor: colors.primary },
  sosText: { color: colors.primaryText, fontSize: 48, fontWeight: '800' },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  activeCard: { marginTop: spacing.xl, backgroundColor: colors.danger, borderRadius: radius.lg, alignItems: 'center' },
  activeTitle: { color: colors.primaryText, fontSize: 24, fontWeight: '800' },
  activeText: { color: colors.primaryText, fontSize: 16, marginTop: spacing.xs },
  contact: { fontSize: 16, color: colors.text },
});
