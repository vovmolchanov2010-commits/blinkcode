import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { applyEvent, type FriendLocations } from '../lib/friendLocations';
import { RealtimeClient, type RealtimeStatus } from '../lib/realtime';
import type { ServerEvent } from '../lib/types';
import { api, demo } from '../services/client';
import { useAuth } from './auth';

type Listener = (event: ServerEvent) => void;

interface RealtimeValue {
  /** Позиции друзей, которые видит пользователь, — обновляются в реальном времени. */
  locations: FriendLocations;
  status: RealtimeStatus;
  /** Подписка на события сервера (например, чтобы обновить список друзей). */
  subscribe(listener: Listener): () => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const signedIn = state.status === 'signedIn';
  const [locations, dispatch] = useReducer(applyEvent, {});
  const [status, setStatus] = useState<RealtimeStatus>('closed');
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    if (!signedIn) {
      dispatch({ type: 'snapshot', locations: [] });
      return;
    }
    if (api.isLocal) return startDemoRealtime(dispatch, setStatus, listeners.current);
    const client = new RealtimeClient({
      getUrl: () => api.realtimeUrl(),
      onEvent: (event) => {
        dispatch(event);
        for (const listener of listeners.current) listener(event);
      },
      onStatus: setStatus,
    });
    client.start();
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') client.reconnectNow();
    });
    return () => {
      subscription.remove();
      client.stop();
    };
  }, [signedIn]);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ locations, status, subscribe }), [locations, status, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** Как часто в демо-режиме друзья делают шаг к тебе. */
const DEMO_TICK_MS = 4_000;

/** Демо-режим: события идут от демо-«сервера» в памяти, а не по WebSocket. */
function startDemoRealtime(
  dispatch: (event: ServerEvent) => void,
  setStatus: (status: RealtimeStatus) => void,
  listeners: Set<Listener>,
): () => void {
  const deliver = (event: ServerEvent) => {
    dispatch(event);
    for (const listener of listeners) listener(event);
  };
  setStatus('open');
  deliver(demo.snapshot());
  const unsubscribe = demo.subscribe(deliver);
  const timer = setInterval(() => demo.tick(), DEMO_TICK_MS);
  return () => {
    clearInterval(timer);
    unsubscribe();
    setStatus('closed');
  };
}

export function useRealtime(): RealtimeValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime must be used inside RealtimeProvider');
  return value;
}
