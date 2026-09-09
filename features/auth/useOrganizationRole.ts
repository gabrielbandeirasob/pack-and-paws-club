import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

export type OrganizationRole = 'manager' | 'driver';

type RoleState = { role: OrganizationRole | null; isLoading: boolean };

export function useOrganizationRole(): RoleState {
  const { session } = useAuth();
  const [state, setState] = useState<RoleState>({ role: null, isLoading: true });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!session?.user) {
        setState({ role: null, isLoading: false });
        return;
      }
      const { data } = await supabase
        .from('organization_members')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setState({ role: (data?.role as OrganizationRole | undefined) ?? null, isLoading: false });
      }
    };
    load();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  return state;
}
