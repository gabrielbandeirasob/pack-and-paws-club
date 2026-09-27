/**
 * DIA DA OPERAÇÃO — acesso ao banco (migração 035) e leitura dos cães de um dia.
 *
 * Tudo é por DIA LOCAL da organização (`YYYY-MM-DD`), como o resto do app. O cliente Supabase entra
 * por parâmetro (mesma convenção de `features/organization/locations.ts`), o que deixa estas funções
 * testáveis com um cliente falso.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildDay,
  type DaySummary,
  type RecurringExceptionRecord,
  type RecurringScheduleRecord,
  type ReservationRecord,
} from '@/features/calendar/dayMath';
import { dogsOfDay, limparTexto, TODO_TEXTO_MAX, type DailyTodo, type DayDog, type PackEntry } from './dayOperation';

export type DayPlan = {
  revenueCents: number | null;
  walkLocation: string | null;
  photoIdea: string | null;
};

export const PLANO_VAZIO: DayPlan = { revenueCents: null, walkLocation: null, photoIdea: null };

/* ------------------------------- fechamento do dia ------------------------------- */

export async function loadDayPlan(client: SupabaseClient, organizationId: string, day: string): Promise<DayPlan> {
  const { data, error } = await client
    .from('daily_plans')
    .select('revenue_cents, walk_location, photo_idea')
    .eq('organization_id', organizationId)
    .eq('day', day)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return PLANO_VAZIO;
  const linha = data as { revenue_cents: number | null; walk_location: string | null; photo_idea: string | null };
  return {
    revenueCents: linha.revenue_cents ?? null,
    walkLocation: linha.walk_location ?? null,
    photoIdea: linha.photo_idea ?? null,
  };
}

/**
 * Grava o que o gestor digitou. `undefined` = não mexe no campo (é assim que salvar só o faturamento
 * não apaga o local da caminhada); `null` = limpa.
 */
export async function saveDayPlan(
  client: SupabaseClient,
  params: { organizationId: string; day: string; revenueCents?: number | null; walkLocation?: string | null; photoIdea?: string | null },
): Promise<void> {
  const corpo: Record<string, unknown> = { organization_id: params.organizationId, day: params.day };
  if (params.revenueCents !== undefined) corpo.revenue_cents = params.revenueCents;
  if (params.walkLocation !== undefined) corpo.walk_location = limparTexto(params.walkLocation);
  if (params.photoIdea !== undefined) corpo.photo_idea = limparTexto(params.photoIdea);
  const { error } = await client.from('daily_plans').upsert(corpo, { onConflict: 'organization_id,day' });
  if (error) throw new Error(error.message);
}

/* ---------------------------------- to-do list ---------------------------------- */

export async function loadTodos(client: SupabaseClient, organizationId: string, day: string): Promise<DailyTodo[]> {
  const { data, error } = await client
    .from('daily_todos')
    .select('id, text, done, position')
    .eq('organization_id', organizationId)
    .eq('day', day)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as DailyTodo[] | null) ?? [];
}

export async function addTodo(
  client: SupabaseClient,
  params: { organizationId: string; day: string; text: string; position: number },
): Promise<DailyTodo> {
  const texto = limparTexto(params.text, TODO_TEXTO_MAX);
  if (!texto) throw new Error('empty todo');
  const { data, error } = await client
    .from('daily_todos')
    .insert({ organization_id: params.organizationId, day: params.day, text: texto, position: params.position })
    .select('id, text, done, position')
    .single();
  if (error) throw new Error(error.message);
  return data as DailyTodo;
}

