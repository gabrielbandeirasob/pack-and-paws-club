/**
 * CORRIDA DA FILA OFFLINE DO MOTORISTA — defeito crítico de 02/10/2026.
 *
 * O motorista toca "Next" sem sinal: o app diz "salvo no aparelho" e o passo SOME. Duas causas:
 *
 *  1) DUAS escritas `ler → mudar → gravar` corriam intercaladas na MESMA fila: a subida da fila
 *     (`saveOutbox(remaining)` / `savePendingWrites(remaining)`) e o enfileiramento do `act`
 *     (`enqueueEvent(await loadOutbox(), …)`). O `save…(remaining)` da subida GRAVAVA POR CIMA do
 *     registro recém-enfileirado — o passo nunca subia. Correção: um SERIALIZADOR (`mudarFila` /
 *     `mudarOutbox`) que põe cada ciclo na VEZ do anterior, e a subida REMOVE da fila viva só o que
 *     realmente saiu (casando chave + instante), preservando o que entrou no meio do caminho.
 *
 *  2) `load()` era disparado por 4 gatilhos ao mesmo tempo sem guarda de execução em curso
 *     (tempestade de requisições) — coberto em `motorista-2-toques.test.tsx`.
 *
 * Cada caso aqui FALHA sem a correção: o serializador sem a fila de promessas perde enfileiramentos
 * simultâneos; a remoção por identidade é o que impede o registro novo de ser apagado.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  chaveDoPendente,
  enqueuePending,
  flushPendingWrites,
  mudarFila,
  semPendentesSaidos,
  type PendingWrite,
} from '@/features/driver/pendingWrites';
import {
  chaveDoEvento,
  enqueueEvent,
  mudarOutbox,
  semRegistrosSaidos,
  type DriverEvent,
} from '@/features/driver/offlineStore';

let seq = 0;

const aviso = (
  stopId: string,
  queuedAt?: string,
): Extract<PendingWrite, { kind: 'eta_notice' }> => ({
  kind: 'eta_notice',
  stopId,
  phase: 'pickup',
  queuedAt: queuedAt ?? `2026-10-02T07:00:${String(seq++).padStart(2, '0')}.000Z`,
});

const chaveDe = (entrada: PendingWrite) => (entrada.kind === 'shift' ? 'shift' : `eta:${entrada.stopId}`);

const evento = (
  stopId: string,
  status: DriverEvent['status'] = 'arrived',
  createdAt?: string,
): DriverEvent => ({
  stopId,
  status,
  createdAt: createdAt ?? `2026-10-02T07:00:${String(seq++).padStart(2, '0')}.000Z`,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  seq = 0;
});

describe('mudarFila — serializador do ciclo ler-mudar-gravar (fila local)', () => {
  it('(b) 20 mudanças SIMULTÂNEAS entram todas, na ordem (nenhuma perdida)', async () => {
    // Sem o serializador, os 20 ciclos leem a fila VAZIA ao mesmo tempo e cada um grava só o seu
    // registro: o resultado teria 1 entrada em vez de 20.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => mudarFila((fila) => enqueuePending(fila, aviso(`s${i}`)))),
    );

    const final = await mudarFila((fila) => fila);
    expect(final).toHaveLength(20);
    expect(final.map(chaveDe)).toEqual(Array.from({ length: 20 }, (_, i) => `eta:s${i}`));
  });

  it('(c) mudança que FALHA rejeita quem chamou mas NÃO trava a vez das próximas', async () => {
    const falha = mudarFila(() => {
      throw new Error('boom no meio do ciclo');
    });
    const seguinte = mudarFila((fila) => enqueuePending(fila, aviso('sobrevivente')));

    await expect(falha).rejects.toThrow('boom no meio do ciclo');
    const final = await seguinte;
    expect(final.map(chaveDe)).toEqual(['eta:sobrevivente']);
    // e a fila GRAVADA continua íntegra (o ciclo que falhou não deixou lixo).
    expect((await mudarFila((fila) => fila)).map(chaveDe)).toEqual(['eta:sobrevivente']);
  });

  it('(a) 2 enfileiramentos CONCORRENTES durante a subida: nenhum passo é perdido', async () => {
    await mudarFila((fila) => enqueuePending(fila, aviso('antigo', '2026-10-02T06:00:00.000Z')));

    // A subida tira um RETRATO (leitura) e envia SEM segurar a trava.
    const retrato = await mudarFila((fila) => fila);
    expect(retrato.map(chaveDe)).toEqual(['eta:antigo']);

    let jaEnfileirou = false;
    const resultado = await flushPendingWrites(retrato, async () => {
      if (jaEnfileirou) return;
      jaEnfileirou = true;
      // No MEIO da rede, o motorista registra mais duas coisas (o `act` do toque offline).
      await Promise.all([
        mudarFila((fila) => enqueuePending(fila, aviso('novo1'))),
        mudarFila((fila) => enqueuePending(fila, aviso('novo2'))),
      ]);
    });

    // Na volta, a fila VIVA perde só o que subiu ('antigo'); o que entrou no meio FICA.
    const filaAtual = await mudarFila((fila) => semPendentesSaidos(fila, retrato, resultado.remaining));
    expect(resultado.sent).toBe(1);
    expect(filaAtual.map(chaveDe).sort()).toEqual(['eta:novo1', 'eta:novo2']);
  });

  it('(d) a remoção preserva o registro do MESMO assunto enfileirado durante o envio (novo queuedAt)', async () => {
    await mudarFila((fila) => enqueuePending(fila, aviso('s1', '2026-10-02T06:00:00.000Z')));
    const retrato = await mudarFila((fila) => fila);

    const resultado = await flushPendingWrites(retrato, async () => {
      // Durante o envio, o MESMO assunto (mesma parada) é re-registrado: queuedAt novo.
      await mudarFila((fila) => enqueuePending(fila, aviso('s1', '2026-10-02T07:00:00.000Z')));
    });

    const filaAtual = await mudarFila((fila) => semPendentesSaidos(fila, retrato, resultado.remaining));
    // O registro do retrato (s1@06:00) saiu; o NOVO (s1@07:00) tem de ficar.
    expect(filaAtual).toHaveLength(1);
    expect(filaAtual[0]).toMatchObject({ stopId: 's1', queuedAt: '2026-10-02T07:00:00.000Z' });
    expect(chaveDoPendente(filaAtual[0])).toBe('eta:s1@2026-10-02T07:00:00.000Z');
  });
});

describe('mudarOutbox — serializador do OUTBOX (é aqui que o passo sumia)', () => {
  it('(a) flush no meio de 2 enfileiramentos concorrentes: nenhum passo perdido', async () => {
    await mudarOutbox((fila) => enqueueEvent(fila, evento('s1', 'arrived', 't1')));

    // Retrato do outbox (o que a subida vai enviar) — a rede NÃO segura a trava.
    const retrato = await mudarOutbox((fila) => fila);
    expect(retrato.map(chaveDoEvento)).toEqual(['s1@t1']);

    // O envio deu certo (remaining = []). No MEIO, dois toques entram na fila.
    const remaining: DriverEvent[] = [];
    await Promise.all([
      mudarOutbox((fila) => enqueueEvent(fila, evento('s2', 'picked_up', 't2'))),
      mudarOutbox((fila) => enqueueEvent(fila, evento('s3', 'completed', 't3'))),
    ]);

    const final = await mudarOutbox((fila) => semRegistrosSaidos(fila, retrato, remaining));
    // Antes da correção, o `saveOutbox(remaining)` da subida APAGAVA s2/s3 — aqui eles sobrevivem.
    expect(final.map((e) => e.stopId).sort()).toEqual(['s2', 's3']);
  });

  it('(d) a remoção preserva o passo NOVO da mesma parada (createdAt diferente)', async () => {
    await mudarOutbox((fila) => enqueueEvent(fila, evento('s1', 'arrived', 't1')));
    const retrato = await mudarOutbox((fila) => fila);

    // Durante o envio, a MESMA parada recebe outro passo (o enqueueEvent funde os passos).
    await mudarOutbox((fila) => enqueueEvent(fila, evento('s1', 'completed', 't2')));

    const final = await mudarOutbox((fila) => semRegistrosSaidos(fila, retrato, []));
    expect(final).toHaveLength(1);
    expect(final[0].createdAt).toBe('t2');
  });

  it('preserva o passo quando a subida PARA no meio por REDE (remaining é sufixo)', async () => {
    // Fila do retrato: [a, b, c]. A subida sobe 'a' e falha por rede em 'b' → remaining = [b, c].
    await mudarOutbox((fila) => enqueueEvent(fila, evento('a', 'arrived', 'ta')));
    await mudarOutbox((fila) => enqueueEvent(fila, evento('b', 'arrived', 'tb')));
    await mudarOutbox((fila) => enqueueEvent(fila, evento('c', 'arrived', 'tc')));
    const retrato = await mudarOutbox((fila) => fila);

    // Durante a rede, um passo novo entra.
    await mudarOutbox((fila) => enqueueEvent(fila, evento('z', 'completed', 'tz')));

    const remaining = retrato.slice(1); // b, c ficaram
    const final = await mudarOutbox((fila) => semRegistrosSaidos(fila, retrato, remaining));
    // Só 'a' saiu; b, c e o novo 'z' permanecem, na ordem.
    expect(final.map((e) => e.stopId)).toEqual(['b', 'c', 'z']);
  });
});
