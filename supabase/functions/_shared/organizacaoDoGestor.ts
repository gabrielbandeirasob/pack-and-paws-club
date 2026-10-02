/**
 * ESCOLHA DA ORGANIZAÇÃO DE QUEM CHAMA — lógica pura da função `google-calendar-token`.
 *
 * 🚨 ACHADO DA AUDITORIA DE INTEGRAÇÕES (02/10/2026): a função pegava a organização do gestor com
 * `.limit(1).maybeSingle()` e, quando o gestor tinha vínculo ativo em MAIS de uma organização
 * (o caso do `202609270037_segundo_dono.sql` / `gestor_tambem_dirige`), escolhia uma ARBITRÁRIA — a
 * credencial podia ser gravada (ou APAGADA) no tenant errado.
 *
 * As consultas ao banco ficam na função (Deno); aqui vive só a DECISÃO, para poder ser testada de
 * verdade no Jest (`__tests__/organizacao-do-gestor.test.ts`). O que cada entrada significa:
 *  * `organizacoes`           — ids das organizações do gestor com vínculo ATIVO de manager;
 *  * `calendarId`             — calendário informado no corpo (`null` quando não veio);
 *  * `organizacaoDoCalendario`— organização (dentre as do gestor) configurada com aquele calendário;
 *  * `organizacaoComCredencial`— organização (dentre as do gestor) que JÁ tem credencial gravada.
 */

/** Ids únicos dos vínculos, na ordem em que vieram (sem `null`/vazio). */
export function organizacoesDeVinculos(
  linhas: { organization_id?: string | null }[] | null | undefined,
): string[] {
  const ids = (linhas ?? [])
    .map((linha) => (linha?.organization_id ?? '').trim())
    .filter((id) => id.length > 0);
  return [...new Set(ids)];
}

/**
 * A organização a usar SEM CHUTE:
 *  * uma só → ela (comportamento de sempre);
 *  * `calendar_id` informado → a organização do gestor configurada com aquele calendário;
 *  * sem `calendar_id` → a que JÁ tem credencial (é a linha que `check`/`revoke`/regravação miram);
 *  * nada disso → `null` (a função responde 409 e o app/n8n vê que falta clareza, em vez de escrever
 *    no tenant errado).
 */
export function escolherOrganizacao(
  organizacoes: string[],
  calendarId: string | null,
  organizacaoDoCalendario: string | null,
  organizacaoComCredencial: string | null,
): string | null {
  if (organizacoes.length === 0) return null;
  if (organizacoes.length === 1) return organizacoes[0];
  const valida = (candidata: string | null | undefined): string | null =>
    candidata && organizacoes.includes(candidata) ? candidata : null;
  if (calendarId) return valida(organizacaoDoCalendario);
  return valida(organizacaoComCredencial);
}
