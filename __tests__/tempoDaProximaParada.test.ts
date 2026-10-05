/**
 * TEMPO ATÉ A PRÓXIMA PARADA na Home (dono, 05/10/2026) — regra PURA.
 *
 * Dois defeitos relatados: `~23306 min` (número absurdo, de posição longe ou velha) e `80 min`
 * (formato). A regra devolve rótulo legível ou `null` — nunca um número impossível.
 */
import { ETA_MAXIMO_PLAUSIVEL_MIN } from '@/features/driver/eta';
import { rotuloDeEtaMinutos } from '@/features/dashboard/routeEtaLabel';

it('abaixo de uma hora, em minutos', () => {
  expect(rotuloDeEtaMinutos(0)).toBe('0 min');
  expect(rotuloDeEtaMinutos(12)).toBe('12 min');
  expect(rotuloDeEtaMinutos(59.4)).toBe('59 min');
});

it('a partir de uma hora, em horas e minutos (nada de "80 min")', () => {
  expect(rotuloDeEtaMinutos(60)).toBe('1 hr');
  expect(rotuloDeEtaMinutos(80)).toBe('1 hr 20 min');
  expect(rotuloDeEtaMinutos(125)).toBe('2 hr 5 min');
});

it('o número impossível NUNCA vira texto: `~23306 min` fica de fora', () => {
  expect(rotuloDeEtaMinutos(23306)).toBeNull();
  expect(rotuloDeEtaMinutos(23290)).toBeNull();
  expect(rotuloDeEtaMinutos(ETA_MAXIMO_PLAUSIVEL_MIN + 0.6)).toBeNull();
  // No limite ainda é plausível.
  expect(rotuloDeEtaMinutos(ETA_MAXIMO_PLAUSIVEL_MIN)).not.toBeNull();
});

it('sem número utilizável (vazio, negativo, NaN) devolve null', () => {
  expect(rotuloDeEtaMinutos(null)).toBeNull();
  expect(rotuloDeEtaMinutos(undefined)).toBeNull();
  expect(rotuloDeEtaMinutos(Number.NaN)).toBeNull();
  expect(rotuloDeEtaMinutos(-5)).toBeNull();
});
