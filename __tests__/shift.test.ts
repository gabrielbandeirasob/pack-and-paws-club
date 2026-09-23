/**
 * JORNADA DO MOTORISTA (clock in / clock out) — pedido do cliente em áudio (16/09/2026):
 * "quando o driver chegar, ele tem que dar o clock in e depois o clock out".
 *
 * O que estes testes travam:
 *  - a jornada é DEDUZIDA dos eventos da rota (primeira chegada → última conclusão), sem o
 *    motorista apertar nada — e a ordem das paradas NÃO importa;
 *  - jornada MANUAL aberta manda (é exceção declarada) e aparece marcada como manual;
 *  - resumo do gestor junta automático + manual e usa a marca mais cedo/mais tarde;
 *  - o CSV sai com ponto e vírgula e nome com vírgula entre aspas (planilha não quebra).
 */
import {
  clockText,
  dayKey,
  deduceShift,
  durationText,
  firstArrival,
  lastCompletion,
  openManualShift,
  shiftErrorMessage,
  shiftMinutes,
  shiftState,
  shiftLabel,
  summarizeDriverDay,
  summarizeDriverDays,
  summaryToCsv,
  type ManualShift,
  type StopMilestones,
} from '@/features/driver/shift';

const parada = (over: Partial<StopMilestones> & { id: string }): StopMilestones => ({
  sequence: 1,
  status: 'pending',
  arrivedAt: null,
  pickedUpAt: null,
  completedAt: null,
  skippedAt: null,
  ...over,
});

// Rota de 3 paradas: chegou 07:10 na primeira, concluiu a última 11:40.
const rota: StopMilestones[] = [
  parada({ id: 's2', sequence: 2, status: 'completed', arrivedAt: '2026-09-23T10:20:00Z', pickedUpAt: '2026-09-23T10:25:00Z', completedAt: '2026-09-23T11:40:00Z' }),
  parada({ id: 's1', sequence: 1, status: 'completed', arrivedAt: '2026-09-23T07:10:00Z', pickedUpAt: '2026-09-23T07:15:00Z', completedAt: '2026-09-23T07:30:00Z' }),
  parada({ id: 's3', sequence: 3, status: 'pending' }),
];

describe('dedução da jornada pelos eventos da rota', () => {
  it('usa a PRIMEIRA chegada e a ÚLTIMA conclusão, independente da ordem da lista', () => {
    expect(firstArrival(rota)).toBe('2026-09-23T07:10:00.000Z');
    expect(lastCompletion(rota)).toBe('2026-09-23T11:40:00.000Z');
    expect(deduceShift(rota)).toEqual({ startedAt: '2026-09-23T07:10:00.000Z', endedAt: '2026-09-23T11:40:00.000Z' });
  });

  it('rota que não começou não tem jornada', () => {
    const naoComecou = [parada({ id: 's1', sequence: 1 })];
    expect(deduceShift(naoComecou)).toBeNull();
    expect(shiftState(naoComecou, []).kind).toBe('none');
    expect(shiftLabel(shiftState(naoComecou, []))).toBe('Journey not started yet');
  });

  it('jornada em andamento (chegou, ainda não concluiu) fica aberta', () => {
    const emAndamento = [parada({ id: 's1', sequence: 1, status: 'arrived', arrivedAt: '2026-09-23T07:10:00Z' })];
    const estado = shiftState(emAndamento, [], new Date('2026-09-23T08:10:00Z'));
    expect(estado.kind).toBe('open');
    expect(estado.source).toBe('route');
    expect(estado.minutes).toBe(60);
    // A hora é a do relógio do aparelho (fuso do motorista), então o teste checa a forma.
    expect(shiftLabel(estado)).toMatch(/^On the clock since \d{2}:\d{2} · 1h00 so far$/);
  });

  it('"problema" na última parada também fecha a jornada (o motorista foi embora)', () => {
    const comProblema = [
      parada({ id: 's1', sequence: 1, status: 'arrived', arrivedAt: '2026-09-23T07:10:00Z' }),
      parada({ id: 's2', sequence: 2, status: 'skipped', arrivedAt: '2026-09-23T09:00:00Z', skippedAt: '2026-09-23T09:30:00Z' }),
    ];
    expect(deduceShift(comProblema)?.endedAt).toBe('2026-09-23T09:30:00.000Z');
  });
});

describe('jornada manual (a exceção)', () => {
  const aberta: ManualShift = { id: 'sh1', startedAt: '2026-09-23T06:30:00Z', endedAt: null, startReason: 'Esqueci de bater o ponto' };

  it('acha a jornada aberta e ela manda sobre a dedução', () => {
    expect(openManualShift([aberta])?.id).toBe('sh1');
    const estado = shiftState(rota, [aberta], new Date('2026-09-23T08:00:00Z'));
    expect(estado.kind).toBe('open');
    expect(estado.source).toBe('manual');
    expect(estado.manualOpen).toBe(true);
    expect(estado.minutes).toBe(90);
    expect(shiftLabel(estado)).toContain('manual');
  });

  it('manual FECHADA mais recente que a rota é a jornada do dia', () => {
    const fechada: ManualShift = { id: 'sh2', startedAt: '2026-09-23T14:00:00Z', endedAt: '2026-09-23T18:30:00Z', startReason: 'Turno da tarde' };
    const estado = shiftState(rota, [fechada]);
    expect(estado.kind).toBe('closed');
    expect(estado.source).toBe('manual');
    expect(estado.minutes).toBe(270);
    expect(estado.manualOpen).toBe(false);
  });
});

