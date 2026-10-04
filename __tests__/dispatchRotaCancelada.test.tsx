// Pedido do cliente (04/10/2026): calendário e Dispatch identificam apenas o cão; as asserções permanecem.
// A tela do Dispatch usa `useFocusEffect` — mesmo mock das outras telas de teste do projeto.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]), useRouter: () => ({ push: jest.fn() }) };
});

/**
 * ATRIBUIR DEPOIS DE CANCELAR A ROTA DO DIA (dono, 04/10/2026 — *"Agora tentei fazer o dispatch e não iam
 * para o driver"*, com dois prints: o quadro com "Gabriel · 0 stops" e a folha "Assign Ana Reyes · Ellie"
 * com o botão girando).
 *
 * MEDIDO NO BANCO DE PRODUÇÃO (04/10/2026): a única rota do dia era
 * `d2347318… · pickup · status=cancelled · lock_version=16` **com 2 paradas criadas DEPOIS do
 * cancelamento** (Ellie 11:25:16Z, Duke 11:26:42Z) — os dois toques dele.
 *
 * O caminho: o X cancela a rota e ela sai do quadro (`carregarRotas` filtra `cancelled`). Ao atribuir de
 * novo o app não acha rota viva, tenta CRIAR outra, o banco recusa (UNIQUE
 * `routes_organization_date_driver_phase_key` → 23505) e o caminho do 23505 relia a rota do dia **sem
 * olhar o status**, devolvendo a CANCELADA: a RPC gravava as paradas ali dentro e o motorista nunca
 * recebia nada (ele só lê rota `published`), com o cão continuando em UNASSIGNED.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { todayLocalISO } from '@/features/calendar/dates';
import { showAlert } from '@/features/ui/alert';
import { supabase } from '@/lib/supabase';

jest.mock('@/features/ui/alert', () => ({ showAlert: jest.fn(), confirmar: jest.fn() }));

const HOJE = todayLocalISO();
const mockReservas = [{
  id: 'r1', service_type: 'daycare' as const, start_date: HOJE, end_date: HOJE, transport_required: true,
  goes_to_daycare: true, dog: { id: 'sam', name: 'Sam', client: { id: 'casa-jose', name: 'Jose' } },
}];

/** O "banco" do dia: a rota do motorista (cancelada ou viva) e as paradas que ela tem. */
let mockRota: { id: string; lock_version: number; status: string; driver_id: string } | null = null;
let mockParadas: unknown[] = [];
/** O insert de rota SEMPRE colide (a rota do dia já existe — é o UNIQUE do banco). */
let mockInsertColide = true;
/** Registro do que o app tentou escrever (a prova do conserto). */
let mockUpdates: { tabela: string; payload: Record<string, unknown> }[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      let selecao = '';
      let operacao: 'select' | 'insert' | 'update' = 'select';
      let payloadDoUpdate: Record<string, unknown> | null = null;
      const consulta: Record<string, any> = {};
      const mesmo = () => consulta;
      for (const metodo of ['eq', 'in', 'gte', 'lte', 'limit', 'order', 'delete', 'upsert']) consulta[metodo] = mesmo;
      consulta.select = (campos: string) => { if (operacao === 'select') selecao = campos; else selecao = campos; return consulta; };
      consulta.insert = (payload: Record<string, unknown>) => { operacao = 'insert'; payloadDoUpdate = payload; return consulta; };
      consulta.update = (payload: Record<string, unknown>) => { operacao = 'update'; payloadDoUpdate = payload; return consulta; };
      consulta.single = () => {
        if (operacao === 'insert') {
          return Promise.resolve({
            data: null,
            error: mockInsertColide
              ? { code: '23505', message: 'duplicate key value violates unique constraint "routes_organization_date_driver_phase_key"' }
              : null,
          });
        }
        // A releitura da rota do dia no caminho do 23505 (com o status, que é o que faltava olhar).
        return Promise.resolve({ data: mockRota, error: null });
      };
      consulta.then = (resolver: (valor: unknown) => unknown) => {
        if (operacao === 'update' && payloadDoUpdate) {
          mockUpdates.push({ tabela, payload: payloadDoUpdate });
          if (tabela === 'routes' && payloadDoUpdate.status === 'draft' && mockRota) {
            mockRota = { ...mockRota, status: 'draft', lock_version: payloadDoUpdate.lock_version as number };
          }
          return Promise.resolve({ data: [{ id: mockRota?.id ?? 'rota', lock_version: payloadDoUpdate.lock_version }], error: null }).then(resolver);
        }
        return Promise.resolve({
          data: tabela === 'organization_members'
            ? selecao === 'organization_id' ? [{ organization_id: 'clube' }]
              : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }]
            : tabela === 'reservations' ? mockReservas
              // A rota CANCELADA existe no banco, mas o quadro não a mostra (o app filtra `cancelled`).
              : tabela === 'routes' ? (mockRota ? [{ ...mockRota, phase: 'pickup', route_stops: mockParadas }] : [])
                : [],
          error: null,
        }).then(resolver);
      };
      return consulta;
    }),
    rpc: jest.fn(async (_nome: string, args: Record<string, unknown>) => {
      // A RPC grava a parada na rota que o app entregou — seja ela viva ou cancelada.
      mockParadas = [...mockParadas, {
        dog_id: args.p_dog_id, sequence: mockParadas.length + 1, status: 'pending', priority: 'normal',
        window_start: null, window_end: null, exact_time: null,
        dog: { id: args.p_dog_id, name: 'Sam', client: { name: 'Jose', latitude: null, longitude: null } },
      }];
      return { data: null, error: null };
    }),
    channel: () => { const canal = { on: () => canal, subscribe: () => canal }; return canal; },
    removeChannel: jest.fn(),
  },
}));

