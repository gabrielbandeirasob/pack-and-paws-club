/**
 * STATUS HTTP DO ROBÔ (`google-calendar-sync`) — achado crítico da auditoria de integrações
 * (02/10/2026): o topo devolvia sempre HTTP 200 `{ ok: true }`, então o n8n (que só olha o status)
 * nunca alarmava quando a credencial do Google morria. Agora qualquer organização que falhe vira 5xx.
 */
import {
  houveFalhaNaRodada,
  statusHttpDoRobo,
} from '../supabase/functions/_shared/resultadoDoRobo';

describe('statusHttpDoRobo / houveFalhaNaRodada', () => {
  it('todas as organizações OK: 200 e sem falha', () => {
    const ok = [{ ok: true }, { ok: true }];
    expect(houveFalhaNaRodada(ok)).toBe(false);
    expect(statusHttpDoRobo(ok)).toBe(200);
  });

  it('UMA organização falhou (ex.: invalid_grant): 502, para o n8n alarmar', () => {
    const resultados = [{ ok: true }, { ok: false }];
    expect(houveFalhaNaRodada(resultados)).toBe(true);
    expect(statusHttpDoRobo(resultados)).toBe(502);
  });

  it('só uma organização e ela falhou: 502', () => {
    expect(statusHttpDoRobo([{ ok: false }])).toBe(502);
  });

  it('rodada sem credenciais (nenhuma organização): 200, nada falhou', () => {
    expect(houveFalhaNaRodada([])).toBe(false);
    expect(statusHttpDoRobo([])).toBe(200);
  });

  it('resultado sem `ok` definido não conta como falha (só `ok: false` alarma)', () => {
    expect(houveFalhaNaRodada([{}, { ok: true }])).toBe(false);
    expect(statusHttpDoRobo([{}])).toBe(200);
  });
});
