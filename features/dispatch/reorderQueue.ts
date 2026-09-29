/** Troca sem mutar a entrada e normaliza a numeração exibida. */
export function trocarNaOrdem<T extends { dogId: string; sequence: number }>(
  paradas: readonly T[], dogId: string, direcao: -1 | 1,
): T[] | null {
  const ordem = [...paradas].sort((a, b) => a.sequence - b.sequence);
  const origem = ordem.findIndex((parada) => parada.dogId === dogId);
  const destino = origem + direcao;
  if (origem < 0 || destino < 0 || destino >= ordem.length) return null;
  [ordem[origem], ordem[destino]] = [ordem[destino], ordem[origem]];
  return ordem.map((parada, indice) => ({ ...parada, sequence: indice + 1 }));
}

/** Uma escrita por rota; durante a confirmação só interessa a última intenção. */
export function criarFilaDeEscrita<T>({ escrever }: {
  escrever: (rotaId: string, ordem: T) => Promise<void>;
}) {
  const rotas = new Map<string, { ultima: T; revisao: number; promessa: Promise<void> }>();
  return {
    aguardar: (rotaId: string) => rotas.get(rotaId)?.promessa ?? Promise.resolve(),
    pendente: (rotaId: string) => rotas.has(rotaId),
    enfileirar(rotaId: string, ordem: T): Promise<void> {
      const existente = rotas.get(rotaId);
      if (existente) {
        existente.ultima = ordem;
        existente.revisao++;
        return existente.promessa;
      }
      const estado = { ultima: ordem, revisao: 0, promessa: Promise.resolve() };
      rotas.set(rotaId, estado);
      estado.promessa = (async () => {
        // Permite registrar a promessa antes de executar inclusive escritores síncronos.
        await Promise.resolve();
        try {
          let revisao;
          do {
            revisao = estado.revisao;
            await escrever(rotaId, estado.ultima);
          } while (revisao !== estado.revisao);
        } finally {
          rotas.delete(rotaId);
        }
      })();
      return estado.promessa;
    },
  };
}
