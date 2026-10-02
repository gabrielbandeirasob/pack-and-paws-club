import type { OrganizationLocation } from '@/features/organization/locations';

/**
 * ONDE A ROTA FECHA — pedido do CLIENTE (print de 02/10/2026, encaminhado pelo dono):
 *
 *   *"Outra coisa as rota de pick up não tão acabando no yard. E as de drop off não tão acabando no
 *   local da van. Tem como adicionar isso automaticamente?"*
 *
 * O dia tem dois fechamentos, nesta ordem:
 *  1. depois da última BUSCA, o dia vai para o **YARD** (é onde os cães passam o dia) — o fim da rota
 *     de pick-up;
 *  2. depois da última ENTREGA, o dia volta para onde a **VAN** está (o ponto de partida) — o fim da
 *     rota de drop-off.
 *
 * Sem yard cadastrado, o fechamento da busca cai na van: o motorista nunca fica sem saber para onde
 * voltar. Sem nada cadastrado, não há fechamento (não se inventa destino).
 */
export type FechamentoDaRota = {
  kind: 'yard' | 'van';
  /** `Back to the yard` / `Back to the van` */
  title: string;
  /** Uma linha que diz POR QUE ele está indo (o que acontece lá). */
  subtitle: string;
  address: string | null;
  /**
   * COORDENADAS do destino — para o motorista NAVEGAR até ele (cliente, 02/10/2026: *"o aplicativo
   * apenas informa que termina no yard, mas na realidade não mudou nada"*). Sem coordenadas, o cartão
   * continua informativo (nunca inventa destino).
   */
  latitude: number | null;
  longitude: number | null;
};

/** Ainda tem cão para buscar? (pending = não cheguei, arrived = cheguei e não peguei) */
export function buscaTerminou(stops: { status: string }[]): boolean {
  return stops.length > 0 && stops.every((stop) => stop.status !== 'pending' && stop.status !== 'arrived');
}

/** Já entregou (ou pulou) todos os cães do dia? */
export function entregaTerminou(stops: { status: string; deliveredAt?: string | null }[]): boolean {
  if (stops.length === 0) return false;
  return stops.every((stop) => stop.status === 'skipped' || Boolean(stop.deliveredAt));
}

function enderecoDaLoja(local: OrganizationLocation | null): string | null {
  if (!local) return null;
  const partes = [local.addressLine1, local.city].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : null;
}

export function fechamentoDaRota(params: {
  buscaTerminou: boolean;
  entregaTerminou: boolean;
  yard: OrganizationLocation | null;
  van: OrganizationLocation | null;
}): FechamentoDaRota | null {
  const { buscaTerminou: busca, entregaTerminou: entrega, yard, van } = params;

  if (entrega) {
    // Fim do dia: volta para a van (é onde ela fica). Sem van cadastrada, o yard serve de ponto final.
    const destino = van ?? yard;
    if (!destino) return null;
    return {
      kind: destino.kind === 'yard' ? 'yard' : 'van',
      title: destino.kind === 'yard' ? 'Back to the yard' : 'Back to the van',
      subtitle: 'All dogs delivered — the day ends here.',
      address: enderecoDaLoja(destino),
      latitude: destino.latitude,
      longitude: destino.longitude,
    };
  }

  if (!busca) return null;

  // Terminou de buscar e ainda não entregou: o dia vai para o YARD (onde os cães ficam).
  const destino = yard ?? van;
  if (!destino) return null;
  return {
    kind: destino.kind === 'yard' ? 'yard' : 'van',
    title: destino.kind === 'yard' ? 'Back to the yard' : 'Back to the van',
    subtitle: destino.kind === 'yard'
      ? 'All dogs on board — drop them at the yard.'
      : 'All dogs on board — the pick-up run ends here.',
    address: enderecoDaLoja(destino),
    latitude: destino.latitude,
    longitude: destino.longitude,
  };
}