export async function setTodoDone(client: SupabaseClient, id: string, done: boolean): Promise<void> {
  const { error } = await client.from('daily_todos').update({ done }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateTodoText(client: SupabaseClient, id: string, text: string): Promise<void> {
  const texto = limparTexto(text, TODO_TEXTO_MAX);
  if (!texto) throw new Error('empty todo');
  const { error } = await client.from('daily_todos').update({ text: texto }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function removeTodo(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('daily_todos').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* -------------------------------------- pack -------------------------------------- */

export async function loadPackEntries(client: SupabaseClient, organizationId: string, day: string): Promise<PackEntry[]> {
  const { data, error } = await client
    .from('pack_entries')
    .select('dog_id, in_pack, walker_id')
    .eq('organization_id', organizationId)
    .eq('day', day);
  if (error) throw new Error(error.message);
  return ((data as { dog_id: string; in_pack: boolean; walker_id: string | null }[] | null) ?? []).map((linha) => ({
    dogId: linha.dog_id,
    inPack: linha.in_pack,
    walkerId: linha.walker_id,
  }));
}

async function gravarPack(
  client: SupabaseClient,
  params: { organizationId: string; day: string; dogId: string; inPack?: boolean; walkerId?: string | null },
): Promise<void> {
  const corpo: Record<string, unknown> = {
    organization_id: params.organizationId,
    day: params.day,
    dog_id: params.dogId,
    // Sem valor novo, o DEFAULT da tabela vale no INSERT (`in_pack = true`); no conflito, só o campo
    // informado é atualizado — tirar do pack não apaga quem caminha, e escolher quem caminha não
    // devolve o cão ao pack.
    ...(params.inPack === undefined ? {} : { in_pack: params.inPack }),
    ...(params.walkerId === undefined ? {} : { walker_id: params.walkerId }),
  };
  const { error } = await client.from('pack_entries').upsert(corpo, { onConflict: 'organization_id,day,dog_id' });
  if (error) throw new Error(error.message);
}

/** X do pack: false tira o cão da caminhada do dia; true devolve. */
export async function setPackFlag(
  client: SupabaseClient,
  params: { organizationId: string; day: string; dogId: string; inPack: boolean },
): Promise<void> {
  await gravarPack(client, params);
}

/** Quem caminha com o cão naquele dia (membro da organização; `null` limpa). */
export async function setPackWalker(
  client: SupabaseClient,
  params: { organizationId: string; day: string; dogId: string; walkerId: string | null },
): Promise<void> {
  await gravarPack(client, params);
}

/* ----------------------------- cães de um dia qualquer ----------------------------- */

type ReservationRow = {
  id: string;
  service_type: 'daycare' | 'boarding';
  start_date: string;
  end_date: string;
  transport_required: boolean;
  dog: { id: string; name: string; client: { name: string } };
};
type RecurringRow = {
  id: string;
  weekdays: number[];
  start_date: string;
  end_date: string | null;
  active: boolean;
  transport_required: boolean;
  dog: { id: string; name: string; client: { name: string } };
};
type ExceptionRow = { id: string; recurring_schedule_id: string; action: 'skip' | 'transport_on' | 'transport_off'; start_date: string; end_date: string };

/**
 * Os cães de um dia (daycare + boarding) — é o que alimenta os 5 indicadores, o pack e o histórico.
 * Usa a MESMA conta do calendário (`buildDay`), para a tela do dia não divergir do calendário.
 */
export async function loadDayDogs(client: SupabaseClient, organizationId: string, isoDay: string): Promise<DayDog[]> {
  const [reservas, series, excecoes] = await Promise.all([
    client
      .from('reservations')
      .select('id, service_type, start_date, end_date, transport_required, dog:dogs(id, name, client:clients(name))')
      .eq('organization_id', organizationId)
      .eq('status', 'confirmed')
      .lte('start_date', isoDay)
      .gte('end_date', isoDay),
    client
      .from('recurring_schedules')
      .select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(name))')
      .eq('organization_id', organizationId)
      .eq('active', true)
      .lte('start_date', isoDay),
    client.from('recurring_exceptions').select('id, recurring_schedule_id, action, start_date, end_date').eq('organization_id', organizationId),
  ]);
  const erro = reservas.error ?? series.error ?? excecoes.error;
  if (erro) throw new Error(erro.message);

  const { reservas: reservasMapeadas, series: seriesMapeadas, excecoes: excecoesMapeadas } = paraRegistros(reservas.data, series.data, excecoes.data);
  const dia = buildDay(isoDay, reservasMapeadas, seriesMapeadas, excecoesMapeadas);
  return dogsOfDaySummary(dia);
}

/**
 * Os cães de VÁRIOS dias de uma vez (o resumo da semana, 27/09/2026) — três consultas em vez de
 * três por dia, e a mesma conta do calendário por dia (`buildDay`).
 *
 * As reservas são as que CRUZAM o período (começa antes do fim e termina depois do começo): uma
 * hospedagem de dez dias precisa aparecer em cada um deles.
 */
export async function loadWeekDogs(
  client: SupabaseClient,
  organizationId: string,
  isoDays: string[],
): Promise<Record<string, DayDog[]>> {
  if (isoDays.length === 0) return {};
  const inicio = isoDays[0];
  const fim = isoDays[isoDays.length - 1];
  const [reservas, series, excecoes] = await Promise.all([
    client
      .from('reservations')
      .select('id, service_type, start_date, end_date, transport_required, dog:dogs(id, name, client:clients(name))')
      .eq('organization_id', organizationId)
      .eq('status', 'confirmed')
      .lte('start_date', fim)
      .gte('end_date', inicio),
    client
      .from('recurring_schedules')
      .select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(name))')
      .eq('organization_id', organizationId)
      .eq('active', true)
      .lte('start_date', fim),
    client.from('recurring_exceptions').select('id, recurring_schedule_id, action, start_date, end_date').eq('organization_id', organizationId),
  ]);
  const erro = reservas.error ?? series.error ?? excecoes.error;
  if (erro) throw new Error(erro.message);

  const registros = paraRegistros(reservas.data, series.data, excecoes.data);
  return Object.fromEntries(
    isoDays.map((dia) => [dia, dogsOfDaySummary(buildDay(dia, registros.reservas, registros.series, registros.excecoes))]),
  );
}

/** Linhas do banco -> registros que `buildDay` entende (o dia e a semana passam por aqui). */
function paraRegistros(
  reservas: unknown,
  series: unknown,
  excecoes: unknown,
): { reservas: ReservationRecord[]; series: RecurringScheduleRecord[]; excecoes: RecurringExceptionRecord[] } {
  const reservasMapeadas: ReservationRecord[] = ((reservas as ReservationRow[] | null) ?? []).map((row) => ({
    id: row.id,
    dog: { id: row.dog.id, dogName: row.dog.name, clientName: row.dog.client.name },
    serviceType: row.service_type,
    startDate: row.start_date,
    endDate: row.end_date,
    transportRequired: row.transport_required,
  }));
  const seriesMapeadas: RecurringScheduleRecord[] = ((series as RecurringRow[] | null) ?? []).map((row) => ({
    id: row.id,
    dog: { id: row.dog.id, dogName: row.dog.name, clientName: row.dog.client.name },
    weekdays: row.weekdays,
    startDate: row.start_date,
    endDate: row.end_date,
    active: row.active,
    transportRequired: row.transport_required,
  }));
  const excecoesMapeadas: RecurringExceptionRecord[] = ((excecoes as ExceptionRow[] | null) ?? []).map((row) => ({
    id: row.id,
    scheduleId: row.recurring_schedule_id,
    action: row.action,
    startDate: row.start_date,
    endDate: row.end_date,
  }));
  return { reservas: reservasMapeadas, series: seriesMapeadas, excecoes: excecoesMapeadas };
}

/**
 * Cães de um dia a partir do que `buildDay` devolveu: daycare + boarding, sem repetir o mesmo cão
 * (quem está nos dois vale boarding), já sem os pulados (`paused`). A Home usa esta função com os
 * dados que ela JÁ carregou, para os indicadores não divergirem do calendário.
 */
export function dogsOfDaySummary(dia: DaySummary): DayDog[] {
  const paraCao = (item: { dogId: string; dogName: string; clientName: string }, serviceType: 'daycare' | 'boarding'): DayDog => ({
    dogId: item.dogId,
    dogName: item.dogName,
    clientName: item.clientName,
    serviceType,
  });
  const daycare = dia.daycare.filter((item) => !item.paused).map((item) => paraCao(item, 'daycare'));
  const boarding = dia.boarding.filter((item) => !item.paused).map((item) => paraCao(item, 'boarding'));
  return dogsOfDay(daycare, boarding);
}
