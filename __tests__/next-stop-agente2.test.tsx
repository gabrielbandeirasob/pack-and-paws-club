/**
 * Painel NEXT STOP (herói do topo da tela do motorista) — pedido do dono em 25/09/2026:
 * "depois de otimizada a rota tenha um lugar mostrando o próximo cachorro e o botão pra dar a
 * localização... botão pra informar que cheguei... e tirar foto do cachorro".
 *
 * ATUALIZAÇÃO DE ESPECIFICAÇÃO (26/09/2026). O dono mandou tirar o passo da foto do app do
 * motorista: "pelas imagens vi que ainda não removeu a necessidade de tirar fotos quando pegar e
 * deixar os cachorros" → o painel ficou com DUAS ações (navegar e o próximo passo do dia) e o
 * comprovante saiu do fluxo. Os testes abaixo foram ajustados para o contrato novo, com um caso
 * explícito que trava a REGRESSÃO (nenhum botão de foto volta sem pedido).
 *
 * SEGUNDA ATUALIZAÇÃO (30/09/2026 — fluxo de 2 toques). O dono pediu "tem que ser, tipo assim,
 * I arrived e next. Talvez dois cliques": o 2º toque virou a ação 'finish', que grava `picked_up` E
 * `completed` no mesmo instante (os 3 registros de auditoria continuam no banco, com o carimbo do
 * servidor). Os rótulos esperados aqui são os do fluxo novo.
 *
 * Os testes são escritos para o REQUISITO (e não para a implementação): o painel mostra a parada de
 * menor `sequence` ainda não resolvida, as ações existem com rótulo acessível, e cada toque cai no
 * callback que a tela passa (o MESMO `act` da lista) com a ação certa.
 */
import { fireEvent, render } from '@testing-library/react-native';

import {
  NEXT_ACTION_LABEL,
  NextStopCard,
  nextActionForStatus,
  nextActionsForStatus,
  nextStopFor,
} from '@/features/driver/NextStopCard';
import type { DriverStop } from '@/features/driver/DriverRouteView';

function parada(over: Partial<DriverStop> = {}): DriverStop {
  return {
    id: 'stop-1',
    sequence: 1,
    status: 'pending',
    clientName: 'Maria',
    dogName: 'Bob',
    address: '123 Main St',
    city: 'San Francisco',
    instructions: null,
    ...over,
  };
}

/** Props obrigatórias do painel (callbacks espiões). O `render` desta versão é assíncrono. */
async function painel(stop: DriverStop | null, comAviso = false) {
  const onNavigate = jest.fn();
  const onAction = jest.fn();
  const onNotifyOwner = jest.fn();
  const tela = await render(
    <NextStopCard
      stop={stop}
      nextAction={stop ? nextActionForStatus(stop.status, stop.deliveredAt) : null}
      onNavigate={onNavigate}
      onAction={onAction}
      onNotifyOwner={comAviso ? onNotifyOwner : undefined}
    />,
  );
  return { tela, onNavigate, onAction, onNotifyOwner };
}

describe('nextStopFor (parada escolhida)', () => {
  it('escolhe a de menor sequence que ainda não foi resolvida', () => {
    const escolhida = nextStopFor([
      parada({ id: 's3', sequence: 3, dogName: 'Kona' }),
      parada({ id: 's1', sequence: 1, dogName: 'Bob', status: 'completed' }),
      parada({ id: 's2', sequence: 2, dogName: 'Luna' }),
    ]);
    expect(escolhida?.id).toBe('s2');
  });

  it('não volta para uma parada marcada como problema (skipped): ela já saiu da fila', () => {
    // 'skipped' é o que o botão Problem grava; a rota segue para a próxima casa.
    expect(nextStopFor([parada({ status: 'skipped' }), parada({ id: 's2', sequence: 2 })])?.id).toBe('s2');
    expect(nextStopFor([parada({ status: 'skipped' })])).toBeNull();
  });

  it('devolve null quando não há nada pendente (nem entrega)', () => {
    // `completed` sem entrega ainda é a PRÓXIMA parada do dia (o cão está na van) — ver itens 2 e 5 da
    // conferência do dono, 01/10/2026.
    expect(nextStopFor([parada({ status: 'completed' })])?.id).toBe('stop-1');
    expect(nextStopFor([parada({ status: 'completed', deliveredAt: '2026-10-01T21:00:00.000Z' })])).toBeNull();
    expect(nextStopFor([])).toBeNull();
  });
});

