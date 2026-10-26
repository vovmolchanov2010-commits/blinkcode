import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api';
import { normalizePhone, normalizeServerUrl } from '../lib/format';
import { api, demo, setServerUrl } from '../services/client';
import { useAuth } from '../state/auth';
import { Button, ErrorText, Input, Muted, Title } from '../ui/components';
import { colors, spacing } from '../ui/theme';

const ERRORS: Record<string, string> = {
  otp_resend_too_soon: 'Код уже отправлен. Новый можно запросить через минуту.',
  otp_rate_limited: 'Слишком много попыток. Попробуй через час.',
  otp_invalid: 'Неверный код.',
  otp_too_many_attempts: 'Слишком много неверных попыток. Запроси новый код.',
  validation_error: 'Проверь номер телефона.',
};

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return ERRORS[err.code] ?? 'Что-то пошло не так. Попробуй ещё раз.';
  return 'Нет связи с сервером. Проверь интернет.';
}

export default function SignInScreen() {
  const { requestCode, signIn, startDemo } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [server, setServer] = useState(api.baseUrl);
  const [serverInput, setServerInput] = useState('');
  const [editingServer, setEditingServer] = useState(false);

  async function submitPhone() {
    const normalized = normalizePhone(phoneInput);
    if (!normalized) return setError('Введи номер в формате +7 999 123-45-67.');
    setBusy(true);
    setError(null);
    try {
      const result = await requestCode(normalized);
      setPhone(normalized);
      setStep('code');
      // Тестовый сервер присылает код в ответе — подставляем его.
      if (result.devCode) {
        setDevCode(result.devCode);
        setCode(result.devCode);
      }
    } catch (err) {
      // Код уже отправлен недавно — всё равно даём его ввести.
      if (err instanceof ApiError && err.code === 'otp_resend_too_soon') {
        setPhone(normalized);
        setStep('code');
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveServer() {
    const url = normalizeServerUrl(serverInput);
    if (!url) return setError('Адрес сервера вида 192.168.1.5:3000 или https://example.ru');
    await setServerUrl(url);
    setServer(url);
    setEditingServer(false);
    setError(null);
  }

  async function resetServer() {
    await setServerUrl(null);
    setServer(api.baseUrl);
    setEditingServer(false);
    setError(null);
  }

  async function openDemo() {
    setBusy(true);
    setError(null);
    try {
      await startDemo();
    } catch {
      setError('Не удалось открыть демо. Попробуй ещё раз.');
      setBusy(false);
    }
  }

  async function submitCode(value = code) {
    if (!/^\d{6}$/.test(value)) return setError('Код — 6 цифр из SMS.');
    setBusy(true);
    setError(null);
    try {
      await signIn(phone, value);
      // Навигация переключится сама: корневой Stack смотрит на состояние входа.
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Title>Blink</Title>
          <Muted>Друзья на карте, сборы и безопасность.</Muted>
        </View>

        {step === 'phone' ? (
          <View style={styles.form}>
            <Input
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="+7 999 123-45-67"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoFocus
              onSubmitEditing={submitPhone}
            />
            {error && <ErrorText>{error}</ErrorText>}
            <Button title="Получить код" onPress={submitPhone} loading={busy} />

            {/* Одна сборка приложения работает с любым сервером: локальным или в облаке. */}
            {editingServer ? (
              <View style={styles.server}>
                <Input
                  value={serverInput}
                  onChangeText={setServerInput}
                  placeholder="192.168.1.5:3000"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onSubmitEditing={saveServer}
                />
                <Button title="Сохранить сервер" variant="secondary" small onPress={saveServer} />
                <Button title="Сервер по умолчанию" variant="secondary" small onPress={resetServer} />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setServerInput(server);
                  setEditingServer(true);
                }}
              >
                <Muted style={styles.serverLink}>Сервер: {server} · изменить</Muted>
              </Pressable>
            )}

            <View style={styles.demo}>
              <Button title="Посмотреть демо без сервера" variant="secondary" onPress={openDemo} disabled={busy} />
              <Muted style={styles.demoHint}>
                Выдуманные друзья, сбор и маршрут — чтобы показать приложение. PIN для отмены SOS в демо:{' '}
                {demo.demoPin}.
              </Muted>
            </View>
          </View>
        ) : (
          <View style={styles.form}>
            <Muted>
              {devCode ? `Тестовый сервер: код ${devCode} подставлен автоматически` : `Код отправлен на ${phone}`}
            </Muted>
            <Input
              value={code}
              onChangeText={(value) => {
                const digits = value.replace(/\D/g, '').slice(0, 6);
                setCode(digits);
                if (digits.length === 6) void submitCode(digits);
              }}
              placeholder="123456"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              autoFocus
              maxLength={6}
            />
            {error && <ErrorText>{error}</ErrorText>}
            <Button title="Войти" onPress={() => submitCode()} loading={busy} />
            <Button
              title="Изменить номер"
              variant="secondary"
              onPress={() => {
                setStep('phone');
                setCode('');
                setDevCode(null);
                setError(null);
              }}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, padding: spacing.xl, justifyContent: 'center' },
  header: { marginBottom: spacing.xl, gap: spacing.sm },
  form: { gap: spacing.md },
  server: { gap: spacing.sm, marginTop: spacing.lg },
  serverLink: { textAlign: 'center', marginTop: spacing.lg, fontSize: 13 },
  demo: { marginTop: spacing.xl, gap: spacing.sm },
  demoHint: { textAlign: 'center', fontSize: 13 },
});
