/**
 * FALHA DE CREDENCIAL DO GOOGLE — um só lugar decide se o refresh token MORREU.
 *
 * Achado da auditoria de integrações (02/10/2026): três lugares tratavam o erro do Google de formas
 * diferentes e nenhum distinguia "a rede caiu" de "o Google recusou o refresh token para sempre":
 *
 *  * o robô do servidor (`google-calendar-sync`) registrava o erro e **retentava a credencial inválida
 *    para sempre**, a cada 15 minutos;
 *  * o hook do aparelho (`useCalendarConnection`) engolia QUALQUER erro da renovação e continuava
 *    dizendo "Connected" — o gestor não tinha como saber que precisava reconectar;
 *  * a função que guarda a credencial (`google-calendar-token`) aceitava qualquer chamada.
 *
 * A distinção é a mesma em todos: `invalid_grant` (e um 401 do endpoint de token) significa que o
 * refresh token não vale mais — o dono revogou o acesso, a senha mudou ou o app foi removido da conta
 * Google. Erro de REDE (fetch que falhou, timeout) NÃO é isso: a credencial continua boa e a próxima
 * rodada funciona.
 *
 * Este módulo é puro e é COPIADO para o servidor pelo gerador
 * (`scripts/gera-importacao-compartilhada.mjs`) — é a mesma decisão no app e na função agendada.
 */

/** O que o Google responde no corpo do 400 quando o refresh token não vale mais. */
const MARCADORES_DE_CREDENCIAL_MORTA = /invalid_grant|invalid refresh token|token has been revoked|token has been expired or revoked/i;

/**
 * `true` quando a resposta do Google diz que a credencial não vale mais (reconectar é obrigatório).
 *
 * @param erro       `error` cru do corpo da resposta do Google (`invalid_grant`, …) ou a mensagem de
 *                   um `Error` que envolveu o erro — os dois formatos chegam aqui.
 * @param status     status HTTP da resposta, quando existe (401 é credencial inválida por definição).
 */
export function ehFalhaDeCredencial(erro: string | null | undefined, status?: number | null): boolean {
  if (status === 401) return true;
  return MARCADORES_DE_CREDENCIAL_MORTA.test((erro ?? '').trim());
}
