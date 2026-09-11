import { formatDayLabel } from '@/features/calendar/dates';
import { monthLabel } from '@/features/calendar/gridMath';

/**
 * O app esta em ingles ("Daycare", "Boarding", "Transport"), mas os rotulos de data
 * saiam em portugues: a barra mostrava "Fri, 11 De Set" (dia em ingles, mes em
 * portugues, com maiuscula errada). Corrigido em 11/09/2026.
 */
describe('rotulos de data no idioma do app', () => {
  it('dia + mes em ingles', () => {
    expect(formatDayLabel('2026-09-11')).toBe('Fri, Sep 11');
    expect(formatDayLabel('2026-01-05')).toBe('Mon, Jan 05');
  });

  it('mes por extenso em ingles', () => {
    expect(monthLabel('2026-09-11')).toBe('September 2026');
    expect(monthLabel('2026-12-01')).toBe('December 2026');
  });

  it('nao sobra palavra em portugues nos rotulos', () => {
    const rotulos = [formatDayLabel('2026-09-11'), monthLabel('2026-09-11')].join(' ');
    expect(rotulos).not.toMatch(/\bde\b|Set\b|Fev\b|Abr\b|Mai\b|Ago\b|Dez\b|Jan\b.*de/);
  });
});