describe('tempo e relógio', () => {
  it('minutos entre horários, nunca negativo, e sem fim conta até agora', () => {
    expect(shiftMinutes('2026-09-23T07:00:00Z', '2026-09-23T08:30:00Z')).toBe(90);
    expect(shiftMinutes('2026-09-23T08:30:00Z', '2026-09-23T07:00:00Z')).toBe(0);
    expect(shiftMinutes('2026-09-23T07:00:00Z', null, new Date('2026-09-23T09:15:00Z'))).toBe(135);
    expect(shiftMinutes(null, null)).toBe(0);
    expect(shiftMinutes('não é data', null)).toBe(0);
  });

  it('formata duração em "45 min" / "3h05"', () => {
    expect(durationText(45)).toBe('45 min');
    expect(durationText(60)).toBe('1h00');
    expect(durationText(185)).toBe('3h05');
    expect(durationText(-10)).toBe('0 min');
  });

  it('hora no fuso do aparelho e dia local', () => {
    const hora = clockText('2026-09-23T12:07:00Z');
    expect(hora).toMatch(/^\d{2}:\d{2}$/);
    expect(clockText(null)).toBeNull();
    expect(dayKey(new Date(2026, 8, 23))).toBe('2026-09-23');
  });
});

describe('resumo do gestor', () => {
  it('junta automático e manual e usa a marca mais cedo como entrada e a mais tarde como saída', () => {
    const resumo = summarizeDriverDay({
      driverId: 'd1',
      driverName: 'Jordan',
      day: '2026-09-23',
      stops: rota,
      shifts: [{ id: 'sh1', startedAt: '2026-09-23T06:30:00Z', endedAt: '2026-09-23T12:00:00Z', startReason: 'Chegou antes' }],
    });
    expect(resumo.routeIn).toBe('2026-09-23T07:10:00.000Z');
    expect(resumo.routeOut).toBe('2026-09-23T11:40:00.000Z');
    expect(resumo.manualIn).toBe('2026-09-23T06:30:00.000Z');
    expect(resumo.minutes).toBe(330); // 06:30 → 12:00
    expect(resumo.hasManual).toBe(true);
    expect(resumo.manualCount).toBe(1);
  });

  it('sem jornada manual, o dia é só o que a rota conta', () => {
    const resumo = summarizeDriverDay({ driverId: 'd1', driverName: 'Jordan', day: '2026-09-23', stops: rota, shifts: [] });
    expect(resumo.hasManual).toBe(false);
    expect(resumo.manualCount).toBe(0);
    expect(resumo.minutes).toBe(270); // 07:10 → 11:40
  });

  it('ordena por dia (mais novo primeiro) e depois por motorista', () => {
    const resumos = summarizeDriverDays([
      { driverId: 'd2', driverName: 'Zeca', day: '2026-09-22', stops: rota, shifts: [] },
      { driverId: 'd1', driverName: 'Ana', day: '2026-09-23', stops: rota, shifts: [] },
    ]);
    expect(resumos.map((r) => `${r.day} ${r.driverName}`)).toEqual(['2026-09-23 Ana', '2026-09-22 Zeca']);
  });

  it('CSV: cabeçalho, ponto e vírgula e nome com vírgula entre aspas', () => {
    const csv = summaryToCsv([
      summarizeDriverDay({ driverId: 'd1', driverName: 'Silva, Ana', day: '2026-09-23', stops: rota, shifts: [] }),
    ]);
    const linhas = csv.split('\n');
    expect(linhas[0]).toBe('day;driver;in;out;total;total_minutes;manual_shifts');
    expect(linhas[1]).toContain('"Silva, Ana"');
    expect(linhas[1]).toContain('4h30');
    expect(linhas[1].split(';').length).toBeGreaterThanOrEqual(7);
  });
});

describe('mensagem de erro da jornada', () => {
  it('traduz duplicidade, motivo curto e falta de rede', () => {
    expect(shiftErrorMessage(new Error('duplicate key value violates unique constraint "driver_shifts_uma_aberta"'))).toBe(
      'You already have a journey open.',
    );
    expect(shiftErrorMessage(new Error('violates check constraint "driver_shifts_motivo_ok"'))).toBe(
      'Write a short reason (at least 3 letters).',
    );
    expect(shiftErrorMessage(new Error('Network request failed'))).toContain('saved on your phone');
    expect(shiftErrorMessage(new Error('outro erro'))).toBe('outro erro');
  });
});
