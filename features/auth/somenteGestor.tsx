import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRoleGuard } from '@/features/auth/useRoleGuard';
import { colors } from '@/features/theme/tokens';

/**
 * TRAVA DE PAPEL das telas do GESTOR — o motorista não entra por link.
 *
 * Achado da varredura de 16/10/2026: só `calendar.tsx` e `driver.tsx` tinham trava; as outras telas do
 * gestor eram alcançáveis por URL direta (no build web, por deep link ou por notificação) e PINTAVAM
 * conteúdo para o motorista — `Day summary` (com o faturamento do dia), `Clients` (lista de lares com
 * telefone e endereço), `Dispatch`, `Van & yard`, `Activity`, `Driver hours`. É a mesma família do
 * defeito que gerou a trava do Calendar (05/10/2026): "a aba estar escondida" não é proteção.
 *
 * Uso (uma linha antes do `return` principal — depois de TODOS os hooks, senão o React acusa
 * "rendered fewer hooks than expected" quando a visão carrega):
 *
 *   const bloqueioDePapel = useSomenteGestor();
 *   if (bloqueioDePapel) return bloqueioDePapel;
 *
 * Conta sem vínculo ativo (papel nulo) para na frase, em vez de girar para sempre (lição da vistoria
 * de 02/10/2026 na tela do motorista).
 */
export function useSomenteGestor(testeId = 'papel-bloqueado'): ReactNode | null {
  const { liberado, role, isLoading } = useRoleGuard('manager');

  if (liberado) return null;

  if (isLoading || role !== null) {
    return (
      <SafeAreaView style={estilos.tela} edges={['top']}>
        <ActivityIndicator testID={testeId} style={estilos.margem} color={colors.gold} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={estilos.tela} edges={['top']}>
      <ScrollView contentContainerStyle={estilos.margem}>
        <Text style={estilos.titulo}>This account has no daycare</Text>
        <Text style={estilos.texto}>
          Your login is not linked to an active daycare. Ask the manager to invite this e-mail again,
          or sign in with the account you use there.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: colors.forest700 },
  margem: { padding: 24, marginTop: 60 },
  titulo: { color: 'white', fontFamily: 'serif', fontSize: 24, fontWeight: '800' },
  texto: { color: colors.cream, fontSize: 14, marginTop: 12, lineHeight: 20 },
});
