import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { displayName, normalizePhone } from '../../lib/format';
import type { SosContactInput, SosStatus } from '../../lib/types';
import { api } from '../../services/client';
import { useFriends } from '../../state/friends';
import { Avatar, Button, Card, ErrorText, Input, Muted, Pill, Row, SectionTitle } from '../../ui/components';
import { colors, spacing } from '../../ui/theme';

const MAX_CONTACTS = 3;

/** Контакт в форме: друг из приложения или номер телефона. */
type Draft = { userId: string; label: string } | { phone: string; name: string };

export default function SosSetupScreen() {
  const { friends } = useFriends();
  const [status, setStatus] = useState<SosStatus | null>(null);
  const [contacts, setContacts] = useState<Draft[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [pinRepeat, setPinRepeat] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .sosStatus()
      .then((loaded) => {
        setStatus(loaded);
        setContacts(
          loaded.contacts.map((c) =>
            c.user ? { userId: c.user.id, label: displayName(c.user) } : { phone: c.phone!, name: c.name ?? '' },
          ),
        );
      })
      .catch(() => Alert.alert('Нет связи', 'Проверь интернет.', [{ text: 'Ок', onPress: () => router.back() }]));
  }, []);

  if (!status) return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />;

  const chosenFriends = new Set(contacts.flatMap((c) => ('userId' in c ? [c.userId] : [])));
  const full = contacts.length >= MAX_CONTACTS;

  function addPhone() {
    const normalized = normalizePhone(phone);
    if (!normalized || !name.trim()) {
      setPhoneError('Укажи имя и номер, например +7 999 123-45-67.');
      return;
    }
    setPhoneError(null);
    setContacts([...contacts, { phone: normalized, name: name.trim() }]);
    setPhone('');
    setName('');
  }

  async function save() {
    const pinWanted = pin.length > 0 || !status!.hasPin;
    if (pinWanted && !/^\d{4,6}$/.test(pin)) return setPinError('PIN — от 4 до 6 цифр.');
    if (pinWanted && pin !== pinRepeat) return setPinError('PIN не совпадает.');
    if (contacts.length === 0) return Alert.alert('Добавь хотя бы один контакт');
    setPinError(null);
    setSaving(true);
    try {
      const payload: SosContactInput[] = contacts.map((c) =>
        'userId' in c ? { userId: c.userId } : { phone: c.phone, name: c.name },
      );
      await api.setSosContacts(payload);
      if (pinWanted) await api.setSosPin(pin, status!.hasPin ? currentPin : undefined);
      router.back();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_pin') setPinError('Текущий PIN неверный.');
      else Alert.alert('Не получилось', 'Проверь интернет и попробуй ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Muted>
        Эти люди получат SMS со ссылкой на трансляцию, когда ты нажмёшь SOS. Друзья из Blink ещё и увидят тревогу в
        приложении.
      </Muted>

      <SectionTitle>
        Доверенные контакты · {contacts.length}/{MAX_CONTACTS}
      </SectionTitle>
      <Card style={{ gap: spacing.md }}>
        {contacts.length === 0 && <Muted>Пока никого.</Muted>}
        {contacts.map((c, i) => (
          <Row key={'userId' in c ? c.userId : c.phone}>
            <Text style={styles.name}>{'userId' in c ? c.label : `${c.name} · ${c.phone}`}</Text>
            <Pill label="Убрать" onPress={() => setContacts(contacts.filter((_, j) => j !== i))} />
          </Row>
        ))}
      </Card>

      {!full && (
        <>
          <SectionTitle>Из друзей</SectionTitle>
          <Card style={{ gap: spacing.md }}>
            {friends.length === 0 && <Muted>Друзей пока нет — добавь контакт по номеру.</Muted>}
            {friends
              .filter((f) => !chosenFriends.has(f.id))
              .map((friend) => (
                <Row key={friend.id}>
                  <Avatar user={friend} size={32} />
                  <Text style={styles.name}>{displayName(friend)}</Text>
                  <Pill
                    label="Добавить"
                    onPress={() => setContacts([...contacts, { userId: friend.id, label: displayName(friend) }])}
                  />
                </Row>
              ))}
          </Card>

          <SectionTitle>По номеру телефона</SectionTitle>
          <Card style={{ gap: spacing.md }}>
            <Input value={name} onChangeText={setName} placeholder="Имя, например «Мама»" maxLength={50} />
            <Input value={phone} onChangeText={setPhone} placeholder="+7 999 123-45-67" keyboardType="phone-pad" />
            {phoneError && <ErrorText>{phoneError}</ErrorText>}
            <Button title="Добавить" variant="secondary" small onPress={addPhone} />
          </Card>
        </>
      )}

      <SectionTitle>PIN для отмены</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Muted>
          {status.hasPin
            ? 'PIN уже задан. Чтобы сменить, введи текущий и новый.'
            : 'Отменить SOS можно будет только этим PIN-кодом — чтобы его не отменил кто-то другой.'}
        </Muted>
        {status.hasPin && (
          <Input
            value={currentPin}
            onChangeText={(v) => setCurrentPin(v.replace(/\D/g, ''))}
            placeholder="Текущий PIN"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />
        )}
        <Input
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, ''))}
          placeholder={status.hasPin ? 'Новый PIN (необязательно)' : 'PIN, 4–6 цифр'}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
        />
        <Input
          value={pinRepeat}
          onChangeText={(v) => setPinRepeat(v.replace(/\D/g, ''))}
          placeholder="Повтори PIN"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
        />
        {pinError && <ErrorText>{pinError}</ErrorText>}
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button title="Сохранить" onPress={save} loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  name: { flex: 1, fontSize: 16, color: colors.text },
});
