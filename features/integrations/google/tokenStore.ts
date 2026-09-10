/**
 * Cofre dos tokens do Google no aparelho (expo-secure-store → Keychain no iOS).
 * O refresh token fica SOMENTE aqui: nunca vai para o banco, nem para o bundle.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'packpaws.google.tokens.v1';

export type StoredTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch em ms. */
  expiresAt: number;
  email?: string | null;
};

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), { keychainAccessible: SecureStore.WHEN_UNLOCKED });
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredTokens;
    return parsed?.refreshToken || parsed?.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export function isExpired(tokens: StoredTokens, skewMs = 60_000): boolean {
  return Date.now() + skewMs >= tokens.expiresAt;
}
