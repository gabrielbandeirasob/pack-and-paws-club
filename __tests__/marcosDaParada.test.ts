import {
  horaCurta,
  jaFeita,
  marcosDaParada,
  proximaPendente,
  resumoDaEntrega,
  resumoDaRota,
} from '@/features/dashboard/stopProgress';
import { enderecoDaParada, mapearParada, ordenarParadas } from '@/features/dispatch/routeStops';

/**
 * MARCOS DE TEMPO DA PARADA — a frase que o gestor lê na lista da rota e o motorista na tela dele.
 * Pedido do cliente em áudio (01/10/2026): "abrir uma lista dos pick-up que tem e os que ainda falta
 * e que hora foi feita cada pick-up" / "podia aparecer qual cachorro já foi e que hora".
 */
describe('marcosDaParada', () => {
  /** Hora local do aparelho: monta o ISO a partir da hora local, sem depender do fuso do runner. */
  const emLocal = (hora: number, minuto: number) => new Date(2026, 9, 1, hora, minuto).toISOString();

  it('parada concluída mostra chegada e conclusão', () => {
    expect(marcosDaParada({
      status: 'completed',
      arrivedAt: emLocal(8, 12),
      completedAt: emLocal(8, 18),
    })).toBe('arrived 08:12 · done 08:18');
  });

  it('mesma hora na chegada e na conclusão aparece uma vez só na chegada', () => {
    expect(marcosDaParada({
      status: 'completed',
      arrivedAt: emLocal(8, 18),
      completedAt: emLocal(8, 18),
    })).toBe('arrived 08:18 · done 08:18');
  });

  it('só chegou: aparece apenas "arrived"', () => {
    expect(marcosDaParada({ status: 'arrived', arrivedAt: emLocal(9, 5) })).toBe('arrived 09:05');
  });

  it('problema usa a hora do problema', () => {
    expect(marcosDaParada({ status: 'skipped', arrivedAt: emLocal(8, 0), skippedAt: emLocal(8, 14) }))
      .toBe('Problem · 08:14');
  });

  it('pendente sem marco nenhum cai na previsão da parada', () => {
    expect(marcosDaParada({ status: 'pending', exactTime: '08:30:00' })).toBe('Must arrive by 08:30');
    expect(marcosDaParada({ status: 'pending', windowEnd: '09:00:00' })).toBe('Window until 09:00');
    expect(marcosDaParada({ status: 'pending' })).toBe('Pending');
  });

  it('valor que não é data não vira hora inventada', () => {
    expect(horaCurta('sem-hora')).toBeNull();
    expect(horaCurta(null)).toBeNull();
    expect(marcosDaParada({ status: 'arrived', arrivedAt: 'sem-hora' })).toBe('Pending');
  });

  it('entrega aparece NO MEIO da frase, depois do done (a tarde da rota)', () => {
    expect(marcosDaParada({
      status: 'completed',
      arrivedAt: emLocal(8, 12),
      completedAt: emLocal(8, 18),
      deliveredAt: emLocal(14, 5),
    })).toBe('arrived 08:12 · done 08:18 · delivered 14:05');
  });

  it('sem o marco de entrega a frase fica igual à de antes (só a manhã)', () => {
    expect(marcosDaParada({
      status: 'completed',
      arrivedAt: emLocal(8, 12),
      completedAt: emLocal(8, 18),
      deliveredAt: null,
    })).toBe('arrived 08:12 · done 08:18');
  });

  it('entrega sozinha (sem hora de busca registrada) ainda aparece', () => {
    expect(marcosDaParada({ status: 'completed', deliveredAt: emLocal(16, 25) })).toBe('delivered 16:25');
  });
});

