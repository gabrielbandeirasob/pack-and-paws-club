import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { getSupabaseConfig } from '@/lib/supabaseConfig';
import { createWebStorageAdapter } from '@/lib/webStorage';

// Acesso ESTÁTICO obrigatório (ver comentário em lib/supabase.ts).
const config = getSupabaseConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});
const storage = createWebStorageAdapter(AsyncStorage, typeof window === 'undefined');

export const supabase = createClient(config.url, config.publishableKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
