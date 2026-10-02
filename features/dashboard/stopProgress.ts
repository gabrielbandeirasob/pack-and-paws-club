import { formatClock, formatTimeOfDay } from '@/lib/clock';

/**
 * MARCOS DE TEMPO DA PARADA — o que o gestor e o motorista leem.
 *
 * Pedido do CLIENTE (áudios de 01/10/2026, encaminhados pelo dono): *"no Today's Routes seria ideal se
 * você conseguisse clicar no driver e abrir uma lista dos pick-up que tem e os que ainda falta e que
 * hora foi feita cada pick-up"* e, na tela do motorista, *"podia aparecer qual cachorro já foi e que
 * hora"*. O banco JÁ carimba os marcos no servidor desde a migration 024 (`arrived_at`,
 * `picked_up_at`, `completed_at`, `skipped_at`) — faltava a tela mostrar.
 *
 * Módulo puro de propósito: as duas telas (painel do gestor e app do motorista) usam a MESMA frase,
 * e a regra fica testável sem UI. A hora é lida no fuso do APARELHO (`Date` local) — é a hora de
 * relógio que quem opera vê, e a mesma que o nome do arquivo de gravação/rota registra.
 */

/** O mínimo que uma parada precisa ter para a linha de tempo ser montada. */
export type ParadaComMarcos = {
  status: string;
  arrivedAt?: string | null;
  pickedUpAt?: string | null;
  completedAt?: string | null;
  skippedAt?: string | null;
  /**
   * Marco de ENTREGA (`route_stops.delivered_at`, migration 202610010041). A busca concluída
   * (`completed_at`) não é a entrega: com o fluxo de 2 toques, a parada fica `completed` no
   * pick-up e a entrega só chega à tarde — sem este marco a tarde inteira ficava sem registro.
   */
  deliveredAt?: string | null;
  /** HH:MM exigido (texto do banco, sem data). */
  exactTime?: string | null;
  /** Fim da janela (texto do banco, sem data). */
  windowEnd?: string | null;
};

/** Hora em 12 h na hora do aparelho. `null` quando não há marco (ou o valor não é uma data). */
export function horaCurta(iso?: string | null): string | null {
  return formatClock(iso);
}

/** A parada já terminou? (`completed` e `skipped`/problema contam como resolvidas.) */
export function jaFeita(parada: Pick<ParadaComMarcos, 'status'>): boolean {
  return parada.status === 'completed' || parada.status === 'skipped';
}

/**
 * Linha de tempo de UMA parada:
 *  - concluída/pendente com marcos → `arrived 8:12 AM · done 8:18 AM` (só o que existe);
 *  - entrega → `delivered 2:05 PM`, sem os marcos da busca;
 *  - problema → `Problem · 8:14 AM`;
 *  - sem marco nenhum → a previsão da parada (`Must arrive by 8:30 AM` / `until 9:00 AM`) ou `Pending`.
 */
export function marcosDaParada(parada: ParadaComMarcos, phase: 'pickup' | 'dropoff' = 'pickup'): string {
  if (phase === 'dropoff') {
    const entrega = horaCurta(parada.deliveredAt);
    return entrega ? `delivered ${entrega}` : situacaoDaEntrega(parada);
  }
  if (parada.status === 'skipped') {
    const quando = horaCurta(parada.skippedAt) ?? horaCurta(parada.arrivedAt);
    return quando ? `Problem · ${quando}` : 'Problem';
  }
  const partes: string[] = [];
  const chegada = horaCurta(parada.arrivedAt);
  const conclusao = horaCurta(parada.completedAt) ?? horaCurta(parada.pickedUpAt);
  if (chegada) partes.push(`arrived ${chegada}`);
  if (conclusao) partes.push(`done ${conclusao}`);
  if (partes.length > 0) return partes.join(' · ');
  if (parada.exactTime) return `Must arrive by ${formatTimeOfDay(parada.exactTime)}`;
  if (parada.windowEnd) return `Window until ${formatTimeOfDay(parada.windowEnd)}`;
  return 'Pending';
}

/** `4 of 6 done` — o resumo que abre a lista (o que o cliente pediu: o que já foi e o que falta). */
export function resumoDaRota(paradas: Pick<ParadaComMarcos, 'status'>[]): string {
  const feitas = paradas.filter(jaFeita).length;
  return `${feitas} of ${paradas.length} done`;
}

/**
 * `3 of 6 delivered` — quantas paradas já foram ENTREGUES (marco `delivered_at`). A busca concluída
 * NÃO conta como entrega: o cliente pediu justamente para ver a tarde, não só a manhã (01/10/2026).
 */
export function resumoDaEntrega(paradas: Pick<ParadaComMarcos, 'deliveredAt'>[]): string {
  const entregues = paradas.filter((parada) => Boolean(parada.deliveredAt)).length;
  return `${entregues} of ${paradas.length} delivered`;
}

/** A próxima parada que ainda não terminou (na ordem recebida) — `null` quando acabou. */
export function proximaPendente<T extends ParadaComMarcos>(paradas: T[]): T | null {
  return paradas.find((parada) => !jaFeita(parada)) ?? null;
}

/**
 * SITUAÇÃO DA ENTREGA de uma parada — o que o gestor lê na lista de DROP-OFFS (cliente, 02/10/2026:
 * *"onde eu vejo os drop off?"*). A busca concluída NÃO é entrega: por isso o rótulo vem do marco
 * `delivered_at`, não do `status` (que fica `completed` já no pick-up).
 */
export function situacaoDaEntrega(
  parada: Pick<ParadaComMarcos, 'status' | 'deliveredAt' | 'pickedUpAt' | 'completedAt'>,
): string {
  if (parada.status === 'skipped') return 'Problem';
  const entrega = horaCurta(parada.deliveredAt);
  if (entrega) return `Delivered · ${entrega}`;
  const naVan = Boolean(parada.pickedUpAt) || Boolean(parada.completedAt) || parada.status === 'picked_up' || parada.status === 'completed';
  return naVan ? 'In the van' : 'Pending';
}

/** A próxima ENTREGA pendente (cão já embarcado ou posto direto na tarde) — `null` quando acabou. */
export function proximaEntrega<T extends ParadaComMarcos>(paradas: T[]): T | null {
  return paradas.find((parada) => parada.status !== 'skipped' && !parada.deliveredAt) ?? null;
}
