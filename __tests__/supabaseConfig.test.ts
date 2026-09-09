import { getSupabaseConfig } from '@/lib/supabaseConfig';

describe('Supabase public configuration', () => {
  it('returns a valid project URL and publishable key', () => {
    expect(getSupabaseConfig({
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    })).toEqual({
      url: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_example',
    });
  });

  it('rejects missing or non-publishable configuration', () => {
    expect(() => getSupabaseConfig({})).toThrow('Supabase public configuration is missing');
    expect(() => getSupabaseConfig({
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'service_role_secret',
    })).toThrow('Only a Supabase publishable key may be used in the app');
  });
});
