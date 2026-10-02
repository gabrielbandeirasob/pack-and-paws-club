/**
 * FILA LOCAL POR USUÁRIO — a jornada NÃO some nem é herdada ao trocar de conta (dono, áudio 02/10/2026).
 *
 * O dono alterna entre a conta de MOTORISTA e a de ADMINISTRADOR no MESMO aparelho. A fila local
 * (`pendingWrites`) está numa chave GLOBAL sem dono, então a jornada aberta de um usuário era lida
 * (e recusada/atribuída errado) pela conta seguinte. Estes testes travam a correção:
 *
 *  - cada usuário tem a SUA chave (não existe chave global compartilhada);
 *  - a fila ANTIGA (sem dono) é adotada UMA vez — o que já estava no aparelho não se perde;
 *  - um 2º usuário NÃO herda nem apaga a fila antiga (isolamento);
 *  - uma jornada ABERTA no aparelho sobrevive à troca de conta (o defeito que o dono viu).
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PendingWrite } from '@/features/driver/pendingWrites';
import {
  PENDING_WRITES_LEGACY_KEY,
  PENDING_WRITES_OWNER_KEY,
  carregarFilaDoUsuario,
  decidirAdocaoDaFila,
  gravarFilaDoUsuario,
  pendingWritesKey,
} from '@/features/driver/pendingWritesScope';

const jornadaAberta = (over: Partial<Extract<PendingWrite, { kind: 'shift' }>> = {}): PendingWrite => ({
  kind: 'shift',
  startedAt: '2026-10-02T07:00:00.000Z',
  endedAt: null,
  startReason: 'Journey started at the van',
  endReason: null,
  routeId: 'r1',
  queuedAt: '2026-10-02T07:00:00.000Z',
  ...over,
});

const aviso = (stopId: string): PendingWrite => ({
  kind: 'eta_notice',
  stopId,
  phase: 'pickup',
  queuedAt: '2026-10-02T07:05:00.000Z',
});

/** Rascunho do que está gravado na chave (JSON cru, como o app grava). */
async function lerCru(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('pendingWritesKey — cada usuário tem a sua chave', () => {
  it('usuários diferentes NÃO compartilham chave; sem usuário cai na antiga', () => {
    expect(pendingWritesKey('driver-1')).toBe(`${PENDING_WRITES_LEGACY_KEY}:driver-1`);
    expect(pendingWritesKey('admin-2')).toBe(`${PENDING_WRITES_LEGACY_KEY}:admin-2`);
    expect(pendingWritesKey('driver-1')).not.toBe(pendingWritesKey('admin-2'));
    // Bootstrap/web sem sessão: continua valendo a chave antiga (nada muda para quem não passa id).
    expect(pendingWritesKey(null)).toBe(PENDING_WRITES_LEGACY_KEY);
    expect(pendingWritesKey('   ')).toBe(PENDING_WRITES_LEGACY_KEY);
  });
});

describe('decidirAdocaoDaFila — regra pura da migração de leitura', () => {
  it('sem chave do usuário e fila antiga SEM dono → adota a antiga (não perde o que está no aparelho)', () => {
    const decisao = decidirAdocaoDaFila({
      userId: 'driver-1',
      filaDoUsuario: null,
      filaLegada: [jornadaAberta()],
      donoDoLegado: null,
    });
    expect(decisao.adotouLegado).toBe(true);
    expect(decisao.legadoDeOutro).toBe(false);
    expect(decisao.queue).toHaveLength(1);
    expect(decisao.queue[0]).toMatchObject({ kind: 'shift', endedAt: null });
  });

  it('chave do usuário JÁ existe (mesmo vazia) → vale a dele; não re-adota a antiga', () => {
    const decisao = decidirAdocaoDaFila({
      userId: 'driver-1',
      filaDoUsuario: [],
      filaLegada: [jornadaAberta()],
      donoDoLegado: null,
    });
    expect(decisao.adotouLegado).toBe(false);
    expect(decisao.queue).toEqual([]);
  });

  it('fila antiga marcada com OUTRO usuário → devolve vazia e não encosta na antiga', () => {
    const decisao = decidirAdocaoDaFila({
      userId: 'admin-2',
      filaDoUsuario: null,
      filaLegada: [jornadaAberta()],
      donoDoLegado: 'driver-1',
    });
    expect(decisao.legadoDeOutro).toBe(true);
    expect(decisao.adotouLegado).toBe(false);
    expect(decisao.queue).toEqual([]);
  });

  it('fila antiga marcada com ELE mesmo e a dele sumiu → re-adota (rede de segurança)', () => {
    const decisao = decidirAdocaoDaFila({
      userId: 'driver-1',
      filaDoUsuario: null,
      filaLegada: [jornadaAberta()],
      donoDoLegado: 'driver-1',
    });
    expect(decisao.adotouLegado).toBe(true);
    expect(decisao.queue).toHaveLength(1);
  });
});

describe('carregarFilaDoUsuario — adoção e isolamento no storage', () => {
  it('o MOTORISTA adota a fila antiga deixada pela build anterior (migração de leitura)', async () => {
    // Simula o que a build publicada deixou: chave ANTIGA, sem dono.
    await AsyncStorage.setItem(PENDING_WRITES_LEGACY_KEY, JSON.stringify([jornadaAberta(), aviso('s1')]));

    const fila = await carregarFilaDoUsuario('driver-1');

    expect(fila).toHaveLength(2);
    expect(fila[0]).toMatchObject({ kind: 'shift', endedAt: null });
    // A fila foi para a chave DO motorista...
    expect(await lerCru(pendingWritesKey('driver-1'))).toEqual(fila);
    // ...e a antiga ficou MARCADA com ele (não apagada: rede de segurança).
    expect(await AsyncStorage.getItem(PENDING_WRITES_OWNER_KEY)).toBe('driver-1');
    expect(await lerCru(PENDING_WRITES_LEGACY_KEY)).toEqual(fila);
  });

  it('o ADMIN que entra depois NÃO herda a fila do motorista (nem a apaga)', async () => {
    await AsyncStorage.setItem(PENDING_WRITES_LEGACY_KEY, JSON.stringify([jornadaAberta()]));
    await carregarFilaDoUsuario('driver-1'); // o motorista adota primeiro

    const filaDoAdmin = await carregarFilaDoUsuario('admin-2');

    expect(filaDoAdmin).toEqual([]); // não herda
    expect(await lerCru(pendingWritesKey('admin-2'))).toBeNull(); // não escreve nada na conta dele
    // A fila do motorista continua intacta, na chave dele e na antiga.
    expect(await lerCru(pendingWritesKey('driver-1'))).toHaveLength(1);
    expect(await lerCru(PENDING_WRITES_LEGACY_KEY)).toHaveLength(1);
  });

  it('⚠️ a jornada ABERTA sobrevive à troca de conta (motorista → admin → motorista)', async () => {
    // 1) MOTORISTA bate o clock in SEM SINAL → jornada aberta gravada na fila DELE.
    await gravarFilaDoUsuario('driver-1', [jornadaAberta({ startReason: 'Manual clock in at home' })]);

    // 2) Troca para a conta de ADMIN: ela lê a PRÓPRIA fila (vazia) e grava algo dela.
    const doAdmin = await carregarFilaDoUsuario('admin-2');
    expect(doAdmin).toEqual([]);
    await gravarFilaDoUsuario('admin-2', [aviso('stop-admin')]);

    // 3) Volta para a conta de MOTORISTA: a jornada aberta está LÁ — não sumiu nem virou a do admin.
    const deVolta = await carregarFilaDoUsuario('driver-1');
    expect(deVolta).toHaveLength(1);
    expect(deVolta[0]).toMatchObject({ kind: 'shift', endedAt: null, startReason: 'Manual clock in at home' });
    // e não misturou nada do administrador.
    expect(deVolta.some((entrada) => entrada.kind === 'eta_notice')).toBe(false);
  });
});
