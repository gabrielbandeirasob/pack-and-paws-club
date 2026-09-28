/**
 * FOTOGRAFIA FRESCA PARA A IMPORTAÇÃO (Google → app).
 *
 * Por que este módulo existe (produção, 27/09/2026): o escritório tocou em "Sync now" e leu na tela
 * *"26 item(s) from Google could not be saved. First: this event already has a reservation"*. O plano de
 * importação decide "criar / atualizar / ignorar" a partir de uma lista do que já existe — e essa lista
 * vinha do ESTADO DA TELA, carregado no foco da aba. Numa rodada em que ela estava desatualizada (ou
 * vazia), todo evento que já tinha reserva parecia novo e a criação batia no índice único
 * `reservations_google_event_unico (organization_id, google_event_id)` — 26 falhas assustadoras para o
 * escritório, sem nada de errado com o calendário dele.
 *
 * Prova de que era a fotografia e não a regra: a MESMA importação rodando no servidor (que lê o banco na
 * hora) deu `0 criados · 5 atualizados · 0 para revisar` no mesmo minuto.
 *
 * Aqui a importação lê o que existe AGORA, direto do banco, em vez de confiar no que a tela carregou
 * antes. `montarCasosDaImportacao` é puro (testável sem Supabase); `carregarSnapshotDaImportacao` é a
 * leitura.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { BookingForImport, ExistingBookingKind } from './importPlan';

/** Linha crua de `reservations` (só o que o plano usa). */
export type ReservaParaImportar = {
  id: string;
  dog_id: string;
  service_type: string;
  start_date: string;
  end_date: string | null;
  google_event_id: string | null;
  source: string | null;
  status: string;
};

/** Linha crua de `recurring_schedules` (só o que o plano usa). */
export type SerieParaImportar = {
  id: string;
  dog_id: string;
  weekdays: number[] | null;
  start_date: string;
  end_date: string | null;
  google_event_id: string | null;
  source: string | null;
};

/** Converte o que o banco devolve no formato que o plano consome. Puro, por isso testável. */
export function montarCasosDaImportacao(
  reservas: ReservaParaImportar[] = [],
  series: SerieParaImportar[] = [],
): BookingForImport[] {
  return [
    ...reservas.map((reserva) => ({
      id: reserva.id,
      kind: 'reservation' as ExistingBookingKind,
      dogId: reserva.dog_id,
      googleEventId: reserva.google_event_id ?? null,
      source: (reserva.source ?? 'app') as 'app' | 'google',
      serviceType: reserva.service_type as BookingForImport['serviceType'],
      startDate: reserva.start_date,
      endDate: reserva.end_date,
      weekdays: null,
      skipDates: null,
      status: reserva.status as BookingForImport['status'],
    })),
    ...series.map((serie) => ({
      id: serie.id,
      kind: 'recurring' as ExistingBookingKind,
      dogId: serie.dog_id,
      googleEventId: serie.google_event_id ?? null,
      source: (serie.source ?? 'app') as 'app' | 'google',
      serviceType: 'daycare' as BookingForImport['serviceType'],
      startDate: serie.start_date,
      endDate: serie.end_date,
      weekdays: serie.weekdays ?? [],
      skipDates: null,
      status: 'active' as BookingForImport['status'],
    })),
  ];
}

/**
 * Lê o que existe AGORA no banco (confirmadas e canceladas + escalas ativas). Chamada pelo cartão do Google no
 * momento da importação — é o que impede a rodada de "criar" o que já está lá.
 */
export async function carregarSnapshotDaImportacao(
  client: SupabaseClient,
  organizationId: string,
): Promise<BookingForImport[]> {
  const [reservas, series] = await Promise.all([
    client
      .from('reservations')
      .select('id, dog_id, service_type, start_date, end_date, google_event_id, source, status')
      .eq('organization_id', organizationId)
      .in('status', ['confirmed', 'cancelled']),
    client
      .from('recurring_schedules')
      .select('id, dog_id, weekdays, start_date, end_date, google_event_id, source')
      .eq('organization_id', organizationId)
      .eq('active', true),
  ]);
  if (reservas.error) throw new Error(reservas.error.message);
  if (series.error) throw new Error(series.error.message);
  return montarCasosDaImportacao(
    (reservas.data ?? []) as unknown as ReservaParaImportar[],
    (series.data ?? []) as unknown as SerieParaImportar[],
  );
}
