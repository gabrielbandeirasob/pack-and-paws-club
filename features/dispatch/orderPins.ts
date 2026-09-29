/** Regras puras compartilhadas pelas duas pernas. A ordem de travadas decide empates. */
export type Pin = { tipo: 'first' | 'last' | 'fixed'; posicao?: number | null };
export type PinDaParada = { dogId: string; pin: Pin | null };
export type Perna = 'pickup' | 'dropoff';
export type Travas = {
  pickupPin?: Pin['tipo'] | null;
  pickupPinPosition?: number | null;
  dropoffPin?: Pin['tipo'] | null;
  dropoffPinPosition?: number | null;
};
export function pinDaParada(parada: Travas, perna: Perna): Pin | null {
  const tipo = parada[`${perna}Pin`];
  return tipo ? { tipo, posicao: parada[`${perna}PinPosition`] } : null;
}
export function ordemDaBusca<T extends { sequence: number }>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => a.sequence - b.sequence);
}
export function ordemDaEntrega<T extends { sequence: number; dropoffSequence?: number | null }>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => {
    if (a.dropoffSequence == null) return b.dropoffSequence == null ? a.sequence - b.sequence : 1;
    if (b.dropoffSequence == null) return -1;
    return a.dropoffSequence - b.dropoffSequence || a.sequence - b.sequence;
  });
}
export function ordenarComTravas<T extends { dogId: string }>(ordem: readonly T[], travadas: readonly PinDaParada[], total: number) {
  const vagas = new Map<number, T>();
  const usados = new Set<string>();
  const conflitos: { dogIds: string[]; posicao: number; motivo: 'collision' | 'outside' }[] = [];
  for (const { dogId, pin } of travadas) {
    const parada = ordem.find((item) => item.dogId === dogId);
    if (!pin || !parada) continue;
    const posicao = pin.tipo === 'first' ? 1 : pin.tipo === 'last' ? total : pin.posicao ?? 0;
    if (usados.has(dogId)) {
      if (vagas.get(posicao)?.dogId !== dogId) conflitos.push({ dogIds: [dogId], posicao, motivo: 'collision' });
      continue;
    }
    if (!Number.isInteger(posicao) || posicao < 1 || posicao > total || posicao > ordem.length) {
      conflitos.push({ dogIds: [dogId], posicao, motivo: 'outside' });
    } else if (vagas.has(posicao)) {
      conflitos.push({ dogIds: [vagas.get(posicao)!.dogId, dogId], posicao, motivo: 'collision' });
    } else {
      vagas.set(posicao, parada);
      usados.add(dogId);
    }
  }
  const livres = ordem.filter((item) => !usados.has(item.dogId));
  let indice = 0;
  return { ordem: ordem.map((_, i) => vagas.get(i + 1) ?? livres[indice++]), conflitos };
}
