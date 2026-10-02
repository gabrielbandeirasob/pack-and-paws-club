/**
 * PROPRIEDADE/BEI­RADA — CONTADORES DO DIA e a linha do PACK (`pack_entries`).
 *
 * A vistoria de 02/10/2026 achou dois números para a mesma coisa (Home contava sem deduplicar). Aqui
 * ficam os beirais que ainda não estavam travados:
 *  - cão em boarding E daycare no MESMO dia conta UMA vez, como boarding;
 *  - reserva CANCELADA e ocorrência PAUSADA não contam (nem no daycare, nem no boarding);
 *  - cão que NÃO passa pelo daycare (chegada fora do horário) continua no total, mas sai do pack;
 *  - o X manual do pack SOBREVIVE à releitura e a escolher quem caminha não devolve o cão ao pack
 *    (cada gravação manda SÓ o campo que mudou — o outro não é apagado).
 */
import {
  contagemDoDia,
  dogsOfDaySummary,
  loadPackEntries,
  setPackFlag,
  setPackWalker,
} from '@/features/dashboard/dayService';
import { buildDay, type DaySummary, type ReservationRecord, type RecurringScheduleRecord } from '@/features/calendar/dayMath';
import { dogsOfDay, packRows, type DayDog } from '@/features/dashboard/dayOperation';

/* ------------------------- cliente Supabase FALSO com memória ------------------------- */

type Linha = { dog_id: string; in_pack: boolean; walker_id: string | null; lock_version: number };

function clienteDePack(iniciais: Linha[] = []) {
  const store = new Map(iniciais.map((l) => [l.dog_id, { ...l }]));
  const upserts: Record<string, unknown>[] = [];
  const client = {
    from: (tabela: string) => {
      if (tabela !== 'pack_entries') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: [...store.values()].map((l) => ({ ...l })), error: null }),
          }),
        }),
        upsert: (corpo: Record<string, unknown>) => {
          upserts.push(corpo);
          const dogId = String(corpo.dog_id);
          const atual = store.get(dogId) ?? { dog_id: dogId, in_pack: true, walker_id: null, lock_version: 0 };
          const novo: Linha = { ...atual };
          if ('in_pack' in corpo) novo.in_pack = Boolean(corpo.in_pack);
          if ('walker_id' in corpo) novo.walker_id = (corpo.walker_id as string | null) ?? null;
          if (corpo.lock_version_base !== undefined) novo.lock_version = Number(corpo.lock_version_base) + 1;
          store.set(dogId, novo);
          return { select: async () => ({ data: [{ id: dogId }], error: null }) };
        },
      };
    },
  };
  return { client: client as never, upserts, store };
}

const DAY = '2026-10-02';

