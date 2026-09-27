import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  assinarVisaoAtiva,
  obterVisaoAtiva,
  lerVisaoAtiva,
  podeAlternarVisao,
  salvarVisaoAtiva,
  visaoEfetiva,
  type ActiveView,
} from '@/features/auth/activeRoleStore';

export type OrganizationRole = 'manager' | 'driver';

type RoleState = {
  role: OrganizationRole | null;
  isLoading: boolean;
  /**
   * VISÃO que o app deve mostrar agora (interruptor gestor↔motorista, áudio de 27/09/2026).
   * Igual ao papel, exceto quando um GESTOR liga o interruptor para dirigir: aí vira 'driver' sem
   * deslogar e sem mudar o vínculo no banco.
   */
  view: ActiveView | null;
  /** O interruptor existe para este usuário? (só gestor) */
  canSwitchView: boolean;
  /** Liga/desliga a visão de motorista (guarda no aparelho). */
  setView: (view: ActiveView) => void;
};

/**
 * Papel do usuário na organização (manager | driver).
 * Vínculo sem `status = 'active'` não conta — por isso quem foi convidado e não está ativo
 * fica sem papel nenhum (a tela precisa explicar isso, não travar).
 */
export function useOrganizationRole(): RoleState & { reload: () => void } {
  const { session } = useAuth();
  const [state, setState] = useState<{ role: OrganizationRole | null; isLoading: boolean }>(
    { role: null, isLoading: true },
  );
  const [tentativa, setTentativa] = useState(0);

  const escolhida = useSyncExternalStore(assinarVisaoAtiva, obterVisaoAtiva, obterVisaoAtiva);
  const [visaoCarregada, setVisaoCarregada] = useState(false);

  // Aguarda a leitura compartilhada do aparelho antes de liberar a navegação.
  useEffect(() => {
    let cancelado = false;
    lerVisaoAtiva().then(() => {
      if (!cancelado) setVisaoCarregada(true);
    });
    return () => {
      cancelado = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!session?.user) {
        setState((atual) => ({ ...atual, role: null, isLoading: false }));
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
        setState((atual) => ({
          ...atual,
          role: (data?.role as OrganizationRole | undefined) ?? null,
          isLoading: false,
        }));
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, tentativa]);

  const reload = useCallback(() => setTentativa((n) => n + 1), []);

  const setView = useCallback(
    (view: ActiveView) => {
      // Mão única: motorista não vira gestor pelo interruptor (a regra de verdade está no módulo puro).
      if (!podeAlternarVisao(state.role)) return;
      void salvarVisaoAtiva(view);
    },
    [state.role],
  );

  return {
    role: state.role,
    isLoading: state.isLoading || !visaoCarregada,
    view: visaoEfetiva(state.role, escolhida),
    canSwitchView: podeAlternarVisao(state.role),
    setView,
    reload,
  };
}
