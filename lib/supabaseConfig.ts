type PublicEnv = Record<string, string | undefined> & {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

export function getSupabaseConfig(env: PublicEnv) {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    throw new Error('Supabase public configuration is missing');
  }
  if (!url.startsWith('https://') || !url.endsWith('.supabase.co')) {
    throw new Error('Supabase project URL is invalid');
  }
  if (!publishableKey.startsWith('sb_publishable_')) {
    throw new Error('Only a Supabase publishable key may be used in the app');
  }
  return { url, publishableKey };
}
