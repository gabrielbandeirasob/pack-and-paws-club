/**
 * A COSTURA DO INTERRUPTOR "Drive today" COM A TRAVA DE PAPEL (27/09/2026, mesmo dia).
 *
 * Ordem dos fatos, para quem ler isso daqui a seis meses:
 *  1. entrou o interruptor (gestor que também dirige vê o app do motorista — visão, não vínculo);
 *  2. entrou a trava de papel na tela da rota (print do dono: gestor preso em "Today's Route", aba nenhuma
 *     acesa). Se a trava olhasse o VÍNCULO (`organization_members.role`), o gestor ligaria o interruptor e
 *     seria jogado de volta ao painel — as duas mudanças se anulavam. Por isso a trava olha a VISÃO;
 *  3. o dono testou e pediu o interruptor MENOR ("tomando muito espaço"), porque ele aparece em quatro
 *     telas (Home, rota, More, Perfil) — o par de frases de ajuda foi o que mais pesou.
 *
 * Este arquivo trava os três: quem está na visão certa entra, quem está na errada é devolvido, e o
 * interruptor continua sendo UMA linha com rótulo acessível (e sem as frases longas de antes).
 */
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const conta: { role: string | null; view?: string | null; canSwitchView?: boolean; isLoading: boolean } = {
  role: null,
  isLoading: false,
};
const trocas: string[] = [];
const vistas: string[] = [];

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({
    role: conta.role,
    view: conta.view,
    canSwitchView: conta.canSwitchView ?? conta.role === 'manager',
    setView: (destino: string) => vistas.push(destino),
    isLoading: conta.isLoading,
  }),
}));

jest.mock('expo-router', () => ({
  router: { replace: (destino: string) => trocas.push(destino), push: jest.fn(), back: jest.fn() },
}));

import { useRoleGuard } from '@/features/auth/useRoleGuard';
import { DriveSwitchRow } from '@/features/auth/DriveSwitchRow';

function Sonda({ esperado }: { esperado: 'manager' | 'driver' }) {
  const { liberado } = useRoleGuard(esperado);
  return <Text>{liberado ? 'liberado' : 'bloqueado'}</Text>;
}

beforeEach(() => {
  trocas.length = 0;
  vistas.length = 0;
  conta.role = null;
  conta.view = undefined;
  conta.isLoading = false;
});

describe('gestor que ligou o interruptor pode dirigir', () => {
  it('gestor com a visão de motorista abre a tela da rota', async () => {
    conta.role = 'manager';
    conta.view = 'driver';
    const tela = await render(<Sonda esperado="driver" />);
    expect(tela.getByText('liberado')).toBeTruthy();
    expect(trocas).toEqual([]);
  });

  it('gestor com o interruptor DESLIGADO é devolvido ao painel (o caso do print)', async () => {
    conta.role = 'manager';
    conta.view = 'manager';
    const tela = await render(<Sonda esperado="driver" />);
    expect(tela.getByText('bloqueado')).toBeTruthy();
    await waitFor(() => expect(trocas).toEqual(['/(tabs)']));
  });
});

describe('motorista continua como era', () => {
  it('motorista na tela da rota: liberado, sem troca', async () => {
    conta.role = 'driver';
    conta.view = 'driver';
    const tela = await render(<Sonda esperado="driver" />);
    expect(tela.getByText('liberado')).toBeTruthy();
    expect(trocas).toEqual([]);
  });

  it('motorista numa tela do escritório é devolvido para a rota', async () => {
    conta.role = 'driver';
    conta.view = 'driver';
    await render(<Sonda esperado="manager" />);
    await waitFor(() => expect(trocas).toEqual(['/(tabs)/driver']));
  });

  it('enquanto carrega, ninguém vê a tela errada nem é jogado de um lado para o outro', async () => {
    conta.role = null;
    conta.isLoading = true;
    const tela = await render(<Sonda esperado="driver" />);
    expect(tela.getByText('bloqueado')).toBeTruthy();
    expect(trocas).toEqual([]);
  });
});

describe('o interruptor ocupa menos espaço (pedido do dono depois de testar)', () => {
  it('desligado: uma linha, sem as frases longas de ajuda', async () => {
    conta.role = 'manager';
    conta.view = 'manager';
    const tela = await render(<DriveSwitchRow />);
    expect(tela.getByText('Drive today')).toBeTruthy();
    // As frases que dobravam a altura do cartão em quatro telas não existem mais.
    expect(tela.queryByText(/Turn on to see the driver app/)).toBeNull();
    expect(tela.queryByText(/You are seeing the driver app/)).toBeNull();
    // E o interruptor continua acessível para o VoiceOver.
    expect(tela.getByLabelText('Drive today')).toBeTruthy();
  });

  it('ligado: ganha só uma legenda de duas palavras', async () => {
    conta.role = 'manager';
    conta.view = 'driver';
    const tela = await render(<DriveSwitchRow />);
    expect(tela.getByText('driver view')).toBeTruthy();
    expect(tela.queryByText(/You are seeing the driver app/)).toBeNull();
  });

  it('motorista de verdade não vê interruptor nenhum', async () => {
    conta.role = 'driver';
    conta.view = 'driver';
    const tela = await render(<DriveSwitchRow />);
    expect(tela.queryByLabelText('Drive today')).toBeNull();
  });

  it('ligar/desligar troca a visão e leva para a tela do papel novo', async () => {
    conta.role = 'manager';
    conta.view = 'manager';
    const tela = await render(<DriveSwitchRow />);
    const { fireEvent } = require('@testing-library/react-native');
    await fireEvent(tela.getByLabelText('Drive today'), 'valueChange', true);
    expect(vistas).toEqual(['driver']);
    expect(trocas).toEqual(['/(tabs)/driver']);
  });
});
