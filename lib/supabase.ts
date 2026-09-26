import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { getSupabaseConfig } from '@/lib/supabaseConfig';
import { criarFetchComRetryDeSessao } from '@/lib/fetchComSessao';

// ATENÇÃO: o Expo/Metro só EMBUTE variáveis EXPO_PUBLIC_* no bundle quando o acesso é
// ESTÁTICO (process.env.EXPO_PUBLIC_X). Passar o objeto `process.env` inteiro NÃO é
// inlinado -> em build de produção (TestFlight/App Store) o app abre com
// "Supabase public configuration is missing". Manter estes acessos literais.
const config = getSupabaseConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});
const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED }),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// Referência tardia: o retry de sessão precisa do PRÓPRIO cliente para ler o token, e citá-lo
// diretamente no inicializador deixa o TypeScript sem tipo (circularidade).
let clienteAtual: SupabaseClient | null = null;

export const supabase = createClient(config.url, config.publishableKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // No boot o cliente pode ainda não ter o token: 401 ganha UMA segunda tentativa (lib/fetchComSessao.ts).
  global: {
    fetch: criarFetchComRetryDeSessao(fetch as any, async (): Promise<string | null> => {
      const { data } = await clienteAtual!.auth.getSession();
      return data.session?.access_token ?? null;
    }),
  },
});
clienteAtual = supabase;

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
