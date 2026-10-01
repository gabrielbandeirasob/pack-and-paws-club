/**
 * ENTREGA POR TOQUE + ETA POR ROTA (conferência do dono, 01/10/2026 — itens 2 e 5).
 *
 * O que estes vetores travam:
 *  1. depois das buscas, o dia NÃO acabou: a próxima parada é a entrega pendente, na ordem da entrega;
 *  2. a parada só sai da fila quando a entrega é confirmada (`delivered_at`) ou vira problema;
 *  3. o ETA segue a ROTA (pernas gravadas pelo Optimize) e não a linha reta da posição do motorista,
 *     somando o serviço das paradas intermediárias;
 *  4. sem pernas gravadas, cai na estimativa antiga (linha reta) — sem regressão para quem não otimizou.
 */
import { entregue, ordenarParadasDoDia, proximaParadaDoDia } from '@/features/driver/dayOrder';
import { minutosAteParada, minutosAteParadaPorRota, nextStopEta } from '@/features/driver/eta';
import { enqueueEvent, applyPendingEvents } from '@/features/driver/offlineStore';

// A fila offline do motorista mora no AsyncStorage: sem este mock o módulo nem carrega no Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type Parada = {
  id: string;
  sequence: number;
  dropoffSequence?: number | null;
  status: string;
  deliveredAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  clientName: string;
  dogName: string;
  travelSeconds?: number | null;
  dropoffTravelSeconds?: number | null;
};

/** Parada do teste: nome de cão/cliente podem ser omitidos (o helper preenche). */
type ParadaBruta = Omit<Parada, 'clientName' | 'dogName'> & { clientName?: string; dogName?: string };

function parada(p: ParadaBruta): Parada {
  return {
    latitude: 37.45, longitude: -122.15,
    ...p,
    clientName: p.clientName ?? 'Jose',
    dogName: p.dogName ?? 'Mowgli',
  };
}

describe('a entrega mantém o dia vivo depois das buscas', () => {
  const buscasFeitas: Parada[] = [
    parada({ id: 'luna', sequence: 1, dropoffSequence: 2, status: 'completed' }),
    parada({ id: 'mowgli', sequence: 2, dropoffSequence: 1, status: 'completed' }),
  ];

  it('a próxima parada é a ENTREGA pendente, na ordem da entrega (não na da busca)', () => {
    expect(proximaParadaDoDia(buscasFeitas)?.id).toBe('mowgli');
  });

  it('entregou as duas: aí sim o dia acabou', () => {
    const entregues = buscasFeitas.map((stop) => ({ ...stop, deliveredAt: '2026-10-01T21:00:00.000Z' }));
    expect(proximaParadaDoDia(entregues)).toBeNull();
  });

  it('problema (skipped) não volta para a fila, mesmo sem entrega', () => {
    const comProblema = [{ ...buscasFeitas[0], status: 'skipped' }, buscasFeitas[1]];
    expect(entregue(comProblema[0])).toBe(true);
    expect(proximaParadaDoDia(comProblema)?.id).toBe('mowgli');
  });

  it('durante as buscas a ordem continua sendo a da BUSCA', () => {
    // Enquanto há busca pendente, `dropoff_sequence` NÃO manda: quem manda é a ordem da manhã.
    const comBuscaPendente = [
      parada({ id: 'luna', sequence: 1, dropoffSequence: 2, status: 'pending' }),
      parada({ id: 'mowgli', sequence: 2, dropoffSequence: 1, status: 'pending' }),
    ];
    expect(proximaParadaDoDia(comBuscaPendente)?.id).toBe('luna');
  });

  it('a lista inteira segue a ordem da entrega quando as buscas acabaram', () => {
    expect(ordenarParadasDoDia(buscasFeitas).map((stop) => stop.id)).toEqual(['mowgli', 'luna']);
  });
});

