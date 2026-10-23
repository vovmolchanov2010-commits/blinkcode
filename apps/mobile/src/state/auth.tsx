import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { Me } from '../lib/types';
import { api, loadServerUrl } from '../services/client';
import { stopSharingLocation } from '../services/location';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  /** me === null — профиль ещё не загружен (например, нет сети при запуске). */
  | { status: 'signedIn'; me: Me | null };

interface AuthValue {
  state: AuthState;
  requestCode(phone: string): Promise<{ devCode?: string }>;
  signIn(phone: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  setMe(me: Me): void;
  reloadMe(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    api.onSessionExpired = () => setState({ status: 'signedOut' });
    void (async () => {
      await loadServerUrl();
      if (!(await api.hasSession())) return setState({ status: 'signedOut' });
      setState({ status: 'signedIn', me: null });
      try {
        setState({ status: 'signedIn', me: await api.me() });
      } catch {
        // Без сети остаёмся в приложении; профиль подгрузится позже.
      }
    })();
    return () => {
      api.onSessionExpired = null;
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      state,
      requestCode: (phone) => api.requestOtp(phone),
      async signIn(phone, code) {
        const { user } = await api.verifyOtp(phone, code);
        setState({ status: 'signedIn', me: user });
      },
      async signOut() {
        await stopSharingLocation().catch(() => {});
        await api.logout();
        setState({ status: 'signedOut' });
      },
      setMe: (me) => setState({ status: 'signedIn', me }),
      async reloadMe() {
        setState({ status: 'signedIn', me: await api.me() });
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** Профиль текущего пользователя; только для экранов, доступных после входа. */
export function useMe(): Me | null {
  const { state } = useAuth();
  return state.status === 'signedIn' ? state.me : null;
}
