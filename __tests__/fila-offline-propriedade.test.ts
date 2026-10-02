/**
 * PROPRIEDADE/BEI­RADA — fila offline do MOTORISTA (`pendingWrites`).
 *
 * Critério de aceite da especificação 1.1: *"sem sinal, o app guarda o registro localmente e
 * sincroniza depois, SEM PERDER NEM DUPLICAR"*. Os testes existentes cobrem o caso feliz; este
 * arquivo ataca os beirais que a rua produz:
 *  - passo repetido / mesma parada tocada duas vezes (o mais novo vence, sem duplicar);
 *  - fila GRANDE (100 passos) — enviada inteira, na ordem;
 *  - falha de REDE no meio (a fila para ali e o resto continua no aparelho);
 *  - recusa DEFINITIVA (o item sai e a sincronização segue) vs outra falha (nada é apagado);
 *  - relógio do aparelho adiantado/atrasado: a ordem da fila é a ordem de ENVIO, não a do `queuedAt`.
 *
 * Invariante central (property): `sent + dropped + remaining.length == tamanho da fila` e
 * `remaining` é sempre um SUFIXO da fila original — nenhum registro some nem "pula" posição.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import {
  enqueuePending,
  flushPendingWrites,
  isDefinitiveWriteRefusal,
  pendingOpenShift,
  RefusedWriteError,
  type PendingWrite,
} from '@/features/driver/pendingWrites';

let seq = 0;
const aviso = (stopId: string, over: Partial<Extract<PendingWrite, { kind: 'eta_notice' }>> = {}): Extract<PendingWrite, { kind: 'eta_notice' }> => ({
  kind: 'eta_notice',
  stopId,
  phase: 'pickup',
  queuedAt: `2026-10-02T07:${String(seq++ % 60).padStart(2, '0')}:00Z`,
  ...over,
});

const jornada = (over: Partial<Extract<PendingWrite, { kind: 'shift' }>> = {}): Extract<PendingWrite, { kind: 'shift' }> => ({
  kind: 'shift',
  startedAt: '2026-10-02T07:00:00Z',
  endedAt: null,
  startReason: 'Forgot',
  endReason: null,
  routeId: 'rota-1',
  queuedAt: '2026-10-02T07:00:30Z',
  ...over,
});

const chave = (e: PendingWrite) => (e.kind === 'shift' ? 'shift' : `eta:${e.stopId}`);

describe('fila offline — repetição, ordem e fila grande', () => {
  it('100 paradas distintas entram em ordem, sem perder nenhuma', () => {
    let fila: PendingWrite[] = [];
    for (let i = 0; i < 100; i += 1) fila = enqueuePending(fila, aviso(`s${i}`));
    expect(fila).toHaveLength(100);
    expect(fila.map(chave)).toEqual(Array.from({ length: 100 }, (_, i) => `eta:s${i}`));
  });

  it('mexer a MESMA parada de novo NÃO duplica: a entrada vai para o FIM (a mais nova vence)', () => {
    let fila: PendingWrite[] = [];
    for (let i = 0; i < 5; i += 1) fila = enqueuePending(fila, aviso(`s${i}`));
    // Toca de novo a parada do meio, com outra fase.
    fila = enqueuePending(fila, aviso('s2', { phase: 'dropoff' }));
    expect(fila).toHaveLength(5);
    expect(fila.map(chave)).toEqual(['eta:s0', 'eta:s1', 'eta:s3', 'eta:s4', 'eta:s2']);
    expect((fila[4] as Extract<PendingWrite, { kind: 'eta_notice' }>).phase).toBe('dropoff');
  });

  it('passo repetido 50 vezes seguidas continua sendo UMA entrada', () => {
    let fila: PendingWrite[] = [];
    for (let i = 0; i < 50; i += 1) fila = enqueuePending(fila, aviso('s9'));
    expect(fila).toHaveLength(1);
    expect(chave(fila[0])).toBe('eta:s9');
  });

  it('a jornada tem UMA entrada e substitui em qualquer posição, sem mexer nas paradas', () => {
    let fila: PendingWrite[] = [aviso('a'), aviso('b')];
    fila = enqueuePending(fila, jornada({ startedAt: '2026-10-02T06:00:00Z' }));
    fila = enqueuePending(fila, jornada({ startedAt: '2026-10-02T07:00:00Z' }));
    expect(fila.filter((e) => e.kind === 'shift')).toHaveLength(1);
    expect((fila.find((e) => e.kind === 'shift') as Extract<PendingWrite, { kind: 'shift' }>).startedAt).toBe('2026-10-02T07:00:00Z');
    expect(fila.filter((e) => e.kind === 'eta_notice')).toHaveLength(2);
  });

  it('fila de 100: tudo sobe na ORDEM da fila', async () => {
    let fila: PendingWrite[] = [];
    for (let i = 0; i < 100; i += 1) fila = enqueuePending(fila, aviso(`s${i}`));
    const enviados: string[] = [];
    const r = await flushPendingWrites(fila, async (e) => {
      enviados.push(chave(e));
    });
    expect(enviados).toEqual(fila.map(chave));
    expect(r).toEqual({ remaining: [], sent: 100, dropped: 0 });
  });
});

describe('fila offline — rede x recusa definitiva (nada se perde em silêncio)', () => {
  const erroRede = () => new Error('Network request failed');
  const erroRecusa = () => new Error('new row violates row-level security policy for table "driver_shifts"');

  it('falha de REDE a 37 de 100: para ali e o resto (63) fica no aparelho, na ordem', async () => {
    const fila: PendingWrite[] = Array.from({ length: 100 }, (_, i) => aviso(`s${i}`));
    const enviados: string[] = [];
    const r = await flushPendingWrites(fila, async (e) => {
      if (chave(e) === 'eta:s37') throw erroRede();
      enviados.push(chave(e));
    });
    expect(r.sent).toBe(37);
    expect(r.dropped).toBe(0);
    expect(r.remaining.map(chave)).toEqual(fila.slice(37).map(chave));
    expect(enviados).toEqual(fila.slice(0, 37).map(chave));
  });

  it('recusa DEFINITIVA no meio descarta SÓ aquele item e segue enviando os outros', async () => {
    const fila: PendingWrite[] = [aviso('s0'), aviso('s1'), aviso('s2'), aviso('s3')];
    const enviados: string[] = [];
    const r = await flushPendingWrites(fila, async (e) => {
      if (chave(e) === 'eta:s1') throw erroRecusa();
      enviados.push(chave(e));
    });
    expect(r.dropped).toBe(1);
    expect(r.sent).toBe(3);
    expect(r.remaining).toEqual([]);
    expect(enviados).toEqual(['eta:s0', 'eta:s2', 'eta:s3']);
  });

  it('falha que NÃO é rede nem recusa (organization ausente) PRESERVA tudo a partir dela', async () => {
    const fila: PendingWrite[] = [jornada(), aviso('s1'), aviso('s2')];
    const r = await flushPendingWrites(fila, async (e) => {
      if (chave(e) === 'eta:s1') throw new Error('Organization not found for this account.');
    });
    expect(r.sent).toBe(1);
    expect(r.dropped).toBe(0);
    expect(r.remaining.map(chave)).toEqual(['eta:s1', 'eta:s2']);
  });

  it('RefusedWriteError explícito é sempre recusa definitiva (a que a tela usa p/ jornada já aberta)', () => {
    expect(isDefinitiveWriteRefusal(new RefusedWriteError('driver_shifts_uma_aberta'))).toBe(true);
    expect(isDefinitiveWriteRefusal('permission denied for table dogs')).toBe(true);
    expect(isDefinitiveWriteRefusal('Network request failed')).toBe(false);
    expect(isDefinitiveWriteRefusal('Organization not found for this account.')).toBe(false);
    expect(isDefinitiveWriteRefusal(undefined)).toBe(false);
  });

  it('PROPRIEDADE (400 filas aleatórias): sent+dropped+remaining == tamanho e remaining é SUFIXO', async () => {
    let semente = 424242;
    const rnd = () => {
      semente = (semente * 1103515245 + 12345) & 0x7fffffff;
      return semente / 0x7fffffff;
    };
    for (let caso = 0; caso < 400; caso += 1) {
      const n = 1 + Math.floor(rnd() * 25);
      const fila: PendingWrite[] = Array.from({ length: n }, (_, i) => aviso(`c${caso}-${i}`));
      // Sorteia o comportamento de cada posição: 0 = ok, 1 = rede, 2 = recusa, 3 = outra.
      const comportamentos = fila.map(() => Math.floor(rnd() * 4));
      const r = await flushPendingWrites(fila, async (e) => {
        const indice = fila.findIndex((x) => chave(x) === chave(e));
        const tipo = comportamentos[indice];
        if (tipo === 1) throw erroRede();
        if (tipo === 2) throw erroRecusa();
        if (tipo === 3) throw new Error('Session expired');
      });
      expect(r.sent + r.dropped + r.remaining.length).toBe(n);
      const resto = r.remaining.map(chave);
      expect(resto).toEqual(fila.slice(n - resto.length).map(chave));
      // A fila só para (deixa remaining) na PRIMEIRA falha não-continuável.
      if (r.remaining.length > 0) {
        const primeira = fila[n - r.remaining.length];
        const indice = fila.indexOf(primeira);
        expect([1, 3]).toContain(comportamentos[indice]);
        // nada à frente dela foi "pulado": tudo antes ou subiu ou foi recusa definitiva.
        for (let i = 0; i < indice; i += 1) expect(comportamentos[i] !== 1 && comportamentos[i] !== 3).toBe(true);
      }
    }
  });
});

describe('fila offline — relógio do aparelho torto', () => {
  it('queuedAt adiantado/atrasado NÃO reordena: vale a ordem da fila', async () => {
    const fila: PendingWrite[] = [
      aviso('futuro', { queuedAt: '2035-01-01T00:00:00Z' }),
      aviso('passado', { queuedAt: '2001-01-01T00:00:00Z' }),
      aviso('atual', { queuedAt: '2026-10-02T07:00:00Z' }),
    ];
    const enviados: string[] = [];
    await flushPendingWrites(fila, async (e) => {
      enviados.push(chave(e));
    });
    expect(enviados).toEqual(['eta:futuro', 'eta:passado', 'eta:atual']);
  });

  it('acha a jornada aberta mesmo no meio da fila; jornada fechada não conta', () => {
    const fila: PendingWrite[] = [aviso('s0'), jornada({ endedAt: null })];
    expect(pendingOpenShift(fila)?.startedAt).toBe('2026-10-02T07:00:00Z');
    expect(pendingOpenShift([aviso('s0'), jornada({ endedAt: '2026-10-02T12:00:00Z' })])).toBeNull();
  });
});
