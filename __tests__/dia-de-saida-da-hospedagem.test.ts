/**
 * DIA DE SAÍDA da hospedagem — pedido do cliente em áudio (26/10/2026), encaminhado pelo dono:
 * *"a última lá da casinha foi embora de manhã cedo. E os outros dois, o Lucky, o Levi Miller, vão
 * embora à tarde. Como que a gente consegue fazer pra ele ter essa leitura?"*
 *
 * O que estava errado: o app tratava CHEGADA e SAÍDA como a mesma coisa (`movement_day`), e a regra
 * herdada era a da chegada — o cão entra no pickup e fica FORA da entrega. No dia de saída isso é o
 * inverso do que acontece na rua: o cão já dormiu no hotel (está na van de manhã) e só precisa ser
 * levado para CASA à tarde. Resultado: Lucky, Levi M e Indie saíam do dia sem nenhuma parada de
 * entrega e o van nunca era mandado para a casa deles.
 *
 * A direção sai das DATAS, não do horário do bloco: o escritório confirmou em 26/10/2026 que a hora do
 * evento 🏠 é só marcador do dia ("é só um marcador do dia").
 */
import { buildDay, dogsJaNaVan, transportPoolForPhase, vanPool, type ReservationRecord } from '@/features/calendar/dayMath';
import { parseBookingEvents } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const HOJE = '2026-10-26';

const cao = (id: string, nome: string, cliente: string) => ({ id, dogName: nome, clientName: cliente });

const reserva = (parcial: Partial<ReservationRecord> & { id: string; serviceType: 'boarding' | 'daycare' }): ReservationRecord => ({
  status: 'confirmed',
  startDate: HOJE,
  endDate: HOJE,
  transportRequired: true,
  goesToDaycare: true,
  dog: cao('dog-lucky', 'Lucky', 'Marina'),
  ...parcial,
});

/** A estadia (a barra) que terminou: começou no dia 24 e acaba hoje. */
const estadiaQueTerminaHoje = reserva({ id: 'r-estadia', serviceType: 'boarding', startDate: '2026-10-24', endDate: HOJE });

/** A linha de UM dia que o calendário pinta no dia da saída. */
const marcadorDoDia = reserva({ id: 'r-marcador', serviceType: 'boarding', startDate: HOJE, endDate: HOJE, movementDay: true });

const nomes = (itens: { dogName: string }[]) => itens.map((i) => i.dogName);

describe('dia de SAÍDA da hospedagem', () => {
  it('o cão que vai embora hoje ENTRA na entrega (a van leva para casa)', () => {
    const dia = buildDay(HOJE, [estadiaQueTerminaHoje, marcadorDoDia], []);
    expect(nomes(transportPoolForPhase(dia, 'dropoff'))).toContain('Lucky');
  });

  it('o cão que vai embora hoje NÃO entra no pickup (ele dormiu no hotel)', () => {
    const dia = buildDay(HOJE, [estadiaQueTerminaHoje, marcadorDoDia], []);
    expect(nomes(transportPoolForPhase(dia, 'pickup'))).not.toContain('Lucky');
  });

  it('e continua na lista de quem já está na van, para o gestor achar', () => {
    const dia = buildDay(HOJE, [estadiaQueTerminaHoje, marcadorDoDia], []);
    expect(dogsJaNaVan(dia).has('dog-lucky')).toBe(true);
    expect(nomes(vanPool(dia))).toContain('Lucky');
  });

  it('a SAÍDA vence a CHEGADA quando as duas linhas do dia discordam', () => {
    const dia = buildDay(HOJE, [estadiaQueTerminaHoje, marcadorDoDia], []);
    const item = dia.boarding.find((i) => i.dogId === 'dog-lucky');
    expect(item?.movementToday).toBe('departure');
    expect(item?.movementDay).toBe(true);
  });

  it('dia de CHEGADA continua igual: pickup sim, entrega não', () => {
    const chegada = reserva({ id: 'r-chegada', serviceType: 'boarding', startDate: HOJE, endDate: '2026-10-30', movementDay: true });
    const dia = buildDay(HOJE, [chegada], []);
    expect(dia.boarding[0].movementToday).toBe('arrival');
    expect(nomes(transportPoolForPhase(dia, 'pickup'))).toContain('Lucky');
    expect(nomes(transportPoolForPhase(dia, 'dropoff'))).not.toContain('Lucky');
    expect(dogsJaNaVan(dia).has('dog-lucky')).toBe(false);
  });

  it('dia de HOTEL puro (sem movimento) segue fora das duas pernas', () => {
    const hotel = reserva({ id: 'r-hotel', serviceType: 'boarding', startDate: '2026-10-20', endDate: '2026-10-30' });
    const dia = buildDay(HOJE, [hotel], []);
    expect(dia.boarding[0].movementToday).toBeNull();
    expect(nomes(transportPoolForPhase(dia, 'pickup'))).not.toContain('Lucky');
    expect(nomes(transportPoolForPhase(dia, 'dropoff'))).not.toContain('Lucky');
    expect(dogsJaNaVan(dia).has('dog-lucky')).toBe(true);
  });

  it('uma linha de um dia sozinha (sem a estadia) NÃO inventa saída', () => {
    const so = reserva({ id: 'r-so', serviceType: 'boarding', startDate: HOJE, endDate: HOJE, movementDay: true });
    const dia = buildDay(HOJE, [so], []);
    expect(dia.boarding[0].movementToday).toBe('arrival');
    expect(nomes(transportPoolForPhase(dia, 'dropoff'))).not.toContain('Lucky');
  });

  it('cão de daycare puro não é afetado pela mudança', () => {
    const daycare = reserva({ id: 'r-daycare', serviceType: 'daycare' });
    const dia = buildDay(HOJE, [daycare], []);
    expect(nomes(transportPoolForPhase(dia, 'pickup'))).toContain('Lucky');
    expect(nomes(transportPoolForPhase(dia, 'dropoff'))).toContain('Lucky');
    expect(dia.daycare[0].movementToday).toBeNull();
  });
});


