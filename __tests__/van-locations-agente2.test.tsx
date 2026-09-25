/**
 * VETORES DO AGENTE2 — TELA DO GESTOR "Van & yard" (item 2 do documento de pedidos da operação:
 * "a posição de cada driver começar vai ser definida pela administradora").
 *
 * O que este arquivo prova:
 *  - a lista mostra as sedes da organização com o selo da PADRÃO e o raio;
 *  - organização sem sede vê o texto que promete o comportamento de hoje ("nothing changes for the
 *    drivers until you save the first van") — é a garantia opt-in dita para o gestor;
 *  - cadastrar por ENDEREÇO usa o mesmo geocoding do cliente e grava a coordenada achar;
 *  - endereço que o Google não acha NÃO vira pino "chutado": avisa e nada é gravado.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockAlertas: { titulo: string; mensagem?: string }[] = [];
jest.mock('@/features/ui/alert', () => ({
  showAlert: (titulo: string, mensagem?: string) => {
    mockAlertas.push({ titulo, mensagem });
  },
}));

const mockEmpurrados: string[] = [];
const mockPapel: { role: string | null } = { role: 'manager' };

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'manager-1', email: 'chefe@packpaws.test' } } }),
}));

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: mockPapel.role, isLoading: false }),
}));

jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0', ios: { buildNumber: '60' } } }));

jest.mock('expo-router', () => ({
  router: { push: (destino: string) => mockEmpurrados.push(destino) },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}));

/** Geocoding falso: cada teste troca `mockGeocode.fn` pelo que o servidor responderia. */
const mockGeocode: { fn: (...args: unknown[]) => Promise<unknown> } = {
  fn: () => Promise.resolve({ points: [], source: 'unavailable' }),
};
jest.mock('@/features/maps/geocodeService', () => ({
  fetchCoordinates: (...args: unknown[]) => mockGeocode.fn(...args),
}));

const mockEstado: {
  insercoes: { tabela: string; payload: Record<string, unknown> }[];
  rpcs: { nome: string; params: Record<string, unknown> }[];
  sedes: Record<string, unknown>[];
} = { insercoes: [], rpcs: [], sedes: [] };

jest.mock('@/lib/supabase', () => {
  const dados = (tabela: string) => {
    if (tabela === 'organization_members') return [{ organization_id: 'org-1' }];
    if (tabela === 'organization_locations') return mockEstado.sedes;
    return [];
  };
  const cadeia = (tabela: string) => {
    const chain: Record<string, unknown> = {};
    const mesmo = () => chain;
    chain.select = mesmo;
    chain.eq = mesmo;
    chain.order = mesmo;
    chain.limit = mesmo;
    chain.maybeSingle = mesmo;
    chain.update = mesmo;
    chain.delete = mesmo;
    chain.insert = (payload: Record<string, unknown>) => {
      mockEstado.insercoes.push({ tabela, payload });
      chain.__payload = payload;
      return chain;
    };
    chain.single = () => Promise.resolve({ data: { id: 'novo', ...((chain.__payload as Record<string, unknown>) ?? {}) }, error: null });
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: dados(tabela), error: null }).then(res);
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'manager-1' } } }) },
      from: (tabela: string) => cadeia(tabela),
      rpc: async (nome: string, params: Record<string, unknown>) => {
        mockEstado.rpcs.push({ nome, params });
        return { data: null, error: null };
      },
    },
  };
});

const SEDE = {
  id: 'v1',
  name: 'Van — Palo Alto',
  kind: 'van',
  address_line_1: '1 Van Way',
  city: 'Palo Alto',
  latitude: 37,
  longitude: -122,
  radius_meters: 300,
  is_default: true,
};

