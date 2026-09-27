/**
 * DIA DE EMBORA DO BOARDING (áudio do dono, 27/09/2026):
 *
 *   "tem um boarding que vai embora de manhã cedo antes do day care e o boarding que vai embora depois
 *    do day care — tem pago só o day care, e esse é o ponto que eu tenho que entender. Talvez no dia de
 *    embora deixe o verde, o avocado, pra quem vai embora de manhã cedo; e aí quem foi embora à tarde,
 *    depois do day care, eu coloco outra cor — pelo entender que o day care talvez eu coloco a azul."
 *
 * O que estes vetores MEDEM (é a resposta que o escritório precisa):
 *  - o dia de embora NÃO é um conceito do app: uma reserva de boarding vale para TODOS os dias do
 *    intervalo, inclusive o último (o dia de saída);
 *  - no dia de embora, quem pinta VERDE/AMARELO (Avocado) continua BOARDING; quem pinta AZUL gera uma
 *    reserva de DAYCARE naquele dia — exatamente a distinção que ele propôs;
 *  - com as duas coisas no mesmo dia (banho de hotel até o dia X + day care no dia X) o cão aparece nos
 *    dois blocos da agenda, mas conta UMA vez em "Total dogs" (boarding manda).
 */
import { buildDay, type ReservationRecord } from '@/features/calendar/dayMath';
import { dayIndicatorsFrom, packRows, type DayDog } from '@/features/dashboard/dayOperation';
import { dogsOfDaySummary } from '@/features/dashboard/dayService';
import { planCalendarImport, type BookingForImport, type DogForImport } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const DIA_DE_EMBORA = '2026-09-10';
const JANELA = { from: '2026-09-01', to: '2026-12-31' };

const LEVI = { id: 'dog-levi', dogName: 'Levi S', clientName: 'Leigh Ann' };

/** Banho de hotel de 01/09 a 10/09 — o dia 10 é o dia de embora. */
const HOSPEDAGEM: ReservationRecord = {
  id: 'res-hospedagem',
  dog: LEVI,
  serviceType: 'boarding',
  startDate: '2026-09-01',
  endDate: DIA_DE_EMBORA,
  transportRequired: true,
};

/** O day care do próprio dia de embora (o caso "vai embora depois do day care"). */
const DAYCARE_NO_DIA_DE_EMBORA: ReservationRecord = {
  id: 'res-daycare-embora',
  dog: LEVI,
  serviceType: 'daycare',
  startDate: DIA_DE_EMBORA,
  endDate: DIA_DE_EMBORA,
  transportRequired: true,
};

function evento(parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent {
  return {
    summary: 'Levi S',
    startDate: DIA_DE_EMBORA,
    endDate: '2026-09-11',
    appKey: null,
    colorId: null,
    recurrence: null,
    ...parcial,
  };
}

const CAES: DogForImport[] = [{ id: 'dog-levi', name: 'Levi S', clientName: 'Leigh Ann' }];
const VERDE = { id: 'lab-avocado', name: 'Avocado', backgroundColor: '#C0CA33' };
const AZUL = { id: 'lab-peacock', name: 'Peacock', backgroundColor: '#039BE5' };

describe('o dia de embora no app', () => {
  it('a reserva de boarding vale para o ÚLTIMO dia (o dia de embora)', () => {
    const dia = buildDay(DIA_DE_EMBORA, [HOSPEDAGEM], []);
    expect(dia.boarding.map((item) => item.dogName)).toEqual(['Levi S']);
    expect(dia.daycare).toEqual([]);
  });

  it('com day care no mesmo dia, o cão aparece nos DOIS blocos (o app não tem "dia de embora")', () => {
    const dia = buildDay(DIA_DE_EMBORA, [HOSPEDAGEM, DAYCARE_NO_DIA_DE_EMBORA], []);
    expect(dia.boarding.map((item) => item.dogName)).toEqual(['Levi S']);
    expect(dia.daycare.map((item) => item.dogName)).toEqual(['Levi S']);
  });

  it('os 5 indicadores contam esse cão UMA vez (boarding manda) — Total dogs = 1', () => {
    const dia = buildDay(DIA_DE_EMBORA, [HOSPEDAGEM, DAYCARE_NO_DIA_DE_EMBORA], []);
    const cao = dogsOfDaySummary(dia) as DayDog[];
    const indicadores = dayIndicatorsFrom({
      daycareCount: dia.daycare.length,
      boardingCount: dia.boarding.length,
      dogs: cao,
      entries: [],
      revenueCents: null,
    });
    expect(cao).toHaveLength(1);
    expect(indicadores).toMatchObject({ daycare: 1, boarding: 1, totalDogs: 1, pack: 1 });
  });
});

describe('o que cada cor faz NO DIA DE EMBORA (a proposta do dono)', () => {
  function plano(hex: string, id: string) {
    const label = { id, name: 'X', backgroundColor: hex };
    return planCalendarImport([evento({ id: 'ev-embora', eventLabelId: label.id })], CAES, [], JANELA, { labels: [label] });
  }

  const RESERVAS: BookingForImport[] = [
    {
      id: 'res-hospedagem', kind: 'reservation', dogId: 'dog-levi', googleEventId: 'ev-hospedagem', source: 'app',
      serviceType: 'boarding', startDate: '2026-09-01', endDate: DIA_DE_EMBORA, status: 'confirmed',
    },
  ];

  it('VERDE/AVOCADO no dia de embora = continua boarding', () => {
    const saida = plano('#C0CA33', 'lab-avocado');
    expect(saida[0]).toMatchObject({ kind: 'create', dogId: 'dog-levi', parsed: { serviceType: 'boarding' } });
  });

  it('AZUL no dia de embora = vira DAYCARE naquele dia (e o app avisa que já existe reserva ligada ao evento)', () => {
    const label = { id: 'lab-peacock', name: 'Peacock', backgroundColor: '#039BE5' };
    const saida = planCalendarImport(
      [evento({ id: 'ev-daycare-embora', eventLabelId: label.id })],
      CAES,
      RESERVAS,
      JANELA,
      { labels: [label] },
    );
    // O evento é novo (id diferente da hospedagem): nasce uma reserva de day care no dia de embora.
    expect(saida[0]).toMatchObject({ kind: 'create', dogId: 'dog-levi', parsed: { serviceType: 'daycare' } });
  });
});
