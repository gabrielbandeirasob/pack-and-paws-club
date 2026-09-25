/**
 * VETORES INDEPENDENTES DO AGENTE DE TESTES (agente2) — TAREFA por PARADA, com N cães.
 *
 * Pedido/decidido com o dono (24/09/2026): cliente com dois cães não vira duas tarefas soltas — os dois
 * moram na mesma casa e o motorista para uma vez. Um status por CÃO (cada um com seu comprovante) e o
 * motorista PODE fechar o dia com um cão pendente.
 */
import type { DriverStop } from '@/features/driver/DriverRouteView';
import { agruparEmTarefas, posicoesDasParadas } from '@/features/driver/tasks';

function parada(id: string, dogName: string, extra: Partial<DriverStop> = {}): DriverStop {
  return {
    id,
    sequence: 1,
    status: 'pending',
    clientName: 'Ana',
    dogName,
    address: '1 Rua A',
    city: 'São Francisco',
    instructions: null,
    ...extra,
  };
}

const GRUPO_ANA = 'grupo-ana';

describe('TAREFA = parada do cliente (N cães na mesma casa)', () => {
  it('dois cães do MESMO cliente viram UMA parada com 2 cães (não duas tarefas)', () => {
    const tarefas = agruparEmTarefas([
      parada('s1', 'Kona', { groupId: GRUPO_ANA, sequence: 1 }),
      parada('s2', 'Mowgli', { groupId: GRUPO_ANA, sequence: 2 }),
    ]);

    expect(tarefas).toHaveLength(1);
    expect(tarefas[0].total).toBe(2);
    expect(tarefas[0].compartilhada).toBe(true);
    expect(tarefas[0].clientName).toBe('Ana');
    expect(tarefas[0].stops.map((s) => s.dogName)).toEqual(['Kona', 'Mowgli']);
  });

  it('cães de clientes DIFERENTES continuam em paradas separadas', () => {
    const tarefas = agruparEmTarefas([
      parada('s1', 'Kona', { groupId: GRUPO_ANA, sequence: 1 }),
      parada('s2', 'Bella', { groupId: 'grupo-leigh', sequence: 2, clientName: 'Leigh Ann' }),
    ]);

    expect(tarefas).toHaveLength(2);
    expect(tarefas.every((t) => t.compartilhada === false)).toBe(true);
  });

  it('parada SEM grupo (base antiga) nao e juntada por conta propria', () => {
    const tarefas = agruparEmTarefas([
      parada('s1', 'Kona', { sequence: 1 }),
      parada('s2', 'Mowgli', { sequence: 2 }),
    ]);

    expect(tarefas).toHaveLength(2);
    expect(tarefas.every((t) => t.total === 1)).toBe(true);
  });

  it('o motorista PODE fechar o dia com um cão pendente: a parada fica 1/2 e o pendente segue nela', () => {
    const tarefas = agruparEmTarefas([
      parada('s1', 'Kona', { groupId: GRUPO_ANA, sequence: 1, status: 'completed' }),
      parada('s2', 'Mowgli', { groupId: GRUPO_ANA, sequence: 2, status: 'pending' }),
    ]);

    expect(tarefas[0].done).toBe(1);
    expect(tarefas[0].total).toBe(2);
    // O pendente continua dentro da parada — não "some" do dia por causa do irmão resolvido.
    expect(tarefas[0].stops.map((s) => s.status)).toEqual(['completed', 'pending']);
  });

  it('a ordem da rota manda: grupos pela MENOR sequência e cães na ordem da rota', () => {
    const tarefas = agruparEmTarefas([
      parada('s3', 'Bella', { groupId: 'grupo-b', sequence: 3, clientName: 'Leigh Ann' }),
      parada('s2', 'Mowgli', { groupId: GRUPO_ANA, sequence: 2 }),
      parada('s1', 'Kona', { groupId: GRUPO_ANA, sequence: 1 }),
      parada('s4', 'Zara', { groupId: 'grupo-b', sequence: 4, clientName: 'Leigh Ann' }),
    ]);

    expect(tarefas.map((t) => t.clientName)).toEqual(['Ana', 'Leigh Ann']);
    expect(tarefas[0].stops.map((s) => s.dogName)).toEqual(['Kona', 'Mowgli']);
  });

  it('numeracao: os cães da mesma parada compartilham o numero e o cabecalho sai so no primeiro', () => {
    const tarefas = agruparEmTarefas([
      parada('s1', 'Kona', { groupId: GRUPO_ANA, sequence: 1 }),
      parada('s2', 'Mowgli', { groupId: GRUPO_ANA, sequence: 2 }),
      parada('s3', 'Bella', { groupId: 'grupo-b', sequence: 3, clientName: 'Leigh Ann' }),
    ]);
    const posicoes = posicoesDasParadas(tarefas);

    expect(posicoes.get('s1')).toMatchObject({ numero: 1, totalNaTarefa: 2, primeiraDoGrupo: true, clientName: 'Ana' });
    expect(posicoes.get('s2')).toMatchObject({ numero: 1, totalNaTarefa: 2, primeiraDoGrupo: false });
    // A parada seguinte é a 2, não a 3: o número conta PARADAS, não cães.
    expect(posicoes.get('s3')).toMatchObject({ numero: 2, totalNaTarefa: 1, primeiraDoGrupo: true });
  });

  it('o progresso do cabecalho conta os caes resolvidos da parada (skipped conta como resolvido)', () => {
    const tarefas = agruparEmTarefas([
      parada('s1', 'Kona', { groupId: GRUPO_ANA, sequence: 1, status: 'completed' }),
      parada('s2', 'Mowgli', { groupId: GRUPO_ANA, sequence: 2, status: 'skipped' }),
      parada('s3', 'Bella', { groupId: GRUPO_ANA, sequence: 3, status: 'picked_up' }),
    ]);
    const posicoes = posicoesDasParadas(tarefas);

    expect(tarefas[0].done).toBe(2);
    expect(posicoes.get('s3')?.resolvidos).toBe(2);
    expect(posicoes.get('s3')?.totalNaTarefa).toBe(3);
  });
});
