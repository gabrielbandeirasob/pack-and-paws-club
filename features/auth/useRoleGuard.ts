import { useEffect } from 'react';
import { router } from 'expo-router';

import { useOrganizationRole, type OrganizationRole } from '@/features/auth/useOrganizationRole';

/** Onde cada papel deve ficar. */
export function rotaDoPapel(role: OrganizationRole): string {
  return role === 'driver' ? '/(tabs)/driver' : '/(tabs)';
}

/**
 * TRAVA DE PAPEL — a tela do motorista só abre para motorista (e a do gestor, para gestor).
 *
 * Motivo (print do dono, 27/09/2026): o app do GESTOR apareceu na tela "Today's Route" dizendo
 * *"No published route today"*, com a barra de abas do gestor e **nenhuma aba acesa** — o estado em que
 * nada "faz a troca". Acontece quando o aparelho troca de conta (motorista → gestor, ou o contrário) ou
 * quando alguém cai na rota por link: a ROTA aberta continua sendo a antiga e a tela deixa de conferir
 * com o papel. Aqui a tela errada devolve o usuário para o app que é dele.
 *
 * `liberado` só é `true` com o papel certo e já carregado — quem usa deve mostrar o carregando enquanto
 * for `false`, para nunca pintar a tela errada.
 */
export function useRoleGuard(esperado: OrganizationRole): { role: OrganizationRole | null; liberado: boolean } {
  const { role, isLoading } = useOrganizationRole();
  const liberado = !isLoading && role === esperado;

  useEffect(() => {
    if (isLoading || !role || role === esperado) return;
    router.replace(rotaDoPapel(role) as never);
  }, [isLoading, role, esperado]);

  return { role, liberado };
}
