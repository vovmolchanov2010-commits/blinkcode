import * as SecureStore from 'expo-secure-store';
import { ApiClient, type TokenStore } from '../lib/api';
import type { Tokens } from '../lib/types';

/**
 * Адрес API по умолчанию задаётся при сборке через EXPO_PUBLIC_API_URL
 * (по умолчанию — локальный сервер; для эмулятора Android: http://10.0.2.2:3000).
 * Пользователь может сменить его на экране входа — см. setServerUrl.
 */
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const TOKENS_KEY = 'blink.tokens';
const SERVER_KEY = 'blink.server';

// AFTER_FIRST_UNLOCK: фоновая задача геолокации должна читать токены при заблокированном экране.
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

const secureTokenStore: TokenStore = {
  async load() {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY, secureOptions);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  },
  async save(tokens) {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens), secureOptions);
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKENS_KEY, secureOptions);
  },
};

/** Единый клиент для экранов и фоновой задачи — обновление токенов не должно идти параллельно. */
export const api = new ApiClient(DEFAULT_API_URL, secureTokenStore);

let serverLoaded: Promise<void> | null = null;

/** Применяет сохранённый адрес сервера. Вызывать до первого запроса (экраны и фоновая задача). */
export function loadServerUrl(): Promise<void> {
  serverLoaded ??= SecureStore.getItemAsync(SERVER_KEY, secureOptions)
    .then((url) => {
      if (url) api.setBaseUrl(url);
    })
    .catch(() => {});
  return serverLoaded;
}

/** Сохраняет адрес сервера; null — вернуть адрес по умолчанию из сборки. */
export async function setServerUrl(url: string | null): Promise<void> {
  if (url) await SecureStore.setItemAsync(SERVER_KEY, url, secureOptions);
  else await SecureStore.deleteItemAsync(SERVER_KEY, secureOptions);
  api.setBaseUrl(url ?? DEFAULT_API_URL);
}