const rpc = supabase.rpc as jest.Mock;
const alerta = showAlert as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockParadas = [];
  mockUpdates = [];
  mockInsertColide = true;
  mockRota = null;
});

/** Abre a folha de atribuição do Sam e confirma. */
async function atribuirSam(tela: ReturnType<typeof render> extends Promise<infer T> ? T : never) {
  await fireEvent.press(tela.getByRole('button', { name: 'Assign Sam' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Driver Rafael' }));
  await fireEvent.press(tela.getByRole('button', { name: 'Save stop' }));
}

it('rota do dia CANCELADA: atribuir REATIVA a rota em rascunho e o cão vai para a rota certa', async () => {
  // O estado real do dono: a rota do dia existe e está cancelada (o X), com o quadro em 0 stops.
  mockRota = { id: 'rota-cancelada', lock_version: 16, status: 'cancelled', driver_id: 'motorista' };

  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByRole('button', { name: 'Assign Sam' })).toBeTruthy());

  await atribuirSam(tela);

  // 1) A rota foi REATIVADA como rascunho (com a trava de versão do quadro).
  await waitFor(() => expect(mockUpdates.some(
    (linha) => linha.tabela === 'routes' && linha.payload.status === 'draft',
  )).toBe(true));

  // 2) A parada foi para a rota do DIA (a que foi reativada) — não para uma rota inventada.
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('assign_stop_to_route', expect.objectContaining({
    p_route_id: 'rota-cancelada', p_dog_id: 'sam',
  })));

  // 3) O gestor é AVISADO de que a rota voltou como rascunho e precisa ser publicada.
  await waitFor(() => expect(alerta).toHaveBeenCalledWith('Route reactivated', expect.stringContaining('draft')));
  tela.unmount();
});

it('a escrita que não vira parada em quadro VAZIO não fecha a folha em silêncio', async () => {
  /*
   * O quadro de quem cancelou a rota do dia tem ZERO rotas vivas. A conferência antiga saía cedo nesse
   * caso (`routesRef.current.length === 0` lido como "sem dados"), então a folha FECHAVA como se tivesse
   * atribuído — foi o que o dono viu: "não iam para o driver" e nenhuma mensagem.
   */
  mockRota = { id: 'rota-cancelada', lock_version: 16, status: 'cancelled', driver_id: 'motorista' };
  mockInsertColide = true;

  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByRole('button', { name: 'Assign Sam' })).toBeTruthy());

  // A RPC "dá certo" mas o banco não fica com a parada do cão (nenhuma parada volta na recarga).
  rpc.mockResolvedValueOnce({ data: null, error: null });
  await atribuirSam(tela);

  // A folha continua aberta, dizendo o que aconteceu — nada de fechar calada.
  await waitFor(() => expect(tela.getByRole('button', { name: 'Save stop' })).toBeTruthy());
  tela.unmount();
});
