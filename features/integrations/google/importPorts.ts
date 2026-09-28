/**
 * Escritas no banco da importacao do Google Calendar (as "portas" do executor de importacao).
 *
 * Regra de ouro do módulo: reserva/série que nasce no Google entra marcada (`source = 'google'` e
 * `google_event_id`) — é isso que depois diz ao espelho "não crie outro evento, atualize ESTE", e à
 * importação "Google manda nos dias desta".
 *
 * REGRA NOVA (dono, 24/09/2026 — inverte os builds 52-54): a importação só escreve agendamento de cão
 * que JÁ está no cadastro. As portas de CADASTRO (`createClient`/`createDog`) e a limpeza da rodada
 * (`removeDog`/`removeClientIfEmpty`) saíram daqui: elas existiam para criar o cão a partir do título,
 * que é exatamente o que o dono revogou ("o app não cria cliente nem cão"). No lugar entrou
 * `skipRecurringDay`, para o evento vermelho pular UM dia de uma escala.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ImportPorts } from './importService';
import { kindOf, type BookingForImport, type ExistingBookingKind, type ParsedBooking } from './importPlan';

/** O que já existe no app e casa com o evento — usado quando o gestor liga o evento a um cão. */
export type LinkChoice =
  | { kind: ExistingBookingKind; id: string }
  | { criar: true };

/**
 * Decide o que fazer quando o gestor resolve uma pendência da revisão escolhendo o cão.
 *
 * Por que não criar sempre: o escritório pode ter digitado a MESMA reserva no app e no Google. Nesse
 * caso o certo é LIGAR o evento à reserva que já existe (nada de duas reservas iguais na agenda).
 */
export function escolhaDaRevisao({
  parsed,
  dogId,
  bookings,
}: {
  parsed: ParsedBooking;
  dogId: string;
  bookings: BookingForImport[];
}): LinkChoice {
  const tipo = kindOf(parsed);
  const igual = bookings.find(
    (item) =>
      item.kind === tipo &&
      item.dogId === dogId &&
      item.serviceType === parsed.serviceType &&
      item.startDate === parsed.startDate &&
      (tipo === 'recurring'
        ? [...(item.weekdays ?? [])].sort().join(',') === [...parsed.weekdays].sort().join(',')
        : item.endDate === parsed.endDate) &&
      item.status === (tipo === 'recurring' ? 'active' : 'confirmed'),
  );
  return igual ? { kind: igual.kind, id: igual.id } : { criar: true };
}