describe('tela do gestor: Van & yard', () => {
  beforeEach(() => {
    mockEstado.insercoes.length = 0;
    mockEstado.rpcs.length = 0;
    mockEstado.sedes = [];
    mockAlertas.length = 0;
  });

  it('mostra a sede cadastrada com o selo de padrão e o raio', async () => {
    mockEstado.sedes = [SEDE];
    const Tela = require('../app/van-locations').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText('Van — Palo Alto')).toBeTruthy());
    expect(tela.getByText('DEFAULT')).toBeTruthy();
    expect(tela.getByText(/radius 300 m/)).toBeTruthy();
    expect(tela.getByText(/Where the clock in opens and where the run ends/)).toBeTruthy();
  });

  it('sem sede cadastrada, promete o comportamento de hoje para o gestor', async () => {
    const Tela = require('../app/van-locations').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText('No van saved yet')).toBeTruthy());
    expect(tela.getByText(/Nothing changes for the drivers until you save the first van/)).toBeTruthy();
    expect(tela.getByLabelText('Add a van')).toBeTruthy();
  });

  it('cadastro por endereço: grava a coordenada do geocoding e marca a van padrão', async () => {
    mockGeocode.fn = async () => ({
      points: [{ id: 'sede', latitude: 37.4419, longitude: -122.143, formattedAddress: '1 Van Way', precision: 'rooftop' }],
      source: 'live',
    });

    const Tela = require('../app/van-locations').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByLabelText('Add a van')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Add a van'));
    await fireEvent.changeText(tela.getByLabelText('Van name'), 'Van — Palo Alto');
    await fireEvent.changeText(tela.getByLabelText('Van address'), '1 Van Way');
    await fireEvent.changeText(tela.getByLabelText('Van city'), 'Palo Alto');
    await fireEvent.press(tela.getByLabelText('Save van'));

    await waitFor(() => expect(mockEstado.insercoes).toHaveLength(1));
    const gravado = mockEstado.insercoes[0].payload;
    expect(gravado.name).toBe('Van — Palo Alto');
    expect(gravado.latitude).toBe(37.4419);
    expect(gravado.longitude).toBe(-122.143);
    expect(gravado.radius_meters).toBe(300);
    expect(gravado.is_default).toBe(false); // a padrão é trocada pela função do banco, em uma transação
    expect(mockEstado.rpcs).toEqual([{ nome: 'set_default_organization_location', params: { p_location_id: 'novo' } }]);
  });

  it('endereço que o Google não acha: avisa o gestor e NÃO grava pino nenhum', async () => {
    mockGeocode.fn = async () => ({ points: [], source: 'unavailable', reason: 'nada-encontrado' });

    const Tela = require('../app/van-locations').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByLabelText('Add a van')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Add a van'));
    await fireEvent.changeText(tela.getByLabelText('Van name'), 'Van — Sem Endereço');
    await fireEvent.changeText(tela.getByLabelText('Van address'), 'rua que não existe 123');
    await fireEvent.press(tela.getByLabelText('Save van'));

    await waitFor(() => expect(mockAlertas).toHaveLength(1));
    expect(mockAlertas[0].titulo).toBe('Could not find that address');
    expect(mockAlertas[0].mensagem).toContain('latitude and longitude');
    expect(mockEstado.insercoes).toHaveLength(0);
  });
});

describe('como o gestor chega na tela', () => {
  beforeEach(() => {
    mockEmpurrados.length = 0;
  });

  it('o GESTOR vê "Van & yard" no menu More e o toque abre a tela', async () => {
    mockPapel.role = 'manager';
    const MenuMore = require('../app/(tabs)/more').default;
    const tela = await render(<MenuMore />);

    await waitFor(() => expect(tela.getByText('Van & yard')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Van & yard'));
    expect(mockEmpurrados).toContain('/van-locations');
  });

  it('o MOTORISTA não vê a linha (ele não cadastra a própria van)', async () => {
    mockPapel.role = 'driver';
    const MenuMore = require('../app/(tabs)/more').default;
    const tela = await render(<MenuMore />);

    await waitFor(() => expect(tela.getByText('Route history')).toBeTruthy());
    expect(tela.queryByText('Van & yard')).toBeNull();
    expect(tela.queryByLabelText('Van & yard')).toBeNull();
  });
});
