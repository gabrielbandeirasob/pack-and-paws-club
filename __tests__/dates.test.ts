import { FUSO_DO_NEGOCIO, todayLocalISO, addDaysISO, weekdayOfISO } from '@/features/calendar/dates';

describe('local date helpers', () => {
  beforeAll(() => { jest.useFakeTimers(); });
  afterAll(() => { jest.useRealTimers(); });

  it('produces today in the local timezone', () => {
    jest.setSystemTime(new Date(2026, 8, 9, 23, 30)); // local Sep 9 2026
    expect(todayLocalISO()).toBe('2026-09-09');
  });

  it('adds days across month boundaries', () => {
    expect(addDaysISO('2026-09-30', 2)).toBe('2026-10-02');
    expect(addDaysISO('2026-09-09', -1)).toBe('2026-09-08');
  });

  it('reports the weekday number of an ISO date', () => {
    expect(weekdayOfISO('2026-09-09')).toBe(3); // Wednesday
  });

  // ------------------------------------------------ fuso do NEGÓCIO (auditoria de integrações, 02/10/2026)
  it('calcula o dia NO FUSO PEDIDO, não no relógio do runtime', () => {
    // 01:00 UTC de 02/10 ainda é 18:00 de 01/10 em Los Angeles (PDT, UTC-7). O robô do servidor roda
    // em UTC: sem o fuso do negócio, ele trataria o dia 02 como "hoje" e deixaria o dia 01 (PT) para trás.
    jest.setSystemTime(new Date('2026-10-02T01:00:00Z'));
    expect(todayLocalISO('UTC')).toBe('2026-10-02');
    expect(todayLocalISO(FUSO_DO_NEGOCIO)).toBe('2026-10-01');
  });

  it('a virada do dia em Los Angeles é às 07:00 UTC (00:00 PT) no horário de verão', () => {
    jest.setSystemTime(new Date('2026-10-02T06:30:00Z')); // 23:30 PT de 01/10
    expect(todayLocalISO(FUSO_DO_NEGOCIO)).toBe('2026-10-01');
    jest.setSystemTime(new Date('2026-10-02T07:30:00Z')); // 00:30 PT de 02/10
    expect(todayLocalISO(FUSO_DO_NEGOCIO)).toBe('2026-10-02');
  });

  it('fuso inválido cai no relógio do runtime, sem lançar (nunca derruba o robô)', () => {
    jest.setSystemTime(new Date('2026-10-02T01:00:00Z'));
    expect(todayLocalISO('Fuso/Que-Nao-Existe')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sem fuso continua o comportamento do app (relógio do aparelho)', () => {
    jest.setSystemTime(new Date(2026, 9, 2, 15, 0)); // local Oct 2 2026, 15:00
    expect(todayLocalISO()).toBe('2026-10-02');
  });
});
