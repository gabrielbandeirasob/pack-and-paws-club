import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { getSupabaseConfig } from '@/lib/supabaseConfig';
import { createWebStorageAdapter } from '@/lib/webStorage';

const config = getSupabaseConfig(process.env);
const storage = createWebStorageAdapter(AsyncStorage, typeof window === 'undefined');

export const supabase = createClient(config.url, config.publishableKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