/**
 * ☀️ = o TUTOR BUSCA DE MANHÃ — decisão do dono (26/10/2026), a partir do mesmo áudio do cliente.
 * O canal é o TÍTULO (o horário do bloco é só marcador do dia, confirmado pelo escritório):
 *   Lucky 🏠     → vai para casa à tarde → entra na entrega
 *   Indie 🏠 ☀️  → o tutor busca de manhã → conta no dia, mas fora das duas pernas
 */
const evento = (summary: string): RemoteEvent => ({
  id: 'e-1',
  summary,
  startDate: HOJE,
  endDate: HOJE,
  appKey: null,
  colorId: '2', // Sage (verde) = hospedagem
  recurrence: null,
});

describe('☀️ no título do bloco de saída', () => {
  it('lê a marca e mantém o nome do cão limpo', () => {
    const [lido] = parseBookingEvents(evento('Indie 🏠 ☀️'), []);
    expect(lido).toMatchObject({ dogName: 'Indie', movementDay: true, ownerPickup: true });
  });

  it('aceita a variante em texto ("AM") e não deixa o AM virar nome', () => {
    const [lido] = parseBookingEvents(evento('Indie 🏠 AM'), []);
    expect(lido).toMatchObject({ dogName: 'Indie', ownerPickup: true });
  });

  it('🏠 sozinho continua sendo saída da TARDE', () => {
    const [lido] = parseBookingEvents(evento('Lucky 🏠'), []);
    expect(lido?.dogName).toBe('Lucky');
    expect(lido?.ownerPickup).toBeUndefined();
  });

  it('o ☀️ tira o cão das DUAS pernas e ele continua contando no dia', () => {
    const comDono = reserva({ id: 'r-marcador', serviceType: 'boarding', startDate: HOJE, endDate: HOJE, movementDay: true, ownerPickup: true });
    const dia = buildDay(HOJE, [estadiaQueTerminaHoje, comDono], []);
    expect(nomes(transportPoolForPhase(dia, 'pickup'))).not.toContain('Lucky');
    expect(nomes(transportPoolForPhase(dia, 'dropoff'))).not.toContain('Lucky');
    // conta no dia (aparece no boarding e na lista de quem já está na van)
    expect(nomes(dia.boarding)).toContain('Lucky');
    expect(dogsJaNaVan(dia).has('dog-lucky')).toBe(true);
  });

  it('sem o ☀️ o mesmo cão entra na entrega (a marca é o que muda o dia)', () => {
    const semDono = reserva({ id: 'r-marcador', serviceType: 'boarding', startDate: HOJE, endDate: HOJE, movementDay: true });
    const dia = buildDay(HOJE, [estadiaQueTerminaHoje, semDono], []);
    expect(nomes(transportPoolForPhase(dia, 'dropoff'))).toContain('Lucky');
  });
});
