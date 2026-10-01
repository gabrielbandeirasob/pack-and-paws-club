import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

/**
 * Tela "Today's progress" — pedido do cliente (22/09/2026): ver nas duas rotas quais
 * cães já foram pegos/concluídos no dia, com a hora da marcação.
 */
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined, back: () => undefined }),
  // A tela lê o dia de `?day=` (navegação por dia, 27/09/2026); sem parâmetro ela cai em hoje.
  useLocalSearchParams: () => ({ day: '2026-09-26' }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (require('react') as typeof React).useEffect(() => {
      const cleanup = callback();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, []);
  },
}));

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'manager', isLoading: false, reload: () => undefined }),
}));

const ORG = 'c0af17d6-7b2a-49f2-b78e-3263ca346c33';

jest.mock('@/lib/supabase', () => {
  const resultados: Record<string, unknown> = {
    'organization_members|organization_id': [{ organization_id: ORG }],
    'organization_members|profiles': [{ user_id: 'd1', profiles: { full_name: 'Rafael' } }],
    'routes|route_stops': [
      {
        id: 'r1',
        driver_id: 'd1',
        status: 'published',
        route_stops: [
          // `updated_at` (metadado da LINHA) é velho de propósito: é o valor que a tela lia por
          // engano antes da correção de 26/09/2026. `status_updated_at` é o carimbo do estado.
          { id: 's1', sequence: 1, status: 'completed', updated_at: '2026-09-25T16:06:00.000Z', status_updated_at: '2026-09-22T14:05:00.000Z', window_end: null, exact_time: null, dog: { name: 'Bella' } },
          { id: 's2', sequence: 2, status: 'picked_up', updated_at: '2026-09-25T16:06:00.000Z', status_updated_at: '2026-09-22T14:20:00.000Z', window_end: null, exact_time: null, dog: { name: 'Thor' } },
          // Parada pendente com prazo às 14:50: no relógio congelado do teste do desempenho (15:00)
          // ela está 10 min fora do prazo — MUITO além da tolerância de 3 min.
          { id: 's3', sequence: 3, status: 'pending', updated_at: '2026-09-25T16:06:00.000Z', status_updated_at: null, window_end: null, exact_time: '14:50', dog: { name: 'Mel' } },
        ],
      },
    ],
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (tabela: string) => {
        let colunas = '';
        const escolher = () => (colunas.includes('organization_id') ? resultados['organization_members|organization_id'] : colunas.includes('profiles') ? resultados['organization_members|profiles'] : resultados['routes|route_stops']);
        const chain: Record<string, unknown> = {};
        chain.select = (c: string) => {
          colunas = c;
          return chain;
        };
        chain.eq = () => chain;
        chain.limit = () => chain;
        // o cliente resolve { data, error } — devolver o array cru fazia a tela achar que nao havia vinculo
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: escolher(), error: null }).then(res);
        return chain;
      },
    },
  };
});

describe("Today's progress", () => {
  it('lista as duas rotas com estado e hora de cada cão', async () => {
    const Tela = require('../app/day-progress').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText("Today's progress")).toBeTruthy());

    expect(tela.getByText('Rafael')).toBeTruthy();
    expect(tela.getByText('3 stops')).toBeTruthy();
    expect(tela.getByText('Bella')).toBeTruthy();
    expect(tela.getByText('Completed')).toBeTruthy();
    expect(tela.getByText('Thor')).toBeTruthy();
    expect(tela.getByText('Picked up')).toBeTruthy();
    expect(tela.getByText('Mel')).toBeTruthy();
    expect(tela.getByText('Waiting')).toBeTruthy();
    // resumo do dia: 1 concluído de 3 (o "picked up" ainda não conta como resolvido)
    expect(tela.getByText('1 of 3 dogs done · 2 left')).toBeTruthy();
  });

  it('a hora mostrada é a da MARCAÇÃO (status_updated_at), não a última alteração da linha', async () => {
    // DEFEITO de 26/09/2026: a tela lia `updated_at` (metadado da linha, congelado em 25/09 16:06) e
    // o gestor via "16:06" em toda parada, mesmo com o motorista marcando às 13:23. O carimbo certo
    // é o `status_updated_at` que o trigger do banco mantém.
    const Tela = require('../app/day-progress').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText('14:05')).toBeTruthy());
    expect(tela.getByText('14:20')).toBeTruthy();
    expect(tela.queryByText('16:06')).toBeNull();
  });

  /**
   * DESEMPENHO POR MOTORISTA (pedido do dono, 30/09/2026): paradas concluídas × total, quantas com
   * problema, o atraso JÁ com a tolerância de 3 min e a última atualização — no cartão que já
   * existia, sem consulta nova ao banco.
   */
  it('mostra o desempenho do motorista no cartão da rota', async () => {
    // Relógio congelado: a parada pendente tem prazo às 14:50, então às 15:00 ela está atrasada.
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 26, 15, 0));
    try {
      const Tela = require('../app/day-progress').default;
      const tela = await render(<Tela />);

      await waitFor(() => expect(tela.getByText('1 of 3 done · 1 late · last update 14:20')).toBeTruthy());
      // O resumo do dia continua sendo o de sempre (nada de redesenhar a tela).
      expect(tela.getByText('1 of 3 dogs done · 2 left')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('sem ninguém fora do prazo, o cartão diz só o que aconteceu (sem inventar atraso)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 26, 14, 0)); // 14:00: o prazo das 14:50 ainda não chegou
    try {
      const Tela = require('../app/day-progress').default;
      const tela = await render(<Tela />);

      await waitFor(() => expect(tela.getByText('1 of 3 done · last update 14:20')).toBeTruthy());
    } finally {
      jest.useRealTimers();
    }
  });
});
