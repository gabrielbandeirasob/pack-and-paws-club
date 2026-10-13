// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.
// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha
// se esta cópia ficar desatualizada.
/**
 * A MARCA DO CANCELAMENTO DO GOOGLE — o texto que o evento VERMELHO deixa na linha que ele tira.
 *
 * Por que existe um arquivo só para isto: quem **escreve** a marca é a importação
 * (`importPorts.supabaseImportPorts().skipRecurringDay`) e quem **lê** é o resumo semanal do gestor
 * (`features/dashboard/cancelledDays`), que mostra o dia como cancelado. Duas cópias do mesmo texto
 * divergem em uma semana — e aí o resumo para de reconhecer o cancelamento em silêncio (foi assim que
 * a pausa do app e a do Google se confundiram na vistoria de 02/10/2026).
 *
 * ⚠️ ESTE ARQUIVO É COPIADO PARA A FUNÇÃO AGENDADA (`supabase/functions/_shared/importacao`) por
 * `scripts/gera-importacao-compartilhada.mjs`: a lista de módulos do gerador E a do teste
 * `__tests__/importacao-compartilhada.test.ts` precisam citá-lo.
 *
 * O texto é o `reason` gravado em `recurring_exceptions` quando o vermelho pula UM dia de uma escala
 * (o outro caminho do vermelho, sobre uma reserva avulsa, marca `reservations.status = 'cancelled'` e
 * não usa texto). A pausa que o GESTOR marca no app tem outro `reason` ('Skipped on this date', em
 * `app/(tabs)/calendar.tsx`) — é essa diferença que deixa o resumo semanal mostrar cancelamento sem
 * chamar de cancelada uma folga marcada à mão.
 */
export const CANCELAMENTO_DO_GOOGLE = 'Cancelled in Google Calendar';
