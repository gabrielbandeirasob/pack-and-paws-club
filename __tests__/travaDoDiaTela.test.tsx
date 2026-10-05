/**
 * TRAVA DO DIA DA OPERAÇÃO (migração 202610020050) — a TELA do gestor ligada à versão do dia.
 *
 * Dois gestores no mesmo dia: o segundo salva, o primeiro (tela velha) tenta salvar de novo e o
 * banco RECUSA (`stale_day`). Antes desta correção a tela recarregava CALADA e ninguém era avisado.
 * Aqui se prova: a gravação recusada mostra o AVISO EM PORTUGUÊS e o dia é RECARREGADO.
 */
let mockFoco: (() => void | (() => void)) | null = null;
/** Linhas devolvidas por tabela (leitura) — mesma convenção dos testes da Home. */
let mockRows: Record<string, unknown> = {};
/** Quando setado, TODA escrita devolve este erro (simula o gatilho `dia_sem_sobrescrita`). */
let mockErroEscrita: { message: string } | null = null;
/** Quantas vezes o plano do dia foi LIDO — prova que a tela recarregou. */
let mockLeiturasPlano = 0;

jest.mock('expo-router', () => {
  const React = require('react') as typeof import('react');
  return {
    useRouter: () => ({ replace: () => undefined, push: () => undefined }),
    useFocusEffect: (callback: () => void) => {
      mockFoco = callback;
      React.useEffect(callback, [callback]);
    },
  };
});

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'manager', view: 'manager', isLoading: false }),
}));

jest.mock('@/lib/supabase', () => {
  const chainFor = (name: string) => {
    const chain: any = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: mockRows[name] ?? null, error: null }).then(resolve);
          }
          if (prop === 'maybeSingle') {
            if (name === 'daily_plans') mockLeiturasPlano += 1;
            return () => Promise.resolve({ data: (mockRows[name] as unknown[] | undefined)?.[0] ?? null, error: null });
          }
          // Escrita (upsert/update/insert/delete): .select('id') devolve o erro combinado quando há recusa.
          if (prop === 'upsert' || prop === 'update' || prop === 'insert' || prop === 'delete') {
            return () => ({
              select: () =>
                Promise.resolve(
                  mockErroEscrita ? { data: null, error: mockErroEscrita } : { data: [{ id: 'row' }], error: null },
                ),
            });
          }
          return () => chain;
        },
      },
    );
    return chain;
  };
  return {
    supabase: {
      from: (name: string) => chainFor(name),
      channel: () => ({ on: () => ({ subscribe: () => undefined }), unsubscribe: () => undefined }),
      removeChannel: () => undefined,
      auth: { getUser: async () => ({ data: { user: { id: 'manager-1', email: 'raphael@autonestmobile.com' } } }) },
    },
  };
});

// eslint-disable-next-line import/first
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import HomeScreen from '@/app/(tabs)/index';
import { AVISO_DIA_ALTERADO } from '@/features/dashboard/dayService';

const RECUSA_STALE =
  'Another device changed this day while you were editing (day version 2, your copy was 1). Reload the screen and save again.';
const hoje = new Date().toISOString().slice(0, 10);

function baseRows(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organization_members: [{ organization_id: 'org-1', user_id: 'manager-1', profiles: { full_name: 'Raphael' } }],
    profiles: [{ full_name: 'Raphael' }],
    reservations: [],
    recurring_schedules: [],
    recurring_exceptions: [],
    routes: [],
    driver_locations: [],
    daily_plans: [],
    daily_todos: [],
    pack_entries: [],
    organization_locations: [],
    ...extra,
  };
}

/** Todos os textos passados ao Alert (título e mensagem) das chamadas até agora. */
function textosDeAlerta(): string[] {
  return AlertaSpy.mock.calls.flat().filter((valor): valor is string => typeof valor === 'string');
}
let AlertaSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockFoco = null;
  mockErroEscrita = null;
  mockLeiturasPlano = 0;
  mockRows = baseRows();
  AlertaSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  AlertaSpy.mockRestore();
});

describe('stale_day — a tela avisa em PT-BR e recarrega', () => {
  it('plano do dia recusado: mostra o aviso em português e relê o dia', async () => {
    mockRows = baseRows({
      daily_plans: [{ id: 'p1', revenue_cents: null, walk_location: null, photo_idea: null, lock_version: 1 }],
    });
    const tela = await render(<HomeScreen />);
    // REVELAÇÃO PROGRESSIVA (dono, 05/10/2026): o "Edit" revela os campos do plano do dia.
    await waitFor(() => expect(tela.getByLabelText('Edit the day plan')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Edit the day plan'));
    await waitFor(() => expect(tela.getByLabelText('Walk location of the day')).toBeTruthy());
    const leiturasAntes = mockLeiturasPlano;

    await fireEvent.changeText(tela.getByLabelText('Walk location of the day'), 'Golden Gate Park');

    // Outro aparelho já gravou: o banco recusa a gravação da tela velha.
    mockErroEscrita = { message: RECUSA_STALE };
    await fireEvent.press(tela.getByRole('button', { name: 'Save the day plan' }));

    await waitFor(() => expect(textosDeAlerta()).toContain(AVISO_DIA_ALTERADO));
    await waitFor(() => expect(mockLeiturasPlano).toBeGreaterThan(leiturasAntes));
  });

  it('X do pack recusado: também mostra o aviso em português e recarrega', async () => {
    mockRows = baseRows({
      reservations: [
        {
          id: 'r1',
          service_type: 'daycare',
          start_date: hoje,
          end_date: hoje,
          transport_required: true,
          goes_to_daycare: true,
          dog: { id: 'd1', name: 'Mowgli', client: { name: 'Maria Silva' } },
        },
      ],
      pack_entries: [{ dog_id: 'd1', in_pack: true, walker_id: null, lock_version: 1 }],
    });
    const tela = await render(<HomeScreen />);
    await waitFor(() => expect(tela.getByLabelText('Total Pack — open the pack of the day')).toBeTruthy());

    await act(async () => {
      fireEvent.press(tela.getByLabelText('Total Pack — open the pack of the day'));
    });
    await waitFor(() => expect(tela.getByLabelText('Remove Mowgli from the pack')).toBeTruthy());

    mockErroEscrita = { message: RECUSA_STALE };
    await fireEvent.press(tela.getByLabelText('Remove Mowgli from the pack'));

    await waitFor(() => expect(textosDeAlerta()).toContain(AVISO_DIA_ALTERADO));
  });
});
