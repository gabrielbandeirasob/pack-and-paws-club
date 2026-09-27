/**
 * INTERRUPTOR "Drive today" — gestor ↔ motorista (áudio do dono, 27/09/2026).
 *
 * "todo administrador consegue ser, se ele quiser ou tiver necessidade de ser um driver… na conta do
 * administrador ele consegue ter tipo um switch on and off que muda entre a dashboard do administrador
 * para a dashboard do driver, tipo o alarme do iPhone… porque o administrador também faz os pick-ups e
 * drop-off, então para o administrador não tem que ficar deslogando e logando".
 *
 * ONDE ELE VIVE: topo da Home do gestor, topo da tela Today's Route (para voltar), menu "More" e Perfil.
 *
 * COMO ELE É DESENHADO (pedido do dono, 27/09/2026, depois de testar: *"só que tomando muito espaço,
 * faça de uma forma que esse switch ocupe menos espaço"*):
 *  * UMA linha fina — desligado não tem legenda nenhuma; ligado, uma legenda de 10,5 px ("driver view");
 *  * o próprio Switch do iPhone encolhido em 20% (transform) — nada de botão inventado;
 *  * some o par de frases que existia antes ("Turn on to see the driver app…" / "You are seeing the
 *    driver app…"): era isso que dobrava a altura do cartão em cada uma das quatro telas;
 *  * no menu "More" ele entra SEM caixa e SEM margem (`dentroDeLista`), alinhado às outras linhas.
 *
 * O que ele faz não mudou: troca a VISÃO (as abas seguem na hora, estado compartilhado no
 * `activeRoleStore`) e leva para a tela do papel novo. O vínculo no banco não muda, a sessão não é
 * refeita, e quem é motorista de verdade nunca vê o interruptor (`canSwitchView`).
 */
import { StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';

import { useOrganizationRole } from '@/features/auth/useOrganizationRole';
import { landingRouteForView } from '@/features/navigation/roleTabs';
import { colors, radii } from '@/features/theme/tokens';

type Props = {
  /** Dentro de uma lista (menu "More"): sem caixa, sem borda e sem margem extra. */
  dentroDeLista?: boolean;
};

export function DriveSwitchRow({ dentroDeLista = false }: Props) {
  const { view, canSwitchView, setView } = useOrganizationRole();

  // Motorista não troca de visão: o interruptor é do gestor (mão única, regra do módulo puro).
  if (!canSwitchView) return null;

  const dirigindo = view === 'driver';

  return (
    <View style={[styles.row, dentroDeLista ? styles.semCaixa : null]}>
      <Text style={styles.title}>Drive today</Text>
      {dirigindo ? <Text style={styles.hint}>driver view</Text> : null}
      <View style={styles.spacer} />
      <Switch
        accessibilityLabel="Drive today"
        value={dirigindo}
        onValueChange={(ligado) => {
          const destino = ligado ? 'driver' : 'manager';
          setView(destino);
          router.replace(landingRouteForView(destino));
        }}
        trackColor={{ false: '#D1D1D6', true: colors.forest700 }}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#D1D1D6"
        style={styles.switch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.paper,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  semCaixa: { backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0, marginTop: 0, paddingHorizontal: 18 },
  title: { color: colors.ink, fontWeight: '800', fontSize: 13.5 },
  hint: { color: colors.muted, fontSize: 10.5 },
  spacer: { flex: 1 },
  /** O Switch do iPhone reduzido: ocupa menos altura e continua o componente nativo (acessível). */
  switch: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
});
