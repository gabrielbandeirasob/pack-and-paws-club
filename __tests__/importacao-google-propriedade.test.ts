/**
 * PROPRIEDADE/BEI­RADA — IMPORTAÇÃO do Google Calendar.
 *
 * A regra dura (24/09/2026, defeito de produção): o par `start_date`/`end_date` NUNCA pode sair
 * invertido — o banco recusa o insert inteiro (`check (end_date >= start_date)`) e o gestor vê
 * "1 item(s) from Google could not be saved" sem nada ser gravado. Os testes existentes travam
 * formatos conhecidos; este arquivo faz a pergunta MECÂNICA sobre milhares de combinações e cobre os
 * beirais que faltavam: período invertido, título com dois cães, cor desconhecida, cor de
 * cancelamento, e o vermelho que NÃO pode duplicar uma pausa que o gestor já tinha marcado.
 */
import { parseEvent } from '@/features/integrations/google/calendarApi';
import {
  planCalendarImport,
  parseBookingEvent,
  parseBookingEvents,
  fimNaoAntesDoInicio,
  type BookingForImport,
  type DogForImport,
  type ImportOutcome,
  type ParsedBooking,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const AZUL = '7';
const VERDE = '2';
const VERMELHO = '11';
const CINZA = '8'; // Graphite — o app NÃO chuta serviço
const JANELA = { from: '2026-09-24', to: '2027-03-23' };

const cao = (id: string, name: string): DogForImport => ({ id, name, clientName: 'Tutor' });

function evento(over: Partial<RemoteEvent> & { id: string }): RemoteEvent {
  return { summary: 'Pietro', startDate: '2026-09-30', endDate: '2026-10-01', appKey: null, colorId: AZUL, ...over };
}

const cria = (outcomes: ImportOutcome[]) => outcomes.filter((o): o is Extract<ImportOutcome, { kind: 'create' }> => o.kind === 'create');
const revisoes = (outcomes: ImportOutcome[]) => outcomes.filter((o) => o.kind === 'review');

describe('importação — o FIM nunca sai antes do começo (propriedade)', () => {
  it('qualquer combinação de datas/cores/recorrência: create/update sempre com endDate >= startDate', () => {
    const cores = [AZUL, VERDE, VERMELHO, CINZA, null, undefined, '10', '5'];
    const caes = [cao('d1', 'Pietro'), cao('d2', 'Kona')];
    let semente = 135701;
    const rnd = () => {
      semente = (semente * 1103515245 + 12345) & 0x7fffffff;
      return semente / 0x7fffffff;
    };
    const diaAleatorio = () => `2026-${String(9 + Math.floor(rnd() * 3)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
    for (let caso = 0; caso < 800; caso += 1) {
      const inicio = diaAleatorio();
      // Metade das vezes o fim vem INVERTIDO de propósito (evento malformado).
      const fim = rnd() < 0.5 ? diaAleatorio() : '2026-12-31';
      const cor = cores[Math.floor(rnd() * cores.length)];
      const e = evento({ id: `ev${caso}`, startDate: inicio, endDate: fim, colorId: cor as string | null | undefined });
      const plano = planCalendarImport([e], caes, [], JANELA);
      for (const o of plano) {
        if (o.kind === 'create' || o.kind === 'update') {
          expect(o.parsed.endDate >= o.parsed.startDate).toBe(true);
          expect(o.parsed.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
      // E o parser puro também nunca inverte.
      for (const lido of parseBookingEvents(e)) expect(lido.endDate >= lido.startDate).toBe(true);
    }
  });

  it('fimNaoAntesDoInicio: fim vazio, lixo, anterior e igual', () => {
    expect(fimNaoAntesDoInicio('2026-09-30', '')).toBe('2026-09-30');
    expect(fimNaoAntesDoInicio('2026-09-30', 'NaN-NaN-NaN')).toBe('2026-09-30');
    expect(fimNaoAntesDoInicio('2026-09-30', '2026-09-01')).toBe('2026-09-30');
    expect(fimNaoAntesDoInicio('2026-09-30', '2026-09-30')).toBe('2026-09-30');
    expect(fimNaoAntesDoInicio('2026-09-30', '2026-10-05')).toBe('2026-10-05');
  });

  it('evento de UM dia que muda SÓ o horário continua sendo UM dia (fim exclusivo normalizado)', () => {
    // `end.dateTime` é INCLUSIVO; o dia do evento é o do começo, mesmo que o fim mude de hora.
    const remoto = parseEvent({
      id: 'ev-hora',
      summary: 'Pietro',
      start: { dateTime: '2026-09-25T13:00:00-07:00' },
      end: { dateTime: '2026-09-25T17:30:00-07:00' },
    } as never);
    expect(remoto.endDate).toBe('2026-09-26'); // exclusivo: 26/09
    const lido = parseBookingEvent(remoto, []);
    expect(lido?.startDate).toBe('2026-09-25');
    expect(lido?.endDate).toBe('2026-09-25');
  });
});

describe('importação — título com DOIS cães e cão fora do cadastro', () => {
  const caes = [cao('d-mowgli', 'Mowgli'), cao('d-kona', 'Kona')];

  it('"Cão A/Cão B" gera UMA decisão por cão (a parada única é do banco)', () => {
    const plano = planCalendarImport([evento({ id: 'ev-2', summary: 'Mowgli/Kona', colorId: VERDE })], caes, [], JANELA);
    const criados = cria(plano);
    expect(criados).toHaveLength(2);
    expect(criados.map((o) => o.dogId).sort()).toEqual(['d-kona', 'd-mowgli']);
    expect(criados.map((o) => o.parsed.dogName).sort()).toEqual(['Kona', 'Mowgli']);
  });

  it('nome que casa com DOIS cadastros vira pendência "ambiguous dog" (não se chuta)', () => {
    const ambiguos = [cao('a1', 'Pietro'), cao('a2', 'Pietro')];
    const plano = planCalendarImport([evento({ id: 'ev-amb', summary: 'Pietro' })], ambiguos, [], JANELA);
    expect(cria(plano)).toHaveLength(0);
    expect(revisoes(plano)[0]).toMatchObject({ kind: 'review', reason: 'ambiguous dog' });
  });

  it('cão desconhecido vai para revisão (sem cadastrar ninguém)', () => {
    const plano = planCalendarImport([evento({ id: 'ev-zeus', summary: 'Zeus' })], caes, [], JANELA);
    expect(cria(plano)).toHaveLength(0);
    expect(revisoes(plano)[0]).toMatchObject({ reason: 'unknown dog' });
  });
});

describe('importação — cores: desconhecida vira pendência, vermelha cancela', () => {
  it('cor CINZA (pintada de propósito) NÃO é importada — review "unrecognized color"', () => {
    const plano = planCalendarImport([evento({ id: 'ev-cinza', colorId: CINZA })], [cao('d1', 'Pietro')], [], JANELA);
    expect(cria(plano)).toHaveLength(0);
    expect(revisoes(plano)[0]).toMatchObject({ reason: 'unrecognized color' });
  });

  it('vermelho numa reserva confirmada daquele cão no dia -> CANCELAMENTO', () => {
    const ligada: BookingForImport = {
      id: 'res-1',
      kind: 'reservation',
      dogId: 'd1',
      googleEventId: null,
      source: 'app',
      serviceType: 'daycare',
      startDate: '2026-09-30',
      endDate: '2026-09-30',
      weekdays: null,
      skipDates: null,
      status: 'confirmed',
    };
    const plano = planCalendarImport([evento({ id: 'ev-red', colorId: VERMELHO })], [cao('d1', 'Pietro')], [ligada], JANELA);
    expect(plano).toEqual([{ kind: 'cancel', eventId: 'ev-red', bookingKind: 'reservation', bookingId: 'res-1' }]);
  });

  it('cão sem cor nenhuma = DAY CARE (padrão do escritório)', () => {
    const plano = planCalendarImport([evento({ id: 'ev-sem-cor', colorId: null })], [cao('d1', 'Pietro')], [], JANELA);
    expect(cria(plano)[0].parsed.serviceType).toBe('daycare');
  });
});

describe('importação — o vermelho NÃO duplica nem apaga a pausa do gestor', () => {
  const serie: BookingForImport = {
    id: 'sched-1',
    kind: 'recurring',
    dogId: 'd1',
    googleEventId: null,
    source: 'app',
    serviceType: 'daycare',
    startDate: '2026-09-01',
    endDate: null,
    weekdays: [1, 2, 3, 4, 5],
    skipDates: ['2026-09-30'], // o gestor JÁ pausou o dia na escala
    status: 'active',
  };

  it('dia que JÁ está pausado na escala: o vermelho não gera segunda pausa', () => {
    const plano = planCalendarImport([evento({ id: 'ev-red-dup', colorId: VERMELHO })], [cao('d1', 'Pietro')], [serie], JANELA);
    expect(plano).toEqual([]);
  });

  it('dia NÃO pausado: o vermelho gera UM skip (a escala inteira não é desativada)', () => {
    const outra = { ...serie, skipDates: [] };
    const plano = planCalendarImport([evento({ id: 'ev-red-novo', colorId: VERMELHO })], [cao('d1', 'Pietro')], [outra], JANELA);
    expect(plano).toEqual([{ kind: 'skip', eventId: 'ev-red-novo', scheduleId: 'sched-1', date: '2026-09-30' }]);
  });

  it('a MESMA rodada duas vezes dá o mesmo plano (idempotente, sem escrita dupla)', () => {
    const e = evento({ id: 'ev-idem', colorId: VERDE });
    const primeira = planCalendarImport([e], [cao('d1', 'Pietro')], [], JANELA);
    const segunda = planCalendarImport([e], [cao('d1', 'Pietro')], [], JANELA);
    expect(segunda).toEqual(primeira);
  });
});

describe('importação — nada do PASSADO entra no plano', () => {
  it('evento antes de `window.from` não cria, não altera e não cancela', () => {
    const antes: ParsedBooking[] = [];
    const e = evento({ id: 'ev-ontem', startDate: '2026-09-23', endDate: '2026-09-24' });
    expect(planCalendarImport([e], [cao('d1', 'Pietro')], [], JANELA)).toEqual([]);
    void antes;
  });

  it('reserva do Google com evento SUMIDO só é cancelada dentro da janela', () => {
    const dentro: BookingForImport = {
      id: 'res-dentro', kind: 'reservation', dogId: 'd1', googleEventId: 'ev-sumiu', googleCalendarId: 'primary', source: 'google',
      serviceType: 'daycare', startDate: '2026-10-05', endDate: '2026-10-05', weekdays: null, skipDates: null, status: 'confirmed',
    };
    const fora: BookingForImport = { ...dentro, id: 'res-fora', googleEventId: 'ev-velho', startDate: '2020-01-01', endDate: '2020-01-01' };
    const plano = planCalendarImport([], [cao('d1', 'Pietro')], [dentro, fora], JANELA);
    expect(plano).toEqual([{ kind: 'cancel', eventId: 'ev-sumiu', bookingKind: 'reservation', bookingId: 'res-dentro' }]);
  });
});
