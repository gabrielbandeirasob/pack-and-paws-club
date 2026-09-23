/**
 * Fila local de escritas do motorista (jornada manual + registro do aviso de ETA).
 *
 * Critério de aceite: "depois de um período sem sinal, os registros aparecem sem duplicar".
 * O que estes testes travam: a fila guarda UMA jornada e UM aviso por parada (o mais novo vence),
 * falha de rede PARA a fila (tenta de novo depois) e erro definitivo não trava a sincronização.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import {
  enqueuePending,
  flushPendingWrites,
  pendingNoticeCount,
  pendingOpenShift,
  type PendingWrite,
} from '@/features/driver/pendingWrites';

const jornadaAberta = (over: Partial<Extract<PendingWrite, { kind: 'shift' }>> = {}) =>
  ({
    kind: 'shift',
    startedAt: '2026-09-23T07:00:00Z',
    endedAt: null,
    startReason: 'Esqueci',
    endReason: null,
    routeId: 'rota-1',
    queuedAt: '2026-09-23T07:00:30Z',
    ...over,
  }) as Extract<PendingWrite, { kind: 'shift' }>;

const aviso = (stopId: string): Extract<PendingWrite, { kind: 'eta_notice' }> => ({
  kind: 'eta_notice',
  stopId,
  phase: 'pickup',
  queuedAt: '2026-09-23T07:05:00Z',
});

describe('fila de escritas pendentes', () => {
  it('guarda UMA jornada só (o registro novo substitui o antigo)', () => {
    const primeira = enqueuePending([], jornadaAberta({ startedAt: '2026-09-23T06:00:00Z' }));
    const segunda = enqueuePending(primeira, jornadaAberta({ startedAt: '2026-09-23T07:00:00Z' }));
    expect(segunda).toHaveLength(1);
    expect(segunda[0].kind === 'shift' && segunda[0].startedAt).toBe('2026-09-23T07:00:00Z');
  });

  it('aviso de ETA é por parada: repetir a mesma parada substitui, parada nova entra', () => {
    let fila: PendingWrite[] = enqueuePending([], aviso('s1'));
    fila = enqueuePending(fila, aviso('s1'));
    fila = enqueuePending(fila, aviso('s2'));
    expect(pendingNoticeCount(fila)).toBe(2);
    expect(fila.filter((entry) => entry.kind === 'eta_notice')).toHaveLength(2);
  });

  it('acha a jornada ainda aberta na fila (para a tela mostrar "on the clock")', () => {
    expect(pendingOpenShift([jornadaAberta()])?.startedAt).toBe('2026-09-23T07:00:00Z');
    expect(pendingOpenShift([jornadaAberta({ endedAt: '2026-09-23T10:00:00Z' })])).toBeNull();
    expect(pendingOpenShift([aviso('s1')])).toBeNull();
  });

  it('envia tudo em ordem e esvazia a fila', async () => {
    const enviados: string[] = [];
    const resultado = await flushPendingWrites([jornadaAberta(), aviso('s1')], async (entry) => {
      enviados.push(entry.kind);
    });
    expect(enviados).toEqual(['shift', 'eta_notice']);
    expect(resultado).toEqual({ remaining: [], sent: 2, dropped: 0 });
  });

  it('falha de REDE para a fila no ponto certo (nada é perdido, nada é repetido)', async () => {
    const enviados: string[] = [];
    const resultado = await flushPendingWrites([jornadaAberta(), aviso('s1'), aviso('s2')], async (entry) => {
      if (entry.kind === 'eta_notice' && entry.stopId === 's1') throw new Error('Network request failed');
      enviados.push(entry.kind);
    });
    expect(enviados).toEqual(['shift']);
    expect(resultado.sent).toBe(1);
    expect(resultado.remaining).toHaveLength(2); // o que falhou e o que vinha depois
    expect(resultado.remaining[0].kind === 'eta_notice' && resultado.remaining[0].stopId).toBe('s1');
  });

  it('erro que NÃO é de rede descarta o item e segue (não trava a fila para sempre)', async () => {
    const resultado = await flushPendingWrites([jornadaAberta(), aviso('s1')], async (entry) => {
      if (entry.kind === 'shift') throw new Error('violates check constraint "driver_shifts_motivo_ok"');
    });
    expect(resultado.dropped).toBe(1);
    expect(resultado.sent).toBe(1);
    expect(resultado.remaining).toEqual([]);
  });
});