describe('mapa de ações do dia (mesmo caminho da lista)', () => {
  it('encadeia pending -> arrived -> finish: dois toques fecham a parada', () => {
    expect(nextActionForStatus('pending')).toBe('arrived');
    expect(nextActionForStatus('arrived')).toBe('finish');
    // Parada que já estava em picked_up (rota antiga ou 2º toque interrompido) fecha no MESMO botão.
    expect(nextActionForStatus('picked_up')).toBe('finish');
    // Depois do pick-up falta ENTREGAR: o toque da tarde é o `deliver` (01/10/2026).
    expect(nextActionForStatus('completed')).toBe('deliver');
    // Entregue (ou problema): aí sim nada mais a fazer.
    expect(nextActionForStatus('completed', '2026-10-01T21:00:00.000Z')).toBeNull();
    expect(nextActionForStatus('skipped')).toBeNull();
  });
});

/**
 * 🪤 VISTORIA (02/10/2026) — SAÍDAS DO DIA.
 *
 * Na BUSCA é uma saída por toque. Na ENTREGA (`deliver`) são DUAS: confirmar (Delivered) OU
 * reportar problema (o tutor não estava em casa). Antes da correção a entrega só oferecia
 * "Delivered" — um beco sem saída que deixava o dia sem fechar.
 */
describe('saídas do dia (Problem disponível na entrega)', () => {
  it('na entrega expõe Delivered E Problem; nas outras fases, só a principal', () => {
    expect(nextActionsForStatus('pending')).toEqual(['arrived']);
    expect(nextActionsForStatus('arrived')).toEqual(['finish']);
    expect(nextActionsForStatus('picked_up')).toEqual(['finish', 'problem']);
    expect(nextActionsForStatus('completed')).toEqual(['deliver', 'problem']);
    // Entregue: o dia dela acabou — nenhuma saída.
    expect(nextActionsForStatus('completed', '2026-10-01T21:00:00.000Z')).toEqual([]);
    expect(nextActionsForStatus('skipped')).toEqual([]);
  });

  it('o cartão da próxima parada mostra as DUAS saídas da entrega', async () => {
    const { tela, onAction } = await painel(parada({ status: 'completed' }));
    expect(tela.getByLabelText('Next stop: Delivered for Bob')).toBeTruthy();
    await fireEvent.press(tela.getByLabelText('Next stop: Problem for Bob'));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'problem');
  });
});

