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

export function supabaseImportPorts(
  client: SupabaseClient,
  organizationId: string,
  opcoes: { criadoPor?: string | null } = {},
): ImportPorts {
  const fimDaSerie = (parsed: ParsedBooking): string | null => (parsed.openEnded ? null : parsed.endDate);

  /**
   * AUTORIA DAS LINHAS (`created_by`) — produção, 28/09/2026.
   *
   * As três tabelas que a importação escreve têm `created_by uuid not null default auth.uid()`. No APARELHO
   * o padrão funciona (tem sessão); na FUNÇÃO DO SERVIDOR não há `auth.uid()` (ela roda com a chave de
   * serviço, sem JWT), então o `default` virava NULL e o banco recusava:
   * `null value in column "created_by" of relation "reservations" violates not-null constraint`.
   *
   * Efeito real: o relógio de 15 minutos **atualizava** o que existia, mas **não criava** nada — era o
   * *"não está pegando os agendamentos ao sincronizar"* lido pelo dono (o log do servidor mostrava
   * `0 criados · 2 atualizados · 6 falhas`).
   *
   * Aqui o autor entra explícito quando quem chama sabe quem é (o servidor usa o gestor que conectou o
   * calendário — `google_calendar_credentials.updated_by`). No app nada é passado: segue valendo o
   * `default auth.uid()` de sempre.
   */
  const autoria = opcoes.criadoPor ? { created_by: opcoes.criadoPor } : {};

  /**
   * 🪤 ACHADO DA VISTORIA (02/10/2026) — a marca da pausa que ESTA importação criou.
   *
   * É o `reason` fixado no insert de `gravarPausas`. A limpeza usa o MESMO texto para apagar só as
   * pausas do Google: as que o gestor marcou no app têm outro `reason` ('Skipped on this date' — a
   * tela `app/(tabs)/calendar.tsx`), então sobrevivem à rodada.
   */
  const PAUSA_DO_GOOGLE = 'Pausa marcada no Google Calendar';

  /** O `reason` da pausa de UM dia gravada pelo evento VERMELHO (`skipRecurringDay`). */
  const CANCELAMENTO_DO_GOOGLE = 'Cancelled in Google Calendar';

  const gravarPausas = async (scheduleId: string, skipDates: string[]): Promise<void> => {
    /**
     * 🪤 ACHADO DA VISTORIA (02/10/2026): o `delete` antigo varria TODA `action = 'skip'` da série
     * (`eq('action', 'skip')`) e levava junto as pausas criadas NO APP — que não existem no Google.
     * Resultado: o gestor pausava um dia no app e a importação apagava a pausa na rodada seguinte
     * (as "férias" do cão sumiam). O certo é apagar só as pausas que VIERAM do Google, identificadas
     * pela marca acima; as do app ficam.
     */
    await client.from('recurring_exceptions').delete().eq('recurring_schedule_id', scheduleId).eq('reason', PAUSA_DO_GOOGLE);
    if (skipDates.length === 0) return;
    const { error } = await client.from('recurring_exceptions').insert(
      skipDates.map((dia) => ({
        ...autoria,
        organization_id: organizationId,
        recurring_schedule_id: scheduleId,
        action: 'skip',
        start_date: dia,
        end_date: dia,
        reason: PAUSA_DO_GOOGLE,
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
            ...autoria,
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
        ...autoria,
        organization_id: organizationId,
        dog_id: dogId,
        service_type: parsed.serviceType,
        start_date: parsed.startDate,
        end_date: parsed.endDate,
        transport_required: parsed.transportRequired ?? true,
        // Contrato do cliente (28/09/2026): "todo boarding vai pro daycare" — a importação marca FALSE
        // só na chegada fora do horário (Cocoa no pick-up), quando o cão não passa pelo daycare.
        goes_to_daycare: parsed.goesToDaycare ?? true,
        // Dia de CHEGADA/SAIDA da hospedagem (avocado): o cao esta na casa — parada normal da rota,
        // nunca "ja esta na van" (dono, 06/10/2026).
        movement_day: parsed.movementDay ?? false,
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

    updateBooking: async ({ bookingId, kind, eventId, dogId, parsed, semVinculo = false }) => {
      if (kind === 'recurring') {
        const { error } = await client
          .from('recurring_schedules')
          .update({
            dog_id: dogId,
            weekdays: parsed.weekdays,
            start_date: parsed.startDate,
            end_date: fimDaSerie(parsed),
            active: true,
            ...(semVinculo ? {} : { google_event_id: eventId }),
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
          /**
           * `movement_day` SEGUE o evento — ao contrário de `transport_required` e `goes_to_daycare`, que
           * são decisão do gestor no app (por isso não são regravados aqui): quem pinta o dia de
           * chegada/saída (avocado) ou o dia de hotel (verde) é o escritório, e é essa pintura que diz
           * se o cão entra na fila de pickup do dia.
           */
          movement_day: parsed.movementDay ?? false,
          /**
           * 🪤 ACHADO DA VISTORIA (02/10/2026): NÃO regrave `transport_required` nem `goes_to_daycare`
           * numa reserva que JÁ existe. Os dois são DECISÃO DO GESTOR no app — "precisa de transporte"
           * (o cão entra na van?) e "vai pro daycare" (conta no Total Pack?) — e eram recarimbados com
           * o valor do evento do Google a cada Sync, apagando o que ele tinha ajustado (o cão voltava
           * pra van / saía do pack sozinho). A importação só marca os dois quando a reserva NASCE
           * (`createBooking`); aqui manda o que o evento de fato governa: serviço, datas e status.
           */
          // O vínculo do evento é único: a linha do SEGUNDO cão de um evento de dois cães atualiza sem
          // mexer nele (senão bate no índice único e a rodada inteira registra falha).
          ...(semVinculo ? {} : { google_event_id: eventId }),
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
      /**
       * 🪤 ACHADO DA AUDITORIA DE INTEGRAÇÕES (02/10/2026): o delete antigo varria TODA `action = 'skip'`
       * daquela data, sem olhar o `reason`. Se o GESTOR tivesse pausado o mesmo dia no app (reason
       * 'Skipped on this date' — `app/(tabs)/calendar.tsx`) e o escritório pintasse o dia de vermelho no
       * Google, a rodada APAGAVA a pausa do app e regravava a linha como se fosse do Google. Agora só a
       * pausa que VEIO do vermelho (`CANCELAMENTO_DO_GOOGLE`) é substituída; a do app sobrevive.
       */
      const { error: erroDaBusca } = await client
        .from('recurring_exceptions')
        .delete()
        .eq('recurring_schedule_id', scheduleId)
        .eq('action', 'skip')
        .eq('start_date', date)
        .eq('reason', CANCELAMENTO_DO_GOOGLE);
      if (erroDaBusca) throw new Error(erroDaBusca.message);

      const { error } = await client.from('recurring_exceptions').insert({
        ...autoria,
        organization_id: organizationId,
        recurring_schedule_id: scheduleId,
        action: 'skip',
        start_date: date,
        end_date: date,
        reason: CANCELAMENTO_DO_GOOGLE,
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
        ...autoria,
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
