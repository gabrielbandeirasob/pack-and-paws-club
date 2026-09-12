/**
 * Geocoding: formato da resposta do servidor, o que e descartado (pino errado e pior que pino
 * nenhum) e o comportamento quando a funcao nao existe / sem chave / timeout.
 */
const mockInvoke = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    // update(...).eq(...) -> usado por fillClientCoordinates para gravar o pino
    from: () => ({
      update: (values: unknown) => {
        mockUpdate(values);
        return {
          eq: (coluna: string, valor: unknown) => {
            mockEq(coluna, valor);
            return { error: null }; // o PostgREST devolve { error, data }: aqui so o erro importa
          },
        };
      },
    }),
  },
}));

import {
  GEOCODE_FUNCTION,
  addressForGeocoding,
  fetchCoordinates,
  fillClientCoordinates,
  needsCoordinates,
  parseGeocode,
} from '@/features/maps/geocodeService';

const lugar = { id: 'c1', addressLine1: '2523 Holland St', city: 'San Mateo', state: 'CA', postalCode: '94403' };

beforeEach(() => jest.clearAllMocks());

describe('resposta do servidor -> pontos confiaveis', () => {
  it('aceita ponto valido e mantem a precisao', () => {
    const pontos = parseGeocode(
      { results: [{ id: 'c1', latitude: 37.5, longitude: -122.3, formattedAddress: '2523 Holland St, San Mateo, CA', precision: 'rooftop' }], missing: [], source: 'google' },
      ['c1'],
    );
    expect(pontos).toEqual([
      { id: 'c1', latitude: 37.5, longitude: -122.3, formattedAddress: '2523 Holland St, San Mateo, CA', precision: 'rooftop' },
    ]);
  });

  it('descarta coordenada fora de faixa, id que nao foi pedido, repetido e o (0,0)', () => {
    const pontos = parseGeocode(
      {
        results: [
          { id: 'c1', latitude: 999, longitude: -122, precision: 'rooftop' }, // fora de faixa
          { id: 'c9', latitude: 37.5, longitude: -122.3, precision: 'rooftop' }, // nao pedido
          { id: 'c2', latitude: 0, longitude: 0, precision: 'approximate' }, // Null Island
          { id: 'c3', latitude: 37.6, longitude: -122.4, precision: 'street' },
          { id: 'c3', latitude: 37.7, longitude: -122.5, precision: 'street' }, // repetido
        ],
      },
      ['c1', 'c2', 'c3'],
    );
    expect(pontos).toEqual([{ id: 'c3', latitude: 37.6, longitude: -122.4, formattedAddress: null, precision: 'street' }]);
  });

  it('precisao desconhecida cai em approximate em vez de derrubar o ponto', () => {
    const pontos = parseGeocode({ results: [{ id: 'c1', latitude: 37.5, longitude: -122.3, precision: 'sei-la' }] }, ['c1']);
    expect(pontos).toHaveLength(1);
    expect(pontos![0].precision).toBe('approximate');
  });

  it('recusa resposta torta em vez de chutar', () => {
    expect(parseGeocode(null, ['c1'])).toBeNull();
    expect(parseGeocode({ results: 'nada' }, ['c1'])).toBeNull();
    expect(parseGeocode({ results: [{ id: 'c1', latitude: 'x', longitude: 1 }] }, ['c1'])).toEqual([]);
  });
});

describe('busca no servidor', () => {
  it('usa as coordenadas quando a funcao responde', async () => {
    mockInvoke.mockResolvedValue({ data: { results: [{ id: 'c1', latitude: 37.5, longitude: -122.3, precision: 'rooftop' }], source: 'google' }, error: null });
    const saida = await fetchCoordinates([lugar]);
    expect(saida.source).toBe('live');
    expect(saida.points).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledWith(GEOCODE_FUNCTION, expect.objectContaining({ body: { places: [lugar] } }));
  });

  it('cai em unavailable sem funcao implantada (sem quebrar o cadastro)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Function not found' } });
    const saida = await fetchCoordinates([lugar]);
    expect(saida.source).toBe('unavailable');
    expect(saida.reason).toBe('funcao-indisponivel');
    expect(saida.points).toEqual([]);
  });

  it('respeita o timeout sem travar a tela', async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    const saida = await fetchCoordinates([lugar], { timeoutMs: 30 });
    expect(saida.reason).toBe('timeout');
  });

  it('sem endereco valido nem chama o servidor', async () => {
    const saida = await fetchCoordinates([{ id: 'x', addressLine1: '   ' }]);
    expect(saida.reason).toBe('sem-enderecos');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('servidor respondeu NADA encontrado (endereco inexistente)', async () => {
    mockInvoke.mockResolvedValue({ data: { results: [], missing: ['c1'], source: 'google' }, error: null });
    const saida = await fetchCoordinates([lugar]);
    expect(saida.source).toBe('unavailable');
    expect(saida.reason).toBe('nada-encontrado');
  });
});

describe('quem precisa de coordenada', () => {
  it('cliente com endereco e sem pino precisa', () => {
    expect(needsCoordinates({ address_line_1: '2523 Holland St', city: 'San Mateo', latitude: null, longitude: null })).toBe(true);
  });

  it('cliente com pino nao precisa', () => {
    expect(needsCoordinates({ address_line_1: '2523 Holland St', latitude: 37.5, longitude: -122.3 })).toBe(false);
  });

  it('cliente sem rua nao tem como geocodar (nao insiste)', () => {
    expect(needsCoordinates({ address_line_1: null, city: 'San Mateo' })).toBe(false);
    expect(addressForGeocoding({ address_line_1: '  ' }, 'c1')).toBeNull();
  });

  it('monta o endereco com pais EUA para o Google', () => {
    expect(addressForGeocoding({ address_line_1: '187 East Creek Drive', city: 'Menlo Park', state: 'CA', postal_code: null }, 'c2')).toEqual({
      id: 'c2',
      addressLine1: '187 East Creek Drive',
      addressLine2: null,
      city: 'Menlo Park',
      state: 'CA',
      postalCode: null,
      country: 'US',
    });
  });
});

describe('gravar o pino no banco (fillClientCoordinates)', () => {
  const cliente = {
    address_line_1: '2523 Holland St',
    address_line_2: null,
    city: 'San Mateo',
    state: 'CA',
    postal_code: '94403',
    latitude: null,
    longitude: null,
  };

  it('busca no servidor e grava a coordenada do cliente', async () => {
    mockInvoke.mockResolvedValue({
      data: { results: [{ id: 'c1', latitude: 37.5, longitude: -122.3, precision: 'rooftop' }], missing: [], source: 'google' },
      error: null,
    });

    const saida = await fillClientCoordinates('c1', cliente);

    expect(saida).toBe('preenchido');
    expect(mockUpdate).toHaveBeenCalledWith({ latitude: 37.5, longitude: -122.3 });
    expect(mockEq).toHaveBeenCalledWith('id', 'c1');
  });

  it('nao mexe em quem ja tem pino (nem chama o servidor)', async () => {
    const saida = await fillClientCoordinates('c1', { ...cliente, latitude: 37.5, longitude: -122.3 });
    expect(saida).toBe('nao-precisava');
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('cliente sem rua nao insiste e nao grava nada', async () => {
    const saida = await fillClientCoordinates('c1', { ...cliente, address_line_1: '   ' });
    expect(saida).toBe('sem-endereco');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('servidor fora do ar nao grava pino nenhum (nada de coordenada chutada)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'sem chave' } });
    const saida = await fillClientCoordinates('c1', cliente);
    expect(saida).toBe('indisponivel');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
