import { filterClients, normalizeForSearch } from '@/features/clients/clientsService';

const clients = [
  { name: 'João Souza', phone: '+1 415 555 0101', address_line_1: '100 Market St', city: 'San Francisco', dogs: ['Luna'] },
  { name: 'Maria Silva', phone: '+1 415 555 0202', address_line_1: '22 Oak Ave', city: 'Oakland', dogs: ['Bob', 'Mel'] },
  { name: 'Raphael Stefan', phone: null, address_line_1: null, city: null, dogs: ['Thor'] },
];

describe('busca de clientes', () => {
  it('sem termo devolve a lista inteira (mesma referência)', () => {
    expect(filterClients(clients, '')).toBe(clients);
    expect(filterClients(clients, '   ')).toBe(clients);
  });

  it('acha por nome ignorando acento e maiúscula (joao → João)', () => {
    expect(filterClients(clients, 'joao').map((c) => c.name)).toEqual(['João Souza']);
    expect(filterClients(clients, 'JOÃO').map((c) => c.name)).toEqual(['João Souza']);
  });

  it('acha por telefone, rua, cidade e nome do cão', () => {
    expect(filterClients(clients, '0202').map((c) => c.name)).toEqual(['Maria Silva']);
    expect(filterClients(clients, 'oak ave').map((c) => c.name)).toEqual(['Maria Silva']);
    expect(filterClients(clients, 'oakland').map((c) => c.name)).toEqual(['Maria Silva']);
    expect(filterClients(clients, 'thor').map((c) => c.name)).toEqual(['Raphael Stefan']);
  });

  it('devolve vazio quando não encontra', () => {
    expect(filterClients(clients, 'zzz')).toEqual([]);
  });

  it('normaliza nulo sem quebrar', () => {
    expect(normalizeForSearch(null)).toBe('');
    expect(filterClients(clients, 'raphael').length).toBe(1);
  });
});
