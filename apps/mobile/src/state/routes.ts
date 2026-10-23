import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { RouteSession } from '../lib/types';
import { api } from '../services/client';
import { useRealtime } from './realtime';

/** Активные маршруты: кто идёт ко мне и к кому иду я. */
export function useRoutes() {
  const { subscribe } = useRealtime();
  const [routes, setRoutes] = useState<RouteSession[]>([]);

  const reload = useCallback(async () => {
    try {
      setRoutes(await api.routes());
    } catch {
      // Без сети оставляем то, что было.
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
        if (event.type === 'route.updated') void reload();
      }),
    [subscribe, reload],
  );

  // Сессия живёт час — убираем истёкшие, не дожидаясь сервера.
  const active = routes.filter((r) => !r.endedAt && Date.parse(r.expiresAt) > Date.now());
  return { routes: active, reload };
}
