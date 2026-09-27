/**
 * RESUMO SEMANAL (áudio do dono, 27/09/2026): "a lista dos cachorros que vieram na semana... 2º dia
 * 12, 4º dia 15, 6º dia 10, daycare... a checagem todo sábado".
 *
 * Decisões dele: semana = segunda a sábado, e o serviço do dia aparece na linha (daycare).
 * Aqui se prova a matemática pura (semana, rótulos e a montagem da lista); a tela chama estas
 * funções com o que o banco devolveu.
 */
import { buildWeeklySummary, dayChipLabel, weekDays, weekLabel, weekStart } from '@/features/dashboard/weeklySummary';

const DOMINGO = '2026-09-27';
const SEGUNDA = '2026-09-21';
const SABADO = '2026-09-26';

describe('weekStart (domingo fecha a semana que passou)', () => {
  it('segunda-feira é a própria segunda', () => {
    expect(weekStart(SEGUNDA)).toBe('2026-09-21');
  });

  it('meio da semana volta para a segunda', () => {
    expect(weekStart('2026-09-23')).toBe('2026-09-21');
  });

  it('sábado pertence à semana que começou na segunda', () => {
    expect(weekStart(SABADO)).toBe('2026-09-21');
  });

  it('domingo NÃO abre semana nova: é a semana que acabou de fechar', () => {
    expect(weekStart(DOMINGO)).toBe('2026-09-21');
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
  });
});

describe('weekDays', () => {
  it('devolve segunda a sábado, sem domingo', () => {
    expect(weekDays(DOMINGO)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ]);
  });
});

describe('dayChipLabel / weekLabel', () => {
  it('rótulo curto do dia', () => {
    expect(dayChipLabel('2026-09-21')).toBe('Mon 21');
    expect(dayChipLabel(SABADO)).toBe('Sat 26');
  });

  it('semana dentro do mês e semana que vira o mês', () => {
    expect(weekLabel('2026-09-21', '2026-09-26')).toBe('SEPTEMBER 21 – 26');
    expect(weekLabel('2026-08-31', '2026-09-05')).toBe('AUGUST 31 – SEPTEMBER 5');
  });
});

describe('buildWeeklySummary', () => {
  const dogsByDay = {
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
  const dias = weekDays(DOMINGO);

  it('lista os cães por nome, com os dias de cada um', () => {
    const resumo = buildWeeklySummary(dias, dogsByDay);

    expect(resumo.dogs.map((cao) => cao.dogName)).toEqual(['Bito', 'Luna', 'Mowgli']);
    expect(resumo.dogs[1].days).toEqual([
      { date: '2026-09-21', serviceType: 'daycare' },
      { date: '2026-09-23', serviceType: 'daycare' },
      { date: '2026-09-26', serviceType: 'daycare' },
    ]);
    expect(resumo.dogs[0].days).toEqual([{ date: '2026-09-23', serviceType: 'boarding' }]);
  });

  it('conta cães, visitas e quantos vieram em cada dia', () => {
    const resumo = buildWeeklySummary(dias, dogsByDay);

    expect(resumo.totalDogs).toBe(3);
    expect(resumo.totalDogDays).toBe(5);
    expect(resumo.perDay).toEqual([2, 0, 2, 0, 0, 1]);
    expect(resumo.from).toBe('2026-09-21');
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
    expect(resumo.perDay).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
