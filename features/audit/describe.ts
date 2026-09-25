/**
 * Auditoria: traduz uma linha de `audit_logs` em algo que o escritório entende ("Alex removed the client
 * Ana Souza", "Sam marked the stop as completed").
 *
 * Regra de honestidade: se o campo que mudou não tiver tradução conhecida, o resumo NÃO inventa — ele diz
 * o que mudou pelos nomes técnicos ("changed the client (phone, notes)").
 *
 * Implementado no agente2 (25/09/2026), melhoria 1 da revisão das contas: a tabela `audit_logs` existia
 * vazia, sem escritor nenhum; a migration 032 passou a alimentá-la e esta é a leitura para o gestor.
 */

export type AuditEntry = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  created_at: string;
  metadata: {
    changed?: string[] | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  } | null;
};

export type AuditRead = {
  /** Nome de quem fez (ou "Someone" quando o autor não é conhecido). */
  actor: string;
  /** Frase curta para a lista. */
  resumo: string;
  /** Detalhe do que mudou (ou null quando não há o que detalhar). */
  detalhe: string | null;
};

const ENTIDADES: Record<string, string> = {
  clients: 'client',
  dogs: 'dog',
  reservations: 'booking',
  routes: 'route',
  route_stops: 'stop',
  recurring_schedules: 'weekly schedule',
  recurring_exceptions: 'schedule change',
  driver_shifts: 'shift',
  organization_members: 'team member',
};

const VERBOS: Record<string, string> = { created: 'added', updated: 'changed', deleted: 'removed' };

/** Campos cujo nome técnico vira frase de gente. */
const CAMPOS: Record<string, string> = {
  name: 'name',
  phone: 'phone',
  address_line_1: 'address',
  address_line_2: 'address',
  city: 'city',
  state: 'state',
  postal_code: 'ZIP',
  notes: 'notes',
  status: 'status',
  service_type: 'service',
  start_date: 'dates',
  end_date: 'dates',
  weekdays: 'weekdays',
  active: 'active',
  latitude: 'address pin',
  longitude: 'address pin',
  driver_id: 'driver',
  route_id: 'route',
  sequence: 'order',
  window_start: 'time window',
  window_end: 'time window',
  exact_time: 'time',
  priority: 'priority',
  transport_required: 'transport',
  role: 'role',
  ended_at: 'hours',
  start_reason: 'hours',
  end_reason: 'hours',
};

function nomeDe(valor: Record<string, unknown> | null | undefined): string | null {
  const nome = valor?.name;
  return typeof nome === 'string' && nome.trim() ? nome.trim() : null;
}

function camposAmigaveis(mudados: string[] | null | undefined): string | null {
  if (!mudados || mudados.length === 0) return null;
  const vistos = new Set<string>();
  for (const campo of mudados) {
    const rotulo = CAMPOS[campo];
    if (rotulo) vistos.add(rotulo);
    else if (!campo.endsWith('_at') && campo !== 'id' && campo !== 'organization_id') vistos.add(campo);
  }
  const lista = [...vistos];
  if (lista.length === 0) return null;
  return lista.join(', ');
}

export function describeAuditEntry(entrada: AuditEntry, nomes: Record<string, string> = {}): AuditRead {
  const autor = (entrada.actor_user_id && nomes[entrada.actor_user_id]) || 'Someone';
  const entidade = ENTIDADES[entrada.entity_type] ?? entrada.entity_type;
  const verbo = VERBOS[entrada.action] ?? entrada.action;
  const antes = entrada.metadata?.before ?? null;
  const depois = entrada.metadata?.after ?? null;
  const mudados = entrada.metadata?.changed ?? null;

  // ALTERAÇÃO DE NOME: o caso mais comum e o mais fácil de mostrar bonito ("renamed the dog A → B").
  const nomeAntes = nomeDe(antes);
  const nomeDepois = nomeDe(depois);
  if (entrada.action === 'updated' && (mudados ?? []).includes('name') && nomeDepois) {
    return {
      actor: autor,
      resumo: nomeAntes && nomeAntes !== nomeDepois
        ? `renamed the ${entidade} ${nomeAntes} → ${nomeDepois}`
        : `renamed the ${entidade} to ${nomeDepois}`,
      detalhe: null,
    };
  }

  const alvo = nomeDepois ?? nomeAntes;
  const base = `${verbo} the ${entidade}${alvo ? ` ${alvo}` : ''}`;

  // MUDANÇA DE STATUS: o que o escritório mais precisa saber (marcou como concluído / problema / cancelou).
  if (entrada.action === 'updated' && (mudados ?? []).includes('status')) {
    const de = typeof antes?.status === 'string' ? (antes.status as string) : null;
    const para = typeof depois?.status === 'string' ? (depois.status as string) : null;
    if (para) {
      return { actor: autor, resumo: `${base} — status ${de ? `${de} → ` : ''}${para}`, detalhe: null };
    }
  }

  const detalhe = entrada.action === 'updated' ? camposAmigaveis(mudados) : null;

  if (entrada.action === 'deleted') {
    return { actor: autor, resumo: base, detalhe: alvo ? null : 'the record no longer exists' };
  }
  if (entrada.action === 'created') {
    return { actor: autor, resumo: base, detalhe: null };
  }
  return {
    actor: autor,
    resumo: base,
    detalhe: detalhe ? `changed: ${detalhe}` : null,
  };
}

/** "just now" · "12 min ago" · "3 h ago" · "yesterday" · "24/09/2026" — sempre em relação a `agora`. */
export function tempoRelativo(iso: string, agora: Date = new Date()): string {
  const quando = new Date(iso);
  const diferenca = agora.getTime() - quando.getTime();
  if (Number.isNaN(diferenca)) return '';
  const minutos = Math.floor(diferenca / 60000);
  if (minutos < 1) return 'just now';
  if (minutos < 60) return `${minutos} min ago`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h ago`;
  const diasCalendario = Math.floor(
    (Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()) -
      Date.UTC(quando.getFullYear(), quando.getMonth(), quando.getDate())) / 86400000,
  );
  if (diasCalendario === 1) return 'yesterday';
  if (diasCalendario < 7) return `${diasCalendario} days ago`;
  return quando.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
