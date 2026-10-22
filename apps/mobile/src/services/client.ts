import * as SecureStore from 'expo-secure-store';
import { ApiClient, type TokenStore } from '../lib/api';
import type { Tokens } from '../lib/types';

/**
 * Адрес API задаётся при сборке через EXPO_PUBLIC_API_URL.
 * По умолчанию — локальный сервер (для эмулятора Android: http://10.0.2.2:3000).
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const TOKENS_KEY = 'blink.tokens';

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
export const api = new ApiClient(API_URL, secureTokenStore);