describe('contadores do dia — cão contado UMA vez e excluído quando não é do dia', () => {
  const reserva = (over: Partial<ReservationRecord> & { id: string }): ReservationRecord => ({
    dog: { id: 'd1', dogName: 'Lucky', clientName: 'Ana', clientId: 'c1' },
    serviceType: 'daycare',
    startDate: DAY,
    endDate: DAY,
    transportRequired: true,
    goesToDaycare: true,
    ...over,
  });

  it('cão em boarding E daycare no mesmo dia: conta uma vez, como boarding', () => {
    const dia = buildDay(DAY, [reserva({ id: 'r-day', serviceType: 'daycare' }), reserva({ id: 'r-bo', serviceType: 'boarding' })], []);
    expect(contagemDoDia(dia)).toEqual({ daycare: 0, boarding: 1 });
    expect(dogsOfDaySummary(dia)).toHaveLength(1);
  });

  it('reserva CANCELADA não aparece em lugar nenhum do dia', () => {
    const dia = buildDay(DAY, [reserva({ id: 'r-x', status: 'cancelled' })], []);
    expect(dia.daycare).toHaveLength(0);
    expect(contagemDoDia(dia)).toEqual({ daycare: 0, boarding: 0 });
  });

  it('ocorrência PAUSADA de recorrência é filtrada do resumo e da contagem', () => {
    const serie: RecurringScheduleRecord = {
      id: 's1',
      dog: { id: 'd1', dogName: 'Lucky', clientName: 'Ana', clientId: 'c1' },
      weekdays: [5], // 2026-10-02 é sexta
      startDate: '2026-09-01',
      endDate: null,
      active: true,
      transportRequired: false,
    };
    const dia = buildDay(DAY, [], [serie]);
    // O `buildDay` já tira o dia pulado; aqui forçamos uma pausa na lista de tela para travar o filtro.
    const comPausa: DaySummary = { daycare: dia.daycare.map((item) => ({ ...item, paused: true })), boarding: [] };
    expect(dogsOfDaySummary(comPausa)).toHaveLength(0);
    expect(contagemDoDia(comPausa)).toEqual({ daycare: 0, boarding: 0 });
  });

  it('cão SEM daycare (chegada fora do horário) conta no total mas fica FORA do pack', () => {
    const cao: DayDog = { dogId: 'd1', dogName: 'Cocoa', clientName: 'Ana', serviceType: 'daycare', goesToDaycare: false };
    expect(dogsOfDay([cao], [])).toHaveLength(1);
    const rows = packRows([cao], []);
    expect(rows[0].inPack).toBe(false); // padrão = goesToDaycare; sem linha no banco não entra no pack
    // Um X manual `true` explícito sobrepõe o padrão.
    expect(packRows([cao], [{ dogId: 'd1', inPack: true, walkerId: null }])[0].inPack).toBe(true);
  });

  it('PROPRIEDADE (300 dias aleatórios): contagem bate com o resumo, não é negativa e não inventa cão', () => {
    let semente = 987654321;
    const rnd = () => {
      semente = (semente * 1103515245 + 12345) & 0x7fffffff;
      return semente / 0x7fffffff;
    };
    for (let caso = 0; caso < 300; caso += 1) {
      const quantos = Math.floor(rnd() * 10);
      const reservas: ReservationRecord[] = Array.from({ length: quantos }, (_, i) => ({
        id: `r${i}`,
        dog: { id: `d${i}`, dogName: `Dog ${i}`, clientName: `C ${i}` },
        serviceType: rnd() < 0.5 ? 'daycare' : 'boarding',
        startDate: '2026-10-01',
        endDate: '2026-10-03',
        transportRequired: rnd() < 0.5,
        goesToDaycare: rnd() < 0.7,
      }));
      const dia = buildDay(DAY, reservas, []);
      const contagem = contagemDoDia(dia);
      const resumo = dogsOfDaySummary(dia);
      expect(contagem.daycare).toBe(resumo.filter((c) => c.serviceType === 'daycare').length);
      expect(contagem.boarding).toBe(resumo.filter((c) => c.serviceType === 'boarding').length);
      expect(contagem.daycare).toBeGreaterThanOrEqual(0);
      expect(contagem.boarding).toBeGreaterThanOrEqual(0);
      const distintos = new Set([...dia.daycare, ...dia.boarding].map((i) => i.dogId)).size;
      expect(contagem.daycare + contagem.boarding).toBeLessThanOrEqual(distintos);
    }
  });
});

describe('pack_entries — o X manual sobrevive à releitura e não é desfeito por outro campo', () => {
  it('tirar do pack grava e a releitura confirma (X sobrevive à recarga)', async () => {
    const { client } = clienteDePack([{ dog_id: 'd1', in_pack: true, walker_id: null, lock_version: 0 }]);
    await setPackFlag(client, { organizationId: 'org', day: DAY, dogId: 'd1', inPack: false, lockVersion: 0 });
    const [linha] = await loadPackEntries(client, 'org', DAY);
    expect(linha).toEqual({ dogId: 'd1', inPack: false, walkerId: null, lockVersion: 1 });
  });

  it('escolher quem caminha NÃO devolve o cão ao pack nem apaga o flag', async () => {
    const { client, upserts } = clienteDePack([{ dog_id: 'd1', in_pack: true, walker_id: null, lock_version: 0 }]);
    await setPackFlag(client, { organizationId: 'org', day: DAY, dogId: 'd1', inPack: false });
    await setPackWalker(client, { organizationId: 'org', day: DAY, dogId: 'd1', walkerId: 'walker-1' });
    const [linha] = await loadPackEntries(client, 'org', DAY);
    expect(linha.inPack).toBe(false); // continua fora do pack
    expect(linha.walkerId).toBe('walker-1');
    expect(upserts[0]).not.toHaveProperty('walker_id'); // tirar do pack não mexe em quem caminha
    expect(upserts[1]).not.toHaveProperty('in_pack'); // escolher o caminhante não mexe no pack
  });

  it('limpar o caminhante grava null sem tocar no flag', async () => {
    const { client, upserts } = clienteDePack([{ dog_id: 'd1', in_pack: false, walker_id: 'w1', lock_version: 3 }]);
    await setPackWalker(client, { organizationId: 'org', day: DAY, dogId: 'd1', walkerId: null, lockVersion: 3 });
    expect(upserts[0]).toMatchObject({ walker_id: null, lock_version_base: 3 });
    expect(upserts[0]).not.toHaveProperty('in_pack');
  });
});
