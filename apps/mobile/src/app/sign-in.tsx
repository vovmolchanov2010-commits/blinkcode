import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api';
import { normalizePhone } from '../lib/format';
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
  const { requestCode, signIn } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitPhone() {
    const normalized = normalizePhone(phoneInput);
    if (!normalized) return setError('Введи номер в формате +7 999 123-45-67.');
    setBusy(true);
    setError(null);
    try {
      await requestCode(normalized);
      setPhone(normalized);
      setStep('code');
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
          </View>
        ) : (
          <View style={styles.form}>
            <Muted>Код отправлен на {phone}</Muted>
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
});