describe('resumoDaRota', () => {
  it('conta as resolvidas (concluída e problema) sobre o total', () => {
    expect(resumoDaRota([
      { status: 'completed' }, { status: 'skipped' }, { status: 'pending' }, { status: 'arrived' },
    ])).toBe('2 of 4 done');
  });

  it('rota inteira feita', () => {
    expect(resumoDaRota([{ status: 'completed' }, { status: 'completed' }])).toBe('2 of 2 done');
  });

  it('jaFeita: problema conta como resolvida, chegada não', () => {
    expect(jaFeita({ status: 'skipped' })).toBe(true);
    expect(jaFeita({ status: 'arrived' })).toBe(false);
  });

  it('proximaPendente ignora o que já terminou', () => {
    const paradas = [{ status: 'completed' }, { status: 'arrived' }, { status: 'pending' }];
    expect(proximaPendente(paradas)).toEqual({ status: 'arrived' });
    expect(proximaPendente([{ status: 'completed' }])).toBeNull();
  });
});

describe('resumoDaEntrega', () => {
  it('conta só quem tem o marco de entrega (a busca concluída não conta)', () => {
    expect(resumoDaEntrega([
      { deliveredAt: '2026-10-01T21:05:00Z' },
      { deliveredAt: '2026-10-01T22:00:00Z' },
      { deliveredAt: null },
      { deliveredAt: null }, // concluída na busca, ainda sem entrega → não conta
    ])).toBe('2 of 4 delivered');
  });

  it('rota inteira entregue', () => {
    expect(resumoDaEntrega([
      { deliveredAt: '2026-10-01T21:05:00Z' },
      { deliveredAt: '2026-10-01T21:40:00Z' },
    ])).toBe('2 of 2 delivered');
  });

  it('nada entregue ainda', () => {
    expect(resumoDaEntrega([{ deliveredAt: null }, { deliveredAt: null }])).toBe('0 of 2 delivered');
  });

  it('sem paradas → 0 of 0 delivered', () => {
    expect(resumoDaEntrega([])).toBe('0 of 0 delivered');
  });
});

describe('paradas da rota (mapeamento da consulta)', () => {
  it('monta a parada com cliente, cão, endereço e marcos', () => {
    const parada = mapearParada({
      id: 'stop-1',
      sequence: 5,
      status: 'completed',
      arrived_at: '2026-10-01T15:54:57Z',
      picked_up_at: '2026-10-01T15:55:09Z',
      completed_at: '2026-10-01T15:55:09Z',
      dog: { name: 'Oreo', client: { name: 'Andrea', address_line_1: '329 Middlefield Rd', city: 'Palo Alto' } },
    });
    expect(parada.clientName).toBe('Andrea');
    expect(parada.dogName).toBe('Oreo');
    expect(parada.address).toBe('329 Middlefield Rd, Palo Alto');
    expect(parada.completedAt).toBe('2026-10-01T15:55:09Z');
  });

  it('lê o marco de entrega (delivered_at → deliveredAt)', () => {
    const parada = mapearParada({
      id: 'stop-9', sequence: 2, status: 'completed',
      delivered_at: '2026-10-01T22:05:00Z',
      dog: { name: 'Luna', client: { name: 'Filó', address_line_1: '10 Elm St', city: 'Daly City' } },
    });
    expect(parada.deliveredAt).toBe('2026-10-01T22:05:00Z');
    expect(mapearParada({ id: 'stop-10', sequence: 3 }).deliveredAt).toBeNull();
  });

  it('sem cliente/cão não inventa nome nem quebra o endereço', () => {
    const parada = mapearParada({ id: 'stop-2', sequence: null, dog: null });
    expect(parada.clientName).toBe('Client');
    expect(parada.dogName).toBe('Dog');
    expect(parada.address).toBeNull();
    expect(parada.status).toBe('pending');
    expect(enderecoDaParada(null)).toBeNull();
    expect(enderecoDaParada({ client: { address_line_1: '   ' } })).toBeNull();
    expect(enderecoDaParada({ client: { city: 'San Mateo' } })).toBe('San Mateo');
  });

  it('ordena pela posição da busca (a mesma numeração do Dispatch)', () => {
    const lista = ordenarParadas([
      mapearParada({ id: 'c', sequence: 3 }),
      mapearParada({ id: 'a', sequence: null }),
      mapearParada({ id: 'b', sequence: 1 }),
    ]);
    expect(lista.map((parada) => parada.id)).toEqual(['a', 'b', 'c']);
  });
});
