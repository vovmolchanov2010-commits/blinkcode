import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { Gathering } from '../lib/types';
import { api } from '../services/client';
import { useRealtime } from './realtime';

/** Активные сборы пользователя; обновляются при открытии экрана и по событиям сервера. */
export function useGatherings() {
  const { subscribe } = useRealtime();
  const [gatherings, setGatherings] = useState<Gathering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setGatherings(await api.gatherings());
      setError(null);
    } catch {
      setError('Не удалось загрузить сборы. Проверь интернет.');
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
        if (event.type === 'gathering.updated') void reload();
      }),
    [subscribe, reload],
  );

  return { gatherings, loading, error, reload };
}

/** Один сбор; null — ещё загружается, 'missing' — нет доступа или удалён. */
export function useGathering(id: string) {
  const { subscribe } = useRealtime();
  const [gathering, setGathering] = useState<Gathering | null | 'missing'>(null);

  const reload = useCallback(async () => {
    try {
      setGathering(await api.gathering(id));
    } catch (err) {
      if ((err as { status?: number }).status === 404) setGathering('missing');
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'gathering.updated' && event.gatheringId === id) void reload();
      }),
    [subscribe, reload, id],
  );

  return { gathering, setGathering, reload };
}
