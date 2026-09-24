import React from 'react';
import { Share } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

/**
 * Tela do gestor "Driver hours" — pedido do cliente (audio de 16/09/2026): ver por motorista a
 * primeira entrada, a ultima saida e o tempo total, na tela e exportavel.
 *
 * O numero do dia vem dos marcos da ROTA (carimbados no servidor) e dos registros MANUAIS.
 */
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined, back: () => undefined }),
}));

const ORG = 'c0af17d6-7b2a-49f2-b78e-3263ca346c33';

jest.mock('@/lib/supabase', () => {
  const membros = [
    // A consulta pede o alias `profile:profiles(full_name)` — a resposta vem na chave `profile`.
    { user_id: 'd1', role: 'driver', profile: { full_name: 'Rafael' } },
    { user_id: 'd2', role: 'driver', profile: { full_name: 'Jordan' } },
  ];
  // A rota NAO traz `profile`: no banco de verdade `routes.driver_id` aponta para auth.users e o
  // embed `profiles(full_name)` devolve 400 PGRST200. O nome tem de vir do mapa de membros.
  const rotas = [
    {
      id: 'r1',
      driver_id: 'd1',
      route_date: '2026-09-23',
      route_stops: [
        { id: 's1', sequence: 1, status: 'completed', arrived_at: '2026-09-23T11:10:00.000Z', picked_up_at: null, completed_at: '2026-09-23T11:30:00.000Z', skipped_at: null },
        { id: 's2', sequence: 2, status: 'completed', arrived_at: '2026-09-23T12:00:00.000Z', picked_up_at: null, completed_at: '2026-09-23T14:40:00.000Z', skipped_at: null },
      ],
    },
  ];
  const jornadas = [
    { id: 'j1', driver_id: 'd2', route_id: null, started_at: '2026-09-23T09:00:00.000Z', ended_at: '2026-09-23T10:30:00.000Z', start_reason: 'Covered the morning run', end_reason: 'Handed the van over' },
  ];
  /** O que cada consulta pediu — é aqui que se prova que a rota não pede embed de `profiles`. */
  const selecoes: { tabela: string; colunas: string }[] = [];
  return {
    __selecoes: selecoes,
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (tabela: string) => {
        let colunas = '';
        const escolher = () => {
          if (tabela === 'organization_members') return colunas.includes('organization_id') ? [{ organization_id: ORG }] : membros;
          if (tabela === 'driver_shifts') return jornadas;
          return rotas;
        };
        const chain: Record<string, unknown> = {};
        chain.select = (c: string) => {
          colunas = c;
          selecoes.push({ tabela, colunas: c });
          return chain;
        };
        chain.eq = () => chain;
        chain.gte = () => chain;
        chain.lte = () => chain;
        chain.lt = () => chain;
        chain.limit = () => chain;
        chain.order = () => chain;
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: escolher(), error: null }).then(res);
        return chain;
      },
    },
  };
});

describe('Driver hours (tela do gestor)', () => {
  it('mostra entrada, saida e tempo total de quem fez rota', async () => {
    const Tela = require('../app/driver-hours').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText('Driver hours')).toBeTruthy());
    expect(tela.getByText('Rafael')).toBeTruthy();
    expect(tela.getByText('3h30')).toBeTruthy();
  });

  it('mostra a jornada MANUAL com selo e o nome do motorista sem rota', async () => {
    const Tela = require('../app/driver-hours').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText('Jordan')).toBeTruthy());
    expect(tela.getByText('MANUAL · 1')).toBeTruthy();
    expect(tela.getByText('1h30')).toBeTruthy();
  });

  it('exporta a planilha em CSV com cabecalho e o tempo total', async () => {
    const compartilhar = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const Tela = require('../app/driver-hours').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByLabelText('Export spreadsheet')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Export spreadsheet'));

    await waitFor(() => expect(compartilhar).toHaveBeenCalled());
    const enviado = compartilhar.mock.calls[0][0] as { message: string };
    expect(enviado.message).toContain('day;driver;in;out;total;total_minutes;manual_shifts');
    expect(enviado.message).toContain('2026-09-23;Rafael');
    expect(enviado.message).toContain('3h30;210;0');
    expect(enviado.message).toContain('Jordan');
    expect(enviado.message).toContain('1h30;90;1');
    compartilhar.mockRestore();
  });

  /**
   * Regressao do erro de producao: `routes` nao tem FK para `profiles` (o driver_id aponta para
   * auth.users), entao pedir `profile:profiles(full_name)` na consulta das rotas devolvia
   * `400 PGRST200` — o `throw` subia no load() e a tela ficava SEM DADOS (nem erro na tela).
   * O nome do motorista vem do mapa de `loadDriverNames()`, que usa a FK que existe.
   */
  it('nao pede o embed de profiles nas rotas e ainda mostra o nome do motorista', async () => {
    const banco = jest.requireMock('@/lib/supabase') as { __selecoes: { tabela: string; colunas: string }[] };
    banco.__selecoes.length = 0;

    const Tela = require('../app/driver-hours').default;
    const tela = await render(<Tela />);

    const consultaDeRotas = banco.__selecoes.find((s) => s.tabela === 'routes');
    expect(consultaDeRotas).toBeDefined();
    expect(consultaDeRotas?.colunas).not.toContain('profiles');
    expect(consultaDeRotas?.colunas).toContain('route_stops');

    // O nome continua na tela — vindo do mapa de membros, nao do embed.
    await waitFor(() => expect(tela.getByText('Rafael')).toBeTruthy());
    expect(tela.queryByText('Driver')).toBeNull();
  });
});
