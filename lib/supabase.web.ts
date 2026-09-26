import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { getSupabaseConfig } from '@/lib/supabaseConfig';
import { criarFetchComRetryDeSessao } from '@/lib/fetchComSessao';
import { createWebStorageAdapter } from '@/lib/webStorage';

// Acesso ESTÁTICO obrigatório (ver comentário em lib/supabase.ts).
const config = getSupabaseConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});
const storage = createWebStorageAdapter(AsyncStorage, typeof window === 'undefined');

let clienteAtual: SupabaseClient | null = null;

export const supabase = createClient(config.url, config.publishableKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Recarregar a página pode disparar consulta antes do token: 401 ganha UMA segunda tentativa.
  global: {
    fetch: criarFetchComRetryDeSessao(fetch as any, async (): Promise<string | null> => {
      const { data } = await clienteAtual!.auth.getSession();
      return data.session?.access_token ?? null;
    }),
  },
});
clienteAtual = supabase;