export function supabaseImportPorts(client: SupabaseClient, organizationId: string): ImportPorts {
  const fimDaSerie = (parsed: ParsedBooking): string | null => (parsed.openEnded ? null : parsed.endDate);

  const gravarPausas = async (scheduleId: string, skipDates: string[]): Promise<void> => {
    await client.from('recurring_exceptions').delete().eq('recurring_schedule_id', scheduleId).eq('action', 'skip');
    if (skipDates.length === 0) return;
    const { error } = await client.from('recurring_exceptions').insert(
      skipDates.map((dia) => ({
        organization_id: organizationId,
        recurring_schedule_id: scheduleId,
        action: 'skip',
        start_date: dia,
        end_date: dia,
        reason: 'Pausa marcada no Google Calendar',
      })),
    );
    if (error) throw new Error(error.message);
  };

  /**
   * A reserva que NASCE do Google entra com transporte marcado.
   *
   * Motivo (achado em 23/09/2026, com o print do dono): `transport_required` tem default **false**
   * no banco, então uma reserva importada não aparecia no Dispatch — o gestor escrevia a data no
   * calendário e o cão não entrava na fila da van. Num negócio de creche COM transporte, a van é a
   * regra; se aquele cão não precisar, o gestor desmarca na própria reserva (e a importação não
   * mexe mais nesse campo depois — a escolha dele fica).
   *
   * EXCEÇÃO (escritório, 27/09/2026): dia de HOSPEDAGEM no meio da estadia (verde — o cão está no
   * hotel) entra **sem** transporte, porque ninguém busca nem leva aquele dia. Quem decide é o plano
   * (`parsed.transportRequired`), que só manda `false` quando o cão tem chegada/saída marcada na
   * janela. Aqui o padrão segue `true` para tudo que não veio decidido.
   */
  /**
   * `true` quando o banco recusou por VIOLAÇÃO DE ÚNICO — em `reservations` isso só acontece no índice
   * `reservations_google_event_unico (organization_id, google_event_id)`: quer dizer que aquele EVENTO do
   * Google já tem reserva no app.
   *
   * Por que isso virou caso tratado (produção, 27/09/2026): o escritório tocou em "Sync now" e a tela
   * mostrou *"26 item(s) from Google could not be saved. First: this event already has a reservation"* —
   * a importação rodou com uma fotografia das reservas que não incluía as ligadas àqueles eventos, então
   * o plano tentou CRIAR o que já existia. Prova de que era a fotografia e não a regra: a mesma
   * importação, rodando no servidor e lendo o banco na hora, deu `0 criados · 5 atualizados · 0 para
   * revisar`.
   *
   * Regra: evento que já tem reserva = importado. Não é erro do escritório nem motivo para assustar
   * ninguém: a reserva já existe e o próximo Sync (ou o do servidor) atualiza o que mudou.
   */
  const jaImportado = (error: { code?: string; message?: string }): boolean =>
    error.code === '23505' || /duplicate key value/i.test(error.message ?? '');

  return {
    createBooking: async ({ eventId, dogId, kind, parsed, semVinculo = false }) => {
      if (kind === 'recurring') {
        const { data, error } = await client
          .from('recurring_schedules')
          .insert({
            organization_id: organizationId,
            dog_id: dogId,
            weekdays: parsed.weekdays,
            start_date: parsed.startDate,
            end_date: fimDaSerie(parsed),
            active: true,
            transport_required: parsed.transportRequired ?? true,
            // Mesma razão da reserva: o vínculo do evento é único por organização (casa com dois cães).
            ...(semVinculo ? {} : { google_event_id: eventId }),
            source: 'google',
          })
          .select('id')
          .single();
        if (error) {
          if (jaImportado(error)) return 'already';
          throw new Error(error.message);
        }
        const criado = (data as { id: string } | null)?.id;
        if (criado) await gravarPausas(criado, parsed.skipDates);
        return 'created';
      }

      const { error } = await client.from('reservations').insert({
        organization_id: organizationId,
        dog_id: dogId,
        service_type: parsed.serviceType,
        start_date: parsed.startDate,
        end_date: parsed.endDate,
        transport_required: parsed.transportRequired ?? true,
        /**
         * CASA COM DOIS CÃES (26/09/2026): cada cão tem a SUA reserva no mesmo dia, mas o
         * `google_event_id` é único por organização. Só a PRIMEIRA reserva do evento fica com o vínculo;
         * a segunda nasce sem ele (a reserva existe do mesmo jeito e o dia do cão não se perde).
         */
        ...(semVinculo ? {} : { google_event_id: eventId }),
        source: 'google',
      });
      if (error) {
        if (jaImportado(error)) return 'already';
        throw new Error(error.message);
      }
      return 'created';
    },

    updateBooking: async ({ bookingId, kind, eventId, dogId, parsed }) => {
      if (kind === 'recurring') {
        const { error } = await client
          .from('recurring_schedules')
          .update({
            dog_id: dogId,
            weekdays: parsed.weekdays,
            start_date: parsed.startDate,
            end_date: fimDaSerie(parsed),
            active: true,
            google_event_id: eventId,
            source: 'google',
          })
          .eq('id', bookingId);
        if (error) throw new Error(error.message);
        await gravarPausas(bookingId, parsed.skipDates);
        return;
      }

      const { error } = await client
        .from('reservations')
        .update({
          dog_id: dogId,
          service_type: parsed.serviceType,
          start_date: parsed.startDate,
          end_date: parsed.endDate,
          status: 'confirmed',
          google_event_id: eventId,
          source: 'google',
        })
        .eq('id', bookingId);
      if (error) throw new Error(error.message);
    },

    cancelBooking: async ({ bookingId, kind }) => {
      const tabela = kind === 'recurring' ? 'recurring_schedules' : 'reservations';
      const valores = kind === 'recurring' ? { active: false } : { status: 'cancelled' };
      const { error } = await client.from(tabela).update(valores).eq('id', bookingId);
      if (error) throw new Error(error.message);
    },

    /**
     * Evento VERMELHO sobre um dia de escala: pula AQUELE dia, não a escala.
     *
     * A pausa é a mesma linha que a tela do app usa (`recurring_exceptions.action = 'skip'`), então o
     * dia sai do dia-a-dia e vira EXDATE no espelho — o Google mostra exatamente o que o app mostra.
     * Apaga a pausa do mesmo dia antes de gravar (o executor pode passar por aqui de novo se o evento
     * vermelho for reescrito) para não acumular linhas repetidas.
     */
    skipRecurringDay: async ({ scheduleId, date }) => {
      const { error: erroDaBusca } = await client
        .from('recurring_exceptions')
        .delete()
        .eq('recurring_schedule_id', scheduleId)
        .eq('action', 'skip')
        .eq('start_date', date);
      if (erroDaBusca) throw new Error(erroDaBusca.message);

      const { error } = await client.from('recurring_exceptions').insert({
        organization_id: organizationId,
        recurring_schedule_id: scheduleId,
        action: 'skip',
        start_date: date,
        end_date: date,
        reason: 'Cancelled in Google Calendar',
      });
      if (error) throw new Error(error.message);
    },

    /**
     * Dia EXTRA na escala (evento ROXO): o cliente de dia fixo mudou o dia / veio fora da ordem.
     *
     * Diferente do vermelho (que tira o dia), aqui o dia ENTRA na escala — fica ligado ao agendamento
     * fixo do cão em vez de virar reserva avulsa ("não ficar serviço solto", dono 24/09/2026). É a
     * mesma linha que a tela do app lê (`recurring_exceptions.action = 'extra'`), então o dia aparece
     * no dia-a-dia como dia previsto daquele cão.
     *
     * Regravar o mesmo dia substitui a linha (o executor pode passar de novo se o evento for reescrito)
     * para não acumular dias repetidos.
     */
    addScheduleExtraDay: async ({ scheduleId, date }) => {
      const { error: erroDaBusca } = await client
        .from('recurring_exceptions')
        .delete()
        .eq('recurring_schedule_id', scheduleId)
        .eq('action', 'extra')
        .eq('start_date', date);
      if (erroDaBusca) throw new Error(erroDaBusca.message);

      const { error } = await client.from('recurring_exceptions').insert({
        organization_id: organizationId,
        recurring_schedule_id: scheduleId,
        action: 'extra',
        start_date: date,
        end_date: date,
        reason: 'Changed day in Google Calendar',
      });
      if (error) throw new Error(error.message);
    },
  };
}
