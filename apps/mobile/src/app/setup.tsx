import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api';
import { api } from '../services/client';
import { useAuth } from '../state/auth';
import { Button, ErrorText, Input, Muted, Title } from '../ui/components';
import { colors, spacing } from '../ui/theme';

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

/** Первый вход: имя и ник, по которому друзья найдут пользователя. */
export default function SetupScreen() {
  const { setMe } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const name = displayName.trim();
    if (!name) return setError('Как тебя зовут?');
    if (!USERNAME_RE.test(username)) {
      return setError('Ник: 3–24 символа — латиница, цифры, «_» или «.».');
    }
    setBusy(true);
    setError(null);
    try {
      setMe(await api.updateMe({ displayName: name, username }));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'username_taken'
          ? 'Этот ник уже занят.'
          : 'Не получилось сохранить. Попробуй ещё раз.',
      );
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Title>Привет!</Title>
          <Muted>Друзья увидят имя на карте и найдут тебя по нику.</Muted>
        </View>
        <View style={styles.form}>
          <Input value={displayName} onChangeText={setDisplayName} placeholder="Имя" autoFocus maxLength={50} />
          <Input
            value={username}
            onChangeText={(value) => setUsername(value.toLowerCase().replace(/\s/g, ''))}
            placeholder="ник, например vitya"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
            onSubmitEditing={save}
          />
          {error && <ErrorText>{error}</ErrorText>}
          <Button title="Продолжить" onPress={save} loading={busy} />
        </View>
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
