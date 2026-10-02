/**
 * STATUS HTTP DO ROBÔ AGENDADO — lógica pura da função `google-calendar-sync`.
 *
 * 🚨 ACHADO DA AUDITORIA DE INTEGRAÇÕES (02/10/2026): o topo da função devolvia SEMPRE `{ ok: true }`
 * com HTTP 200, mesmo quando uma organização falhava (ex.: `invalid_grant`). O n8n só dispara o
 * `errorWorkflow` em erro HTTP, então a credencial morta nunca alarmava — o cancelamento feito no
 * Google com o app fechado simplesmente não chegava. Agora QUALQUER organização que falhe vira 5xx.
 *
 * A decisão é pura (testada em `__tests__/robo-status.test.ts`); a função Deno só consome.
 */

export type ResultadoDaOrganizacao = { ok?: boolean };

/** `true` se PELO MENOS UMA organização falhou na rodada. */
export function houveFalhaNaRodada(resultados: ResultadoDaOrganizacao[]): boolean {
  return resultados.some((resultado) => resultado?.ok === false);
}

/** 502 quando alguma organização falhou (alarma o n8n); 200 quando todas foram bem. */
export function statusHttpDoRobo(resultados: ResultadoDaOrganizacao[]): number {
  return houveFalhaNaRodada(resultados) ? 502 : 200;
}