describe('NextStopCard', () => {
  it('mostra o próximo cão com endereço e ETA', async () => {
    const { tela } = await painel(parada({ etaMinutes: 12, lateMinutes: 0 }));
    expect(tela.getByText('NEXT STOP')).toBeTruthy();
    expect(tela.getByText('Bob')).toBeTruthy();
    expect(tela.getByText('123 Main St · San Francisco')).toBeTruthy();
    expect(tela.getByText('~12 min away')).toBeTruthy();
  });

  /**
   * AVISAR O TUTOR NO CARTÃO GRANDE (o dono procurou aqui e não achou, 01/10/2026: *"n vi essa opçao"*).
   * Antes o botão existia só na lista, mais abaixo na tela.
   */
  it('o cartão da próxima parada tem o aviso ao tutor e ele chama o mesmo caminho da lista', async () => {
    const { tela, onNotifyOwner } = await painel(parada({ dogName: 'Bob', clientPhone: '+1 (415) 601-1820' }), true);
    fireEvent.press(tela.getByLabelText('Next stop: notify owner Bob'));
    expect(onNotifyOwner).toHaveBeenCalledTimes(1);
    expect(onNotifyOwner.mock.calls[0][0].dogName).toBe('Bob');
  });

  it('cliente sem telefone: o botão aparece apagado COM o motivo (não some calado)', async () => {
    const { tela } = await painel(parada({ dogName: 'Bob', clientPhone: null, clientPhone2: null }), true);
    const botao = tela.getByLabelText('Next stop: notify owner Bob');
    expect(botao.props.accessibilityState).toMatchObject({ disabled: true });
    expect(tela.getByText(/No phone number on this client/)).toBeTruthy();
  });

  it('parada já entregue não oferece aviso de novo', async () => {
    const { tela } = await painel(
      parada({ dogName: 'Bob', clientPhone: '+1 (415) 601-1820', deliveredAt: '2026-10-01T21:00:00.000Z' }),
      true,
    );
    expect(tela.getByLabelText('Next stop: notify owner Bob').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('sem a prop, o cartão fica como era (nada de botão órfão)', async () => {
    const { tela } = await painel(parada({ dogName: 'Bob', clientPhone: '+1 (415) 601-1820' }));
    expect(tela.queryByLabelText('Next stop: notify owner Bob')).toBeNull();
  });

  it('marca o atraso quando o ETA passa da janela', async () => {
    const { tela } = await painel(parada({ etaMinutes: 20, lateMinutes: 10 }));
    expect(tela.getByText('~20 min away · 10 min late')).toBeTruthy();
  });

  it('navegar e "I arrived" chamam os handlers da tela com a parada certa', async () => {
    const { tela, onNavigate, onAction } = await painel(parada());

    await fireEvent.press(tela.getByLabelText('Next stop: navigate to Bob'));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'stop-1' }));

    await fireEvent.press(tela.getByLabelText('Next stop: I arrived for Bob'));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'arrived');
  });

  it('parada arrived mostra "Next": o 2º toque grava pegou + concluiu juntos', async () => {
    const { tela, onAction } = await painel(parada({ status: 'arrived' }));
    expect(tela.getByText('Complete pickup')).toBeTruthy();

    await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'finish');
  });

  it('parada picked_up (rota antiga) mostra o MESMO "Next" para fechar', async () => {
    const { tela, onAction } = await painel(parada({ status: 'picked_up' }));
    expect(tela.getByText('Complete pickup')).toBeTruthy();

    await fireEvent.press(tela.getByLabelText('Next stop: Next for Bob'));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'finish');
  });

  it('REGRESSÃO: nenhum botão de foto no painel (o comprovante saiu do app em 26/09/2026)', async () => {
    for (const status of ['pending', 'arrived', 'picked_up'] as const) {
      const { tela } = await painel(parada({ status }));
      const rotulos = tela.getAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
      expect(rotulos.some((r) => /photo|foto|proof/i.test(r))).toBe(false);
      expect(tela.queryByText('Photo')).toBeNull();
    }
  });

  it('rota terminada: avisa e NÃO oferece botão nenhum', async () => {
    const { tela, onNavigate, onAction } = await painel(null);
    expect(tela.getByText('Route finished')).toBeTruthy();
    expect(tela.queryByLabelText('Next stop: navigate to Bob')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('todo botão tem papel e rótulo acessível (a varredura de acessibilidade depende disso)', async () => {
    const { tela } = await painel(parada({ status: 'arrived' }));
    const botoes = tela.getAllByRole('button');
    expect(botoes).toHaveLength(3); // concluir + navegar + reportar problema (a foto saiu)
    for (const botao of botoes) {
      expect(typeof botao.props.accessibilityLabel).toBe('string');
      expect(botao.props.accessibilityLabel.length).toBeGreaterThan(0);
    }
  });

  it('os rótulos das ações vêm do mesmo mapa visível da lista', () => {
    expect(NEXT_ACTION_LABEL).toEqual({ arrived: 'I arrived', finish: 'Next', deliver: 'Delivered' });
  });
});
