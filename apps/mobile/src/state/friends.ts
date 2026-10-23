import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { Friend, FriendRequests } from '../lib/types';
import { api } from '../services/client';
import { useRealtime } from './realtime';

const FRIEND_EVENTS = new Set(['friend.request', 'friend.added', 'friend.removed']);

/**
 * Друзья и заявки. Перезагружаются при открытии экрана и при событиях о дружбе;
 * позиции друзей приходят отдельно — через useRealtime().locations.
 */
export function useFriends() {
  const { subscribe } = useRealtime();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequests>({ incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [nextFriends, nextRequests] = await Promise.all([api.friends(), api.friendRequests()]);
      setFriends(nextFriends);
      setRequests(nextRequests);
      setError(null);
    } catch {
      setError('Не удалось загрузить друзей. Проверь интернет.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(
    () =>
      subscribe((event) => {
        if (FRIEND_EVENTS.has(event.type)) void reload();
      }),
    [subscribe, reload],
  );

  return { friends, requests, loading, error, reload };
}
