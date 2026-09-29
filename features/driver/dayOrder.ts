/** Campos compartilhados pela lista do motorista e pelo cálculo de ETA. */
type ParadaDoDia = {
  sequence: number;
  dropoffSequence?: number | null;
  status: string;
};

function esperaBusca(stop: ParadaDoDia): boolean {
  return stop.status === 'pending' || stop.status === 'arrived';
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

/** Completed e skipped estão resolvidas; cães embarcados aguardam o fim das buscas. */
export function proximaParadaDoDia<T extends ParadaDoDia>(stops: readonly T[]): T | null {
  const busca = stops.some(esperaBusca);
  return ordenarParadasDoDia(stops).find((stop) =>
    busca ? esperaBusca(stop) : stop.status === 'picked_up',
  ) ?? null;
}
