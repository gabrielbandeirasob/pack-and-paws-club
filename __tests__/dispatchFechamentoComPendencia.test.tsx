import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';
import { supabase } from '@/lib/supabase';

/**
 * Fechar ("Done") ou despublicar tira a rota da tela do motorista (ele só lê rota `published`).
 * Com parada pendente, a tela NÃO pode escrever o status antes do ok do gestor — e o aviso tem de
 * dizer quantas paradas são e QUAIS cães ficam sem a rota. Incidente de 30/09/2026: o gestor publicou
 * e, 1 segundo depois, a rota virou `completed` com as 3 paradas todas `pending`; o motorista ficou
 * sem a rota do dia, sem aviso.
 */

const paradasDe = (statuses: string[]) => statuses.map((status, indice) => ({
  dog_id: `dog-${indice}`, sequence: indice + 1, status, priority: 'normal',
  window_start: null, window_end: null, exact_time: null,
  dog: { id: `dog-${indice}`, name: ['Luna', 'Max', 'Filó'][indice], client: { name: 'Sarah', latitude: null, longitude: null } },
}));

let mockParadas = paradasDe(['pending', 'pending', 'pending']);
let mockStatus = 'published';
let mockAtualizacoes: Record<string, unknown>[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'gestor' } } })) },
    from: jest.fn((tabela: string) => {
      let selecao = '';
      const consulta: Record<string, any> = {};
      consulta.update = (valores: Record<string, unknown>) => {
        if (tabela === 'routes') mockAtualizacoes.push(valores);
        return consulta;
      };
      for (const metodo of ['select', 'eq', 'in', 'limit', 'order', 'delete', 'single']) {
        consulta[metodo] = (...args: unknown[]) => {
          if (metodo === 'select') selecao = args[0] as string;
          return consulta;
        };
      }
      consulta.then = (resolver: (valor: unknown) => unknown) => Promise.resolve({
        data: tabela === 'organization_members'
          ? selecao === 'organization_id' ? [{ organization_id: 'clube' }]
            : [{ user_id: 'motorista', role: 'driver', profiles: { full_name: 'Rafael' } }]
          : tabela === 'routes' ? [{
            id: 'rota', driver_id: 'motorista', status: mockStatus, lock_version: 4, route_stops: mockParadas,
          }] : [], error: null,
      }).then(resolver);
      return consulta;
    }),
    rpc: jest.fn(),
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: jest.fn(),
  },
}));

let alerta: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockParadas = paradasDe(['pending', 'pending', 'pending']);
  mockStatus = 'published';
  mockAtualizacoes = [];
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alerta.mockRestore());

async function montar() {
  const tela = await render(<DispatchScreen />);
  await waitFor(() => expect(tela.getByLabelText('Complete Rafael route')).toBeTruthy());
  return tela;
}

describe('fechar rota com paradas pendentes', () => {
  it('não escreve o status antes do ok e diz quantas paradas e quais cães ficam sem o motorista', async () => {
    const tela = await montar();
    await fireEvent.press(tela.getByLabelText('Complete Rafael route'));

    expect(mockAtualizacoes).toHaveLength(0);
    expect(alerta).toHaveBeenCalledTimes(1);
    const [titulo, mensagem, botoes] = alerta.mock.calls[0] as [string, string, AlertButton[]];
    expect(titulo).toBe('Close this route?');
    expect(mensagem).toContain('3 stops still pending: Luna, Max, Filó');
    expect(mensagem).toContain('The driver will no longer see this route on his phone.');
    expect(botoes.map((botao) => botao.text)).toEqual(['Cancel', 'Close route']);
  });

  it('cancelar não muda nada', async () => {
    const tela = await montar();
    await fireEvent.press(tela.getByLabelText('Complete Rafael route'));
    const botoes = alerta.mock.calls[0][2] as AlertButton[];
    await act(async () => { botoes[0].onPress?.(); });
    expect(mockAtualizacoes).toHaveLength(0);
  });

  it('depois do ok fecha com status completed', async () => {
    const tela = await montar();
    await fireEvent.press(tela.getByLabelText('Complete Rafael route'));
    const botoes = alerta.mock.calls[0][2] as AlertButton[];
    await act(async () => { botoes[1].onPress?.(); });
    await waitFor(() => expect(mockAtualizacoes).toHaveLength(1));
    expect(mockAtualizacoes[0]).toMatchObject({ status: 'completed' });
  });
});

describe('despublicar rota com paradas pendentes', () => {
  it('pergunta antes e só volta para rascunho depois do ok', async () => {
    const tela = await montar();
    await fireEvent.press(tela.getByLabelText('Unpublish Rafael route'));

    expect(mockAtualizacoes).toHaveLength(0);
    expect(alerta).toHaveBeenCalledTimes(1);
    const [titulo, mensagem, botoes] = alerta.mock.calls[0] as [string, string, AlertButton[]];
    expect(titulo).toBe('Unpublish this route?');
    expect(mensagem).toContain('3 stops still pending: Luna, Max, Filó');
    expect(mensagem).toContain('The driver will no longer see this route on his phone.');
    expect(botoes.map((botao) => botao.text)).toEqual(['Cancel', 'Unpublish']);

    await act(async () => { botoes[1].onPress?.(); });
    await waitFor(() => expect(mockAtualizacoes).toHaveLength(1));
    expect(mockAtualizacoes[0]).toMatchObject({ status: 'draft', published_at: null });
  });
});

describe('rota sem pendências', () => {
  it('fecha direto, sem confirmação', async () => {
    mockParadas = paradasDe(['completed', 'skipped', 'completed']);
    const tela = await montar();
    await fireEvent.press(tela.getByLabelText('Complete Rafael route'));
    await waitFor(() => expect(mockAtualizacoes).toHaveLength(1));
    expect(mockAtualizacoes[0]).toMatchObject({ status: 'completed' });
    expect(alerta).not.toHaveBeenCalled();
  });

  it('despublica direto, sem confirmação', async () => {
    mockParadas = paradasDe(['completed', 'completed', 'skipped']);
    const tela = await montar();
    await fireEvent.press(tela.getByLabelText('Unpublish Rafael route'));
    await waitFor(() => expect(mockAtualizacoes).toHaveLength(1));
    expect(mockAtualizacoes[0]).toMatchObject({ status: 'draft', published_at: null });
    expect(alerta).not.toHaveBeenCalled();
  });
});
