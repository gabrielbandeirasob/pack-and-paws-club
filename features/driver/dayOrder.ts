/**
 * A ORDEM DO DIA DO MOTORISTA — uma única verdade para lista, numeração, "próximo cão" e ETA.
 *
 * Dois momentos, duas ordens (decisão do dono, 29/09/2026): enquanto alguma parada espera BUSCA vale a
 * ordem da busca; quando as buscas acabam, o dia inteiro passa à ordem da ENTREGA (`dropoff_sequence`).
 *
 * ENTREGA PENDENTE (conferência do dono, 01/10/2026 — itens 2 e 5): o fluxo de 2 toques do motorista
 * ("I arrived" + "Next") grava `picked_up` E `completed` na hora do pick-up. Sem o marco de entrega,
 * bastava ele marcar as buscas para o app achar que a ROTA INTEIRA tinha acabado — às 09:25 da manhã,
 * medido na rota real de 01/10/2026 — e a tarde ficava sem "próximo cão", sem ETA e sem o botão de
 * avisar o tutor. Agora a parada `completed` só sai da fila quando a ENTREGA é confirmada
 * (`route_stops.delivered_at`, migração 041) ou quando ela foi marcada como problema (`skipped`).
 */
type ParadaDoDia = {
  sequence: number;
  dropoffSequence?: number | null;
  status: string;
  /** Marco de ENTREGA carimbado no servidor. Ausente/null = entrega pendente. */
  deliveredAt?: string | null;
};

function esperaBusca(stop: ParadaDoDia): boolean {
  return stop.status === 'pending' || stop.status === 'arrived';
}

/** A parada já foi entregue? `skipped` (problema) também sai da fila do motorista. */
export function entregue(stop: Pick<ParadaDoDia, 'status' | 'deliveredAt'>): boolean {
  return Boolean(stop.deliveredAt) || stop.status === 'skipped';
}

/** A lista inteira mantém a busca até a última coleta; depois segue a entrega publicada. */
export function ordenarParadasDoDia<T extends ParadaDoDia>(stops: readonly T[]): T[] {
  const busca = stops.some(esperaBusca);
  return [...stops].sort((a, b) => {
    if (!busca) {
      if (a.dropoffSequence == null && b.dropoffSequence != null) return 1;
      if (a.dropoffSequence != null && b.dropoffSequence == null) return -1;
      if (a.dropoffSequence != null && b.dropoffSequence != null) {
        const diferenca = a.dropoffSequence - b.dropoffSequence;
        if (diferenca !== 0) return diferenca;
      }
    }
    return a.sequence - b.sequence;
  });
}

/**
 * A próxima parada do dia:
 *  - durante as buscas → a primeira que ainda espera busca;
 *  - depois das buscas → a primeira ENTREGA pendente (cão já embarcado, `delivered_at` vazio).
 * `null` só quando não falta nada (dia realmente terminado).
 */
export function proximaParadaDoDia<T extends ParadaDoDia>(stops: readonly T[]): T | null {
  const ordenadas = ordenarParadasDoDia(stops);
  if (stops.some(esperaBusca)) return ordenadas.find(esperaBusca) ?? null;
  return ordenadas.find((stop) =>
    !entregue(stop) && (stop.status === 'picked_up' || stop.status === 'completed'),
  ) ?? null;
}
