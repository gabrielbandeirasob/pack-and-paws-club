import {
  addressChanged,
  clientUpdatePayload,
  dogUpdatePayload,
  normalizeText,
  splitDogNames,
} from '@/features/clients/clientsService';

const atual = {
  name: 'Ana Souza',
  phone: '4155551234',
  address_line_1: '100 Market St',
  address_line_2: null,
  city: 'San Francisco',
  state: 'CA',
  postal_code: '94103',
  notes: 'Portao azul',
  special_scheduling_instructions: null,
  latitude: 37.79,
  longitude: -122.4,
};

const iguais = {
  name: 'Ana Souza',
  phone: '4155551234',
  address_line_1: '100 Market St',
  address_line_2: null,
  city: 'San Francisco',
  state: 'CA',
  postal_code: '94103',
  notes: 'Portao azul',
  special_scheduling_instructions: null,
};

describe('edição de cliente', () => {
  it('normaliza texto: espaços viram null', () => {
    expect(normalizeText('  ')).toBeNull();
    expect(normalizeText('  Ana  ')).toBe('Ana');
    expect(normalizeText(null)).toBeNull();
  });

  it('detecta mudança de endereço (inclusive cidade/CEP)', () => {
    expect(addressChanged(atual, iguais)).toBe(false);
    expect(addressChanged(atual, { ...iguais, address_line_1: '200 Market St' })).toBe(true);
    expect(addressChanged(atual, { ...iguais, city: 'Oakland' })).toBe(true);
    expect(addressChanged(atual, { ...iguais, postal_code: '94110' })).toBe(true);
  });

  it('mantém as coordenadas quando o endereço não mudou', () => {
    const payload = clientUpdatePayload(atual, iguais);
    expect(payload.address_changed).toBe(false);
    expect(payload.latitude).toBeUndefined();
    expect(payload.longitude).toBeUndefined();
    expect(payload.name).toBe('Ana Souza');
  });

  it('DESCARTA as coordenadas quando o endereço muda (não deixa pino no endereço antigo)', () => {
    const payload = clientUpdatePayload(atual, { ...iguais, address_line_1: '200 Market St' });
    expect(payload.address_changed).toBe(true);
    expect(payload.latitude).toBeNull();
    expect(payload.longitude).toBeNull();
    expect(payload.address_line_1).toBe('200 Market St');
  });

  it('não deixa salvar cliente sem nome', () => {
    expect(() => clientUpdatePayload(atual, { ...iguais, name: '   ' })).toThrow();
  });

  it('monta o payload do cachorro com campos vazios em null', () => {
    const payload = dogUpdatePayload({ name: 'Luna', breed: ' ', behavior_notes: 'Medroso', medical_notes: null });
    expect(payload).toEqual({ name: 'Luna', breed: null, behavior_notes: 'Medroso', medical_notes: null });
    expect(() => dogUpdatePayload({ name: '', breed: null, behavior_notes: null, medical_notes: null })).toThrow();
  });

  it('quebra a lista de nomes de cachorros e ignora vazios', () => {
    expect(splitDogNames('Luna, Thor ; Mel')).toEqual(['Luna', 'Thor', 'Mel']);
    expect(splitDogNames('   ')).toEqual([]);
    expect(splitDogNames('Luna, luna')).toEqual(['Luna']);
  });
});
