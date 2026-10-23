import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking, Vibration } from 'react-native';
import { displayName } from '../lib/format';
import { formatClock } from '../lib/meet';
import { api } from '../services/client';
import { useRealtime } from './realtime';

/**
 * Всплывающие сообщения о важных событиях, пока приложение открыто:
 * приглашение на сбор, перенос сбора, SOS от друга. Пушей пока нет.
 */
export function EventAlerts() {
  const { subscribe } = useRealtime();

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'gathering.updated') {
          if (event.reason !== 'invited' && !(event.reason === 'changed' && event.startsAtTo)) return;
          void api
            .gathering(event.gatheringId)
            .then((gathering) => {
              const owner = gathering.participants.find((p) => p.user.id === gathering.ownerId)?.user;
              const open = { text: 'Открыть', onPress: () => router.push(`/gathering/${gathering.id}`) };
              if (event.reason === 'invited') {
                Alert.alert(`${owner ? displayName(owner) : 'Друг'} зовёт: ${gathering.title}`, undefined, [
                  { text: 'Позже', style: 'cancel' },
                  open,
                ]);
              } else {
                Alert.alert(
                  `Сбор «${gathering.title}» перенесли`,
                  `${formatClock(event.startsAtFrom!)} → ${formatClock(event.startsAtTo!)}`,
                  [{ text: 'Ок', style: 'cancel' }, open],
                );
              }
            })
            .catch(() => {});
        }

        if (event.type === 'sos.started') {
          Vibration.vibrate([0, 500, 300, 500, 300, 500]);
          void api
            .friends()
            .then((friends) => friends.find((f) => f.id === event.userId))
            .catch(() => undefined)
            .then((friend) => {
              const name = friend ? displayName(friend) : 'Друг';
              Alert.alert(
                event.isTest ? `ТЕСТ: ${name} проверяет SOS` : `🆘 ${name} нажал(а) SOS`,
                event.isTest ? 'Это проверка, ничего делать не нужно.' : 'Посмотри, где он(а) сейчас. Если нужна помощь — звони 112.',
                [
                  { text: 'Закрыть', style: 'cancel' },
                  { text: 'Открыть трансляцию', onPress: () => void Linking.openURL(event.url) },
                ],
              );
            });
        }

        if (event.type === 'sos.ended') {
          Alert.alert('SOS отменён', 'Друг отменил SOS.');
        }
      }),
    [subscribe],
  );

  return null;
}