describe('ETA pela rota (pernas gravadas no Optimize)', () => {
  const rota: Parada[] = [
    parada({ id: 'luna', sequence: 1, dropoffSequence: 1, status: 'pending', travelSeconds: 600 }),      // 10 min
    parada({ id: 'mowgli', sequence: 2, dropoffSequence: 2, status: 'pending', travelSeconds: 900 }),    // 15 min
    parada({ id: 'filo', sequence: 3, dropoffSequence: 3, status: 'pending', travelSeconds: 300 }),      // 5 min
  ];

  it('soma as pernas até a parada, com 3 min de serviço nas intermediárias', () => {
    // 10 + (3 serviço) + 15 + (3) + 5 = 36
    expect(minutosAteParadaPorRota(rota, 'filo')).toBe(36);
  });

  it('a primeira parada da fila custa só a perna dela', () => {
    expect(minutosAteParadaPorRota(rota, 'luna')).toBe(10);
  });

  it('parada já resolvida não tem ETA (não se volta para trás)', () => {
    const comFeitas = [{ ...rota[0], status: 'completed' }, rota[1]];
    expect(minutosAteParadaPorRota(comFeitas, 'luna')).toBeNull();
  });

  it('sem perna gravada devolve null — quem chama cai na linha reta, nunca em zero', () => {
    const semPernas = rota.map((stop) => ({ ...stop, travelSeconds: null }));
    expect(minutosAteParadaPorRota(semPernas, 'filo')).toBeNull();
  });

  it('na fase da entrega usa a perna da ENTREGA (a tarde tem outra ordem)', () => {
    const tarde: Parada[] = [
      parada({ id: 'luna', sequence: 1, dropoffSequence: 1, status: 'completed', dropoffTravelSeconds: 1200 }),
      parada({ id: 'mowgli', sequence: 2, dropoffSequence: 2, status: 'completed', dropoffTravelSeconds: 600 }),
    ];
    // Luna ainda não foi entregue: para chegar na Mowgli o motorista passa pela casa da Luna antes —
    // 20 min de perna + 3 de serviço + 10 = 33. A conta da tarde usa a perna da ENTREGA, não a da manhã.
    expect(minutosAteParadaPorRota(tarde, 'luna')).toBe(20);
    expect(minutosAteParadaPorRota(tarde, 'mowgli')).toBe(33);
  });

  it('o ETA mostrado na tela segue a rota quando ela existe', () => {
    const eta = nextStopEta(rota, { latitude: 0, longitude: 0 }, new Date(2026, 9, 1, 8, 0));
    expect(eta?.stopId).toBe('luna');
    expect(eta?.minutes).toBe(10); // e NÃO os ~milhares de minutos que a linha reta daria
  });

  it('sem rota gravada o ETA volta a ser a linha reta da posição (comportamento antigo)', () => {
    const semPernas = [{ ...rota[0], travelSeconds: null, latitude: 0, longitude: 0.2 }];
    const eta = nextStopEta(semPernas, { latitude: 0, longitude: 0 }, new Date(2026, 9, 1, 8, 0));
    expect(eta?.minutes).toBeGreaterThan(50); // ~22 km a 25 km/h
  });

  it('minutosAteParada prefere a rota e só cai na posição quando falta o dado', () => {
    // luna (10 min) + 3 de serviço + a perna da mowgli (15) = 28 — e não os ~milhares de minutos da
    // linha reta de quem estivesse em (0,0).
    expect(minutosAteParada(rota, 'mowgli', { latitude: 0, longitude: 0 })).toBe(28);
    const semPernas = [{ ...rota[0], travelSeconds: null, latitude: 0, longitude: 0.2 }];
    expect(minutosAteParada(semPernas, 'luna', { latitude: 0, longitude: 0 })).toBeGreaterThan(50);
  });
});

describe('entrega confirmada sem rede vai para a fila local', () => {
  it('o evento guarda o marco de entrega e a tela mostra a parada como entregue', () => {
    const fila = enqueueEvent([], {
      stopId: 'luna', status: 'completed', deliveredAt: '2026-10-01T21:05:00.000Z',
      createdAt: '2026-10-01T21:05:00.000Z',
    });
    expect(fila).toHaveLength(1);
    expect(fila[0].deliveredAt).toBe('2026-10-01T21:05:00.000Z');

    const naTela = applyPendingEvents(
      [{ id: 'luna', sequence: 1, status: 'completed', clientName: 'Jose', dogName: 'Luna', address: null, city: null, instructions: null, deliveredAt: null }],
      fila,
    );
    expect(naTela[0].deliveredAt).toBe('2026-10-01T21:05:00.000Z');
  });

  it('um passo novo na mesma parada não apaga a entrega que já estava na fila', () => {
    const primeira = enqueueEvent([], {
      stopId: 'luna', status: 'completed', deliveredAt: '2026-10-01T21:05:00.000Z', createdAt: '2026-10-01T21:05:00.000Z',
    });
    const depois = enqueueEvent(primeira, { stopId: 'luna', status: 'skipped', createdAt: '2026-10-01T21:09:00.000Z' });
    expect(depois[0].deliveredAt).toBe('2026-10-01T21:05:00.000Z');
    expect(depois[0].steps).toEqual(['completed', 'skipped']);
  });
});
