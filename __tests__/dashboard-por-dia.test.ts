/**
 * Navegação por dia do Dashboard (áudio do dono, 27/09/2026): "arrastar pro lado, pra ir pro próximo
 * dia ou para os próximos dias... se fosse um calendário de rolagem".
 *
 * Aqui se prova o que é puro (sem tela): o deslocamento de dia, o rótulo do cabeçalho e o limite da
 * janela. A parte de gesto/clique está em `ManagerDashboard.test.tsx`.
 */
import {
  dayHeadline,
  dayPrefix,
  dentroDaJanela,
  diffEmDias,
  shiftDay,
  JANELA_DE_DIAS,
} from '@/features/dashboard/dayNavigation';

const HOJE = '2026-09-27'; // domingo, 27/09/2026 (data real do pedido)

describe('shiftDay', () => {
  it('anda um dia para frente e para trás', () => {
    expect(shiftDay('2026-09-27', 1)).toBe('2026-09-28');
    expect(shiftDay('2026-09-27', -1)).toBe('2026-09-26');
  });

  it('vira o mês e o ano', () => {
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('cai no 28 de fevereiro quando o ano não é bissexto (e no 29 quando é)', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('diffEmDias', () => {
  it('conta os dias entre dois dias ISO', () => {
    expect(diffEmDias(HOJE, HOJE)).toBe(0);
    expect(diffEmDias(HOJE, '2026-09-28')).toBe(1);
    expect(diffEmDias(HOJE, '2026-09-26')).toBe(-1);
    expect(diffEmDias(HOJE, '2026-10-30')).toBe(33);
  });
});

describe('dayPrefix (o que deixa os títulos honestos)', () => {
  it('nomeia hoje, amanhã e ontem', () => {
    expect(dayPrefix(HOJE, HOJE)).toBe('Today');
    expect(dayPrefix('2026-09-28', HOJE)).toBe('Tomorrow');
    expect(dayPrefix('2026-09-26', HOJE)).toBe('Yesterday');
  });

  it('depois disso usa o dia da semana', () => {
    expect(dayPrefix('2026-10-30', HOJE)).toBe('Friday');
    expect(dayPrefix('2026-09-24', HOJE)).toBe('Thursday');
  });
});

describe('dayHeadline (cabeçalho verde)', () => {
  it('mostra o dia relativo + dia da semana + mês e dia', () => {
    expect(dayHeadline(HOJE, HOJE)).toBe('TODAY · SUNDAY · SEPTEMBER 27');
    expect(dayHeadline('2026-09-28', HOJE)).toBe('TOMORROW · MONDAY · SEPTEMBER 28');
    expect(dayHeadline('2026-09-26', HOJE)).toBe('YESTERDAY · SATURDAY · SEPTEMBER 26');
  });

  it('longe do hoje, não repete o dia da semana', () => {
    expect(dayHeadline('2026-10-30', HOJE)).toBe('FRIDAY · OCTOBER 30');
  });
});

describe('dentroDaJanela (o swipe para no limite)', () => {
  it('aceita até ±30 dias e recusa além', () => {
    expect(dentroDaJanela(HOJE, HOJE)).toBe(true);
    expect(dentroDaJanela(shiftDay(HOJE, JANELA_DE_DIAS), HOJE)).toBe(true);
    expect(dentroDaJanela(shiftDay(HOJE, -JANELA_DE_DIAS), HOJE)).toBe(true);
    expect(dentroDaJanela(shiftDay(HOJE, JANELA_DE_DIAS + 1), HOJE)).toBe(false);
    expect(dentroDaJanela(shiftDay(HOJE, -JANELA_DE_DIAS - 1), HOJE)).toBe(false);
  });
});
