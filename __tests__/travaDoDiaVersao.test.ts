/**
 * TRAVA DO DIA DA OPERAÇÃO (migração 202610020050) — o app ligado à versão do dia.
 *
 * Dois gestores salvando o MESMO dia se sobrescreviam em silêncio. O banco passou a contar
 * `lock_version` e a recusar gravação feita em cima de versão velha (gatilho `dia_sem_sobrescrita`,
 * hint `stale_day`). Aqui se prova o lado do APP:
 *  - a LEITURA traz `lock_version` (do plano do dia e de cada cão do pack);
 *  - a GRAVAÇÃO manda `lock_version_base` = a versão lida, quando o app a conhece;
 *  - a gravação de uma build antiga (sem versão) continua funcionando — nada de `lock_version_base`.
 */
import {
  AVISO_DIA_ALTERADO,
  ehErroDiaDesatualizado,
  loadDayPlan,
  loadPackEntries,
  saveDayPlan,
  setPackFlag,
  setPackWalker,
} from '@/features/dashboard/dayService';

/** Cliente falso que CAPTURA o corpo de cada `upsert` e devolve o resultado combinado. */
function clienteEscrita(resultado: { data: unknown; error?: unknown } = { data: [{ id: 'p1' }] }) {
  const upserts: Record<string, unknown>[] = [];
  const from = jest.fn(() => ({
    upsert: jest.fn((body: Record<string, unknown>) => {
      upserts.push(body);
      return { select: jest.fn().mockResolvedValue({ data: resultado.data, error: resultado.error ?? null }) };
    }),
  }));
  return { client: { from } as never, upserts };
}

/** Cliente falso só de LEITURA: `select().eq().eq()` (await direto) e `select().maybeSingle()`. */
function clienteLeitura(data: unknown) {
  const chain: never = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  } as never;
  return { client: { from: jest.fn(() => chain) } as never };
}

describe('trava do dia — leitura da versão', () => {
  it('loadDayPlan devolve lockVersion lido do banco', async () => {
    const { client } = clienteLeitura({
      revenue_cents: 500,
      walk_location: 'Golden Gate Park',
      photo_idea: 'Sunset',
      lock_version: 3,
    });
    const plano = await loadDayPlan(client, 'org-1', '2026-10-02');
    expect(plano).toEqual({
      revenueCents: 500,
      walkLocation: 'Golden Gate Park',
      photoIdea: 'Sunset',
      lockVersion: 3,
    });
  });

  it('loadDayPlan sem linha gravada usa a versão 0 (nada salvo ainda)', async () => {
    const { client } = clienteLeitura(null);
    const plano = await loadDayPlan(client, 'org-1', '2026-10-02');
    expect(plano.lockVersion).toBe(0);
  });

  it('loadPackEntries lê lock_version por cão', async () => {
    const { client } = clienteLeitura([
      { dog_id: 'd1', in_pack: true, walker_id: null, lock_version: 7 },
      { dog_id: 'd2', in_pack: false, walker_id: 'u-1', lock_version: 2 },
    ]);
    const entries = await loadPackEntries(client, 'org-1', '2026-10-02');
    expect(entries).toEqual([
      { dogId: 'd1', inPack: true, walkerId: null, lockVersion: 7 },
      { dogId: 'd2', inPack: false, walkerId: 'u-1', lockVersion: 2 },
    ]);
  });
});

describe('trava do dia — versão nas gravações', () => {
  it('saveDayPlan manda lock_version_base quando recebe a versão', async () => {
    const { client, upserts } = clienteEscrita();
    await saveDayPlan(client, {
      organizationId: 'org-1',
      day: '2026-10-02',
      walkLocation: 'Golden Gate Park',
      lockVersion: 2,
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].lock_version_base).toBe(2);
  });

  it('saveDayPlan NÃO manda lock_version_base quando não recebe a versão (build antiga)', async () => {
    const { client, upserts } = clienteEscrita();
    await saveDayPlan(client, { organizationId: 'org-1', day: '2026-10-02', revenueCents: 1000 });
    expect(upserts).toHaveLength(1);
    expect('lock_version_base' in upserts[0]).toBe(false);
  });

  it('setPackFlag manda lock_version_base quando recebe a versão', async () => {
    const { client, upserts } = clienteEscrita();
    await setPackFlag(client, { organizationId: 'org-1', day: '2026-10-02', dogId: 'd1', inPack: false, lockVersion: 5 });
    expect(upserts[0].lock_version_base).toBe(5);
  });

  it('setPackFlag NÃO manda lock_version_base quando não recebe a versão', async () => {
    const { client, upserts } = clienteEscrita();
    await setPackFlag(client, { organizationId: 'org-1', day: '2026-10-02', dogId: 'd1', inPack: true });
    expect('lock_version_base' in upserts[0]).toBe(false);
  });

  it('setPackWalker manda lock_version_base quando recebe a versão', async () => {
    const { client, upserts } = clienteEscrita();
    await setPackWalker(client, { organizationId: 'org-1', day: '2026-10-02', dogId: 'd1', walkerId: 'u-1', lockVersion: 4 });
    expect(upserts[0].lock_version_base).toBe(4);
  });

  it('erro do gatilho (stale_day) estoura com a mensagem original do banco', async () => {
    const { client } = clienteEscrita({
      data: null,
      error: {
        message:
          'Another device changed this day while you were editing (day version 2, your copy was 1). Reload the screen and save again.',
      },
    });
    await expect(
      saveDayPlan(client, { organizationId: 'org-1', day: '2026-10-02', revenueCents: 10, lockVersion: 1 }),
    ).rejects.toThrow(/Another device changed this day/);
  });
});

describe('trava do dia — reconhecer a recusa para avisar a tela', () => {
  it('ehErroDiaDesatualizado só é true para a recusa do banco', () => {
    expect(
      ehErroDiaDesatualizado(new Error('Another device changed this day while you were editing (day version 2, your copy was 1).')),
    ).toBe(true);
    expect(ehErroDiaDesatualizado(new Error('Could not save the day plan.'))).toBe(false);
    expect(ehErroDiaDesatualizado('Another device changed this day')).toBe(false);
  });

  it('o aviso em português existe e fala de outro aparelho + salvar de novo', () => {
    expect(AVISO_DIA_ALTERADO).toMatch(/outro aparelho/i);
    expect(AVISO_DIA_ALTERADO).toMatch(/salve de novo/i);
  });
});
