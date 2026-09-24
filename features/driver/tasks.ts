import type { DriverStop } from '@/features/driver/DriverRouteView';

/**
 * Uma TAREFA do dia: a parada do motorista, que pode ter MAIS DE UM CÃO (mesmo cliente, mesmo endereço).
 *
 * Pedido do dono (24/09/2026): cliente com dois cães não pode virar duas tarefas soltas — os dois moram
 * na mesma casa e o motorista para uma vez. Decisão dele: **um status por CÃO** dentro da mesma parada
 * (dois botões de "picked up", dois comprovantes) e o motorista **pode fechar o dia com um cão pendente**
 * (o pendente fica marcado dentro do grupo).
 */
export type DriverTask = {
  /** `route_stops.stop_group_id`; parada sem grupo (rota antiga/migração pendente) vira tarefa dela. */
  id: string;
  clientName: string;
  /** Cães desta parada, na ordem da rota. */
  stops: DriverStop[];
  /** Quantos cães já foram resolvidos (completed/skipped) e o total — é o "1/2 done" da tela. */
  done: number;
  total: number;
  /** true quando a parada tem mais de um cão: é o caso "1 parada, 2 cães". */
  compartilhada: boolean;
};

/** Status que contam como resolvidos. `skipped` conta: o motorista marcou que não deu (não fica pendente). */
function resolvido(status: DriverStop['status']): boolean {
  return status === 'completed' || status === 'skipped';
}

/**
 * Agrupa as paradas do dia em TAREFAS por `stop_group_id` (mesmo cliente na mesma rota = mesma parada).
 *
 * Regras: a ordem das tarefas é a da rota (o menor `sequence` do grupo manda) e, dentro do grupo, os cães
 * seguem a ordem da rota. Parada sem `groupId` (base antiga, antes da migration 029) fica sozinha: o app
 * nunca junta dois cães por conta própria.
 */
export function agruparEmTarefas(stops: DriverStop[]): DriverTask[] {
  const ordenadas = [...stops].sort((a, b) => a.sequence - b.sequence);
  const grupos = new Map<string, DriverStop[]>();

  for (const stop of ordenadas) {
    const chave = stop.groupId && stop.groupId.length > 0 ? stop.groupId : `parada:${stop.id}`;
    const atual = grupos.get(chave);
    if (atual) atual.push(stop);
    else grupos.set(chave, [stop]);
  }

  return [...grupos.entries()].map(([id, doGrupo]) => ({
    id,
    clientName: doGrupo[0]?.clientName ?? 'Client',
    stops: doGrupo,
    done: doGrupo.filter((stop) => resolvido(stop.status)).length,
    total: doGrupo.length,
    compartilhada: doGrupo.length > 1,
  }));
}

/** Posição de cada cão na tela: número da PARADA (tarefa), não da linha. */
export type PosicaoDaParada = {
  /** 1, 2, 3... — o número que o motorista vê. Cães da mesma parada compartilham o número. */
  numero: number;
  totalNaTarefa: number;
  /** true só no primeiro cão do grupo: é onde entra o cabeçalho "Stop N · Cliente · 2 dogs". */
  primeiraDoGrupo: boolean;
  /** Nome do cliente da parada (o cabeçalho mostra uma vez; os cães mostram o nome deles). */
  clientName: string;
  /** Quantos cães já foram resolvidos nesta parada. */
  resolvidos: number;
};

/** Mapa parada-do-cão -> posição na tela, para a tela numerar e desenhar o cabeçalho do grupo. */
export function posicoesDasParadas(tarefas: DriverTask[]): Map<string, PosicaoDaParada> {
  const posicoes = new Map<string, PosicaoDaParada>();
  tarefas.forEach((tarefa, indice) => {
    tarefa.stops.forEach((stop, posicao) => {
      posicoes.set(stop.id, {
        numero: indice + 1,
        totalNaTarefa: tarefa.total,
        primeiraDoGrupo: posicao === 0,
        clientName: tarefa.clientName,
        resolvidos: tarefa.done,
      });
    });
  });
  return posicoes;
}
