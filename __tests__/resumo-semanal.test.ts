/**
 * RESUMO SEMANAL (áudio do dono, 27/09/2026): "a lista dos cachorros que vieram na semana... 2º dia
 * 12, 4º dia 15, 6º dia 10, daycare... a checagem todo sábado".
 *
 * ⚠️ **A SEMANA MUDOU EM 06/10/2026** — pedido do dono ao ver o TestFlight: *"na aba weekly summary tá
 * mostrando 6 dias da semana ao invés da semana completa"*. Ele escolheu a semana do **calendário do
 * escritório (EUA): domingo → sábado, 7 dias** (antes era segunda → sábado, 6 dias, e o domingo fechava
 * a semana anterior). Aqui se prova a matemática pura (semana, rótulos e a montagem da lista); a tela
 * chama estas funções com o que o banco devolveu.
 */
import { buildWeeklySummary, dayChipLabel, weekDays, weekLabel, weekStart } from '@/features/dashboard/weeklySummary';

const DOMINGO = '2026-09-20';
const SEGUNDA = '2026-09-21';
const SABADO = '2026-09-26';
const PROXIMO_DOMINGO = '2026-09-27';

describe('weekStart (a semana começa no DOMINGO — dono, 06/10/2026)', () => {
  it('domingo é o primeiro dia da própria semana', () => {
    expect(weekStart(DOMINGO)).toBe('2026-09-20');
    expect(weekStart(PROXIMO_DOMINGO)).toBe(PROXIMO_DOMINGO);
  });

  it('segunda-feira pertence à semana que abriu no domingo anterior', () => {
    expect(weekStart(SEGUNDA)).toBe('2026-09-20');
  });

  it('meio da semana e sábado continuam na mesma semana', () => {
    expect(weekStart('2026-09-23')).toBe('2026-09-20');
    expect(weekStart(SABADO)).toBe('2026-09-20');
  });
});

describe('weekDays', () => {
  it('devolve os SETE dias, de domingo a sábado', () => {
    expect(weekDays('2026-09-23')).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ]);
  });

  it('domingo abre a semana seguinte (o dia não fica de fora do resumo)', () => {
    expect(weekDays(PROXIMO_DOMINGO)[0]).toBe('2026-09-27');
    expect(weekDays(PROXIMO_DOMINGO)).toHaveLength(7);
  });
});

describe('dayChipLabel / weekLabel', () => {
  it('rótulo curto do dia', () => {
    expect(dayChipLabel('2026-09-20')).toBe('Sun 20');
    expect(dayChipLabel(SEGUNDA)).toBe('Mon 21');
    expect(dayChipLabel(SABADO)).toBe('Sat 26');
  });

  it('semana dentro do mês e semana que vira o mês', () => {
    expect(weekLabel('2026-09-20', '2026-09-26')).toBe('SEPTEMBER 20 – 26');
    expect(weekLabel('2026-08-30', '2026-09-05')).toBe('AUGUST 30 – SEPTEMBER 5');
  });
});

describe('buildWeeklySummary', () => {
  const dogsByDay = {
    '2026-09-20': [
      // Cão que veio no DOMINGO: com a semana de 6 dias ele NÃO aparecia em resumo nenhum.
      { dogId: 'bito', dogName: 'Bito', clientName: 'Sofia', serviceType: 'boarding' as const },
    ],
    '2026-09-21': [
      { dogId: 'luna', dogName: 'Luna', clientName: 'Ana', serviceType: 'daycare' as const },
      { dogId: 'mowgli', dogName: 'Mowgli', clientName: 'Leigh Ann', serviceType: 'daycare' as const },
    ],
    '2026-09-23': [
      { dogId: 'luna', dogName: 'Luna', clientName: 'Ana', serviceType: 'daycare' as const },
      { dogId: 'bito', dogName: 'Bito', clientName: 'Sofia', serviceType: 'boarding' as const },
    ],
    '2026-09-26': [
      { dogId: 'luna', dogName: 'Luna', clientName: 'Ana', serviceType: 'daycare' as const },
    ],
  };
  const dias = weekDays('2026-09-23');

  it('lista os cães por nome, com os dias de cada um (inclusive o domingo)', () => {
    const resumo = buildWeeklySummary(dias, dogsByDay);

    expect(resumo.dogs.map((cao) => cao.dogName)).toEqual(['Bito', 'Luna', 'Mowgli']);
    expect(resumo.dogs[1].days).toEqual([
      { date: '2026-09-21', serviceType: 'daycare' },
      { date: '2026-09-23', serviceType: 'daycare' },
      { date: '2026-09-26', serviceType: 'daycare' },
    ]);
    expect(resumo.dogs[0].days).toEqual([
      { date: '2026-09-20', serviceType: 'boarding' },
      { date: '2026-09-23', serviceType: 'boarding' },
    ]);
  });

  it('conta cães, visitas e quantos vieram em cada dia', () => {
    const resumo = buildWeeklySummary(dias, dogsByDay);

    expect(resumo.totalDogs).toBe(3);
    expect(resumo.totalDogDays).toBe(6);
    expect(resumo.perDay).toEqual([1, 2, 0, 2, 0, 0, 1]);
    expect(resumo.from).toBe('2026-09-20');
    expect(resumo.to).toBe(SABADO);
  });

  it('não duplica quando o mesmo cão aparece duas vezes no dia', () => {
    const resumo = buildWeeklySummary(dias, {
      '2026-09-21': [
        { dogId: 'luna', dogName: 'Luna', clientName: 'Ana', serviceType: 'daycare' },
        { dogId: 'luna', dogName: 'Luna', clientName: 'Ana', serviceType: 'boarding' },
      ],
    });

    expect(resumo.dogs).toHaveLength(1);
    expect(resumo.dogs[0].days).toHaveLength(1);
    expect(resumo.totalDogDays).toBe(1);
  });

  it('semana sem nenhum cão devolve lista vazia e zeros', () => {
    const resumo = buildWeeklySummary(dias, {});

    expect(resumo.dogs).toEqual([]);
    expect(resumo.totalDogs).toBe(0);
    expect(resumo.totalDogDays).toBe(0);
    expect(resumo.perDay).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
