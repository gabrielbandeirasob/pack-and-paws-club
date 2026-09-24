/**
 * Escritas no banco da importacao do Google Calendar (as "portas" do executor de importacao).
 *
 * Regra de ouro do módulo: reserva/série que nasce no Google entra marcada (`source = 'google'` e
 * `google_event_id`) — é isso que depois diz ao espelho "não crie outro evento, atualize ESTE", e à
 * importação "Google manda nos dias desta".
 *
 * Desde 24/09/2026 (pedido do dono: "puxe TODOS os agendamentos") o módulo também CADASTRA cliente e
 * cão quando o título do evento não casa com nenhum cão do app: `createClient` procura por nome antes
 * de criar (nada de cliente repetido) e `createDog` pendura o cão nesse cliente.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ImportPorts } from './importService';
import { kindOf, normalizar, type BookingForImport, type ExistingBookingKind, type ParsedBooking } from './importPlan';

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

  /**
   * Clientes cadastrados NESTA sincronização (nome normalizado → id).
   *
   * Dois eventos do mesmo tutor (ou o mesmo nome repetido em títulos diferentes) não podem virar
   * dois clientes iguais: o segundo uso da mesma rodada reaproveita o que o primeiro criou.
   */
  const clientesDaRodada = new Map<string, string>();

  /** `ilike` do Postgres casa `%` e `_` como curinga: escapa para procurar o nome literal. */
  const escaparLike = (valor: string): string => valor.replace(/[\\%_]/g, '\\$&');

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
   */
  return {
    /**
     * Cliente do cão que está nascendo agora, a partir do nome que veio no título do evento.
     *
     * Procura antes de criar: o gestor pode já ter cadastrado esse tutor (ou um evento anterior da
     * mesma sincronização pode ter criado), e cliente repetido é lixo no cadastro. O nome veio do
     * título, então é ele que o gestor renomeia depois — a importação não mexe mais nesse campo.
     */
    createClient: async ({ name }) => {
      const nome = name.trim();
      const chave = normalizar(nome);
      const daRodada = clientesDaRodada.get(chave);
      if (daRodada) return { clientId: daRodada };

      const { data: existente, error: buscaError } = await client
        .from('clients')
        .select('id')
        .eq('organization_id', organizationId)
        .ilike('name', escaparLike(nome))
        .limit(1)
        .maybeSingle();
      if (buscaError) throw new Error(buscaError.message);
      const achado = (existente as { id: string } | null)?.id ?? null;
      if (achado) {
        clientesDaRodada.set(chave, achado);
        return { clientId: achado };
      }

      const { data, error } = await client
        .from('clients')
        .insert({ organization_id: organizationId, name: nome, active: true })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      const criado = (data as { id: string } | null)?.id;
      if (!criado) throw new Error('clients: insert sem id');
      clientesDaRodada.set(chave, criado);
      return { clientId: criado };
    },

    /** Cão do mesmo caso: nasce ativo, sob o cliente acima (o dono ajusta raça/foto depois). */
    createDog: async ({ clientId, name }) => {
      const { data, error } = await client
        .from('dogs')
        .insert({ organization_id: organizationId, client_id: clientId, name: name.trim(), active: true })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      const criado = (data as { id: string } | null)?.id;
      if (!criado) throw new Error('dogs: insert sem id');
      return { dogId: criado };
    },

    createBooking: async ({ eventId, dogId, kind, parsed }) => {
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
            transport_required: true,
            google_event_id: eventId,
            source: 'google',
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        const criado = (data as { id: string } | null)?.id;
        if (criado) await gravarPausas(criado, parsed.skipDates);
        return;
      }

      const { error } = await client.from('reservations').insert({
        organization_id: organizationId,
        dog_id: dogId,
        service_type: parsed.serviceType,
        start_date: parsed.startDate,
        end_date: parsed.endDate,
        transport_required: true,
        google_event_id: eventId,
        source: 'google',
      });
      if (error) throw new Error(error.message);
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
  };
}
