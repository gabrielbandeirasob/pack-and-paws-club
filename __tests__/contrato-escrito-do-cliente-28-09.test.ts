/**
 * CONTRATO DE CORES ESCRITO PELO CLIENTE (28/09/2026) — os seis dias, um por um.
 *
 * Ele escreveu, com estas palavras:
 *   * "Default, Peacock — daycare normal";
 *   * "Avocado — pick up ou drop off do boarding (…) através dos drivers" / "Quem for avocado no dia de
 *     drop off ele entra como um ponto na rota normal";
 *   * "Basil — os dias do cachorro no boarding e por via de regra todo boarding vai pro daycare (…)
 *     não entra como parada na rota, mas entram na lista de total pack e contagem do dia";
 *   * "Cocoa (…) o mesmo que o Avocado, a diferença está no horário (…) no pick up cocoa (…) ele entra no
 *     total de cães mas NÃO entra no total pack porque o cão não estará no day care — por outro lado no
 *     dia de drop off cocoa o cão inicia o dia na van assim como no avocado e no basil".
 *
 * Estes vetores travam o que o app FAZ com cada dia (é o aceite combinado com ele).
 */
import { buildDay, transportPool, vanPool, type ReservationRecord } from '@/features/calendar/dayMath';
import { dayIndicatorsFrom } from '@/features/dashboard/dayOperation';
import { dogsOfDaySummary } from '@/features/dashboard/dayService';

const DIA = '2026-09-28';

const cao = (id: string, nome: string): ReservationRecord['dog'] => ({ id, dogName: nome, clientName: 'Cliente' });

function reserva(id: string, nome: string, extras: Partial<ReservationRecord>): ReservationRecord {
  return {
    id,
    dog: cao(id, nome),
    status: 'confirmed',
    serviceType: 'daycare',
    startDate: DIA,
    endDate: DIA,
    transportRequired: true,
    ...extras,
  };
}

/** O dia como o app o mostra: listas, Total Pack e as duas listas do Dispatch. */
function diaDe(reserva: ReservationRecord) {
  const dia = buildDay(DIA, [reserva], []);
  const indicadores = dayIndicatorsFrom({
    daycareCount: dia.daycare.length,
    boardingCount: dia.boarding.length,
    dogs: dogsOfDaySummary(dia),
    entries: [],
    revenueCents: null,
  });
  return {
    indicadores,
    paradas: transportPool(dia).map((item) => item.dogName),
    naVan: vanPool(dia).map((item) => item.dogName),
  };
}

it('Daycare normal (default/Peacock): parada da rota, vai pro daycare e entra no Total Pack', () => {
  expect(diaDe(reserva('r1', 'Kona', { serviceType: 'daycare', transportRequired: true }))).toEqual({
    indicadores: { daycare: 1, boarding: 0, totalDogs: 1, pack: 1, revenueCents: null },
    paradas: ['Kona'],
    naVan: [],
  });
});

it('Avocado (chegada ou saída do boarding): é ponto normal da rota e vai pro daycare', () => {
  expect(diaDe(reserva('r1', 'Filó', { serviceType: 'boarding', transportRequired: true, goesToDaycare: true }))).toEqual({
    indicadores: { daycare: 0, boarding: 1, totalDogs: 1, pack: 1, revenueCents: null },
    paradas: ['Filó'],
    naVan: [],
  });
});

it('Basil (dia do meio da hospedagem): já está na van, NÃO é parada da rota e entra no Total Pack', () => {
  expect(diaDe(reserva('r1', 'Oreo', { serviceType: 'boarding', transportRequired: false, goesToDaycare: true }))).toEqual({
    indicadores: { daycare: 0, boarding: 1, totalDogs: 1, pack: 1, revenueCents: null },
    paradas: [],
    naVan: ['Oreo'],
  });
});

it('Cocoa na CHEGADA: conta no total de cães, mas fica FORA do Total Pack e fora da van', () => {
  expect(diaDe(reserva('r1', 'Thor', { serviceType: 'boarding', transportRequired: false, goesToDaycare: false }))).toEqual({
    indicadores: { daycare: 0, boarding: 1, totalDogs: 1, pack: 0, revenueCents: null },
    paradas: [],
    naVan: [],
  });
});

it('Cocoa na SAÍDA: começa o dia na van como o Basil, entra na contagem e no Total Pack', () => {
  expect(diaDe(reserva('r1', 'Levi M', { serviceType: 'boarding', transportRequired: false, goesToDaycare: true }))).toEqual({
    indicadores: { daycare: 0, boarding: 1, totalDogs: 1, pack: 1, revenueCents: null },
    paradas: [],
    naVan: ['Levi M'],
  });
});

it('o X do gestor continua tirando o cão do pack, mesmo com o padrão novo', () => {
  const dia = buildDay(DIA, [reserva('r1', 'Shatu', { serviceType: 'boarding', transportRequired: false, goesToDaycare: true })], []);
  const indicadores = dayIndicatorsFrom({
    daycareCount: dia.daycare.length,
    boardingCount: dia.boarding.length,
    dogs: dogsOfDaySummary(dia),
    entries: [{ dogId: 'r1', inPack: false, walkerId: null }],
    revenueCents: null,
  });
  expect(indicadores.pack).toBe(0);
  expect(indicadores.totalDogs).toBe(1);
});
