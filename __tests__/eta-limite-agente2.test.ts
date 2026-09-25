/**
 * VETORES DO AGENTE2 — limite de sanidade do ETA do motorista.
 *
 * Defeito visto no print do dono (25/09/2026): o cabeçalho do motorista mostrava
 * "Next: Akmal (Enso) Private · Enso — ~23324 min away" = **16 dias** de distância, porque o
 * aparelho estava no Brasil e as paradas nos EUA. O número não ajudava ninguém.
 *
 * Regra: até ETA_MAXIMO_PLAUSIVEL_MIN (240 min = 4 h) mostra "~N min away"; acima disso a tela diz
 * "far from your stops" (sem inventar número), tanto no cabeçalho (`driver.tsx`) quanto no cartão
 * da parada (`DriverRouteView.tsx`).
 */
import { ETA_MAXIMO_PLAUSIVEL_MIN } from '@/features/driver/eta';

/** A mesma expressão usada nas duas telas: texto do ETA ou o aviso de distância. */
const textoDoEta = (minutos: number) =>
  minutos <= ETA_MAXIMO_PLAUSIVEL_MIN ? `~${minutos} min away` : 'far from your stops';

describe('limite de sanidade do ETA do motorista', () => {
  it('o limite e 4 horas', () => {
    expect(ETA_MAXIMO_PLAUSIVEL_MIN).toBe(240);
  });

  it('mostra o numero quando e plausivel', () => {
    expect(textoDoEta(3)).toBe('~3 min away');
    expect(textoDoEta(45)).toBe('~45 min away');
    expect(textoDoEta(ETA_MAXIMO_PLAUSIVEL_MIN)).toBe('~240 min away');
  });

  it('nao mostra numero absurdo (o caso do print: 23324 min = 16 dias)', () => {
    expect(textoDoEta(23324)).toBe('far from your stops');
    expect(textoDoEta(ETA_MAXIMO_PLAUSIVEL_MIN + 1)).toBe('far from your stops');
    expect(textoDoEta(23324)).not.toContain('min away');
  });
});
