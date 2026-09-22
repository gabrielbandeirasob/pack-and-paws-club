import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

export type OrganizationRole = 'manager' | 'driver';

type RoleState = { role: OrganizationRole | null; isLoading: boolean };

/**
 * Papel do usuário na organização (manager | driver).
 * Vínculo sem `status = 'active'` não conta — por isso quem foi convidado e não está ativo
 * fica sem papel nenhum (a tela precisa explicar isso, não travar).
 */
export function useOrganizationRole(): RoleState & { reload: () => void } {
  const { session } = useAuth();
  const [state, setState] = useState<RoleState>({ role: null, isLoading: true });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!session?.user) {
        setState({ role: null, isLoading: false });
        return;
      }
      setState((atual) => ({ ...atual, isLoading: true }));
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
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, tentativa]);

  const reload = useCallback(() => setTentativa((n) => n + 1), []);

  return { ...state, reload };
}
