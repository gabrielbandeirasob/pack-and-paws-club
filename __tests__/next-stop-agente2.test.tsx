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
 * Os testes são escritos para o REQUISITO (e não para a implementação): o painel mostra a parada de
 * menor `sequence` ainda não resolvida, as ações existem com rótulo acessível, e cada toque cai no
 * callback que a tela passa (o MESMO `act` da lista) com a ação certa.
 */
import { fireEvent, render } from '@testing-library/react-native';

import {
  NEXT_ACTION_LABEL,
  NextStopCard,
  nextActionForStatus,
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
async function painel(stop: DriverStop | null) {
  const onNavigate = jest.fn();
  const onAction = jest.fn();
  const tela = await render(
    <NextStopCard
      stop={stop}
      nextAction={stop ? nextActionForStatus(stop.status) : null}
      onNavigate={onNavigate}
      onAction={onAction}
    />,
  );
  return { tela, onNavigate, onAction };
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

  it('devolve null quando não há nada pendente', () => {
    expect(nextStopFor([parada({ status: 'completed' })])).toBeNull();
    expect(nextStopFor([])).toBeNull();
  });
});

describe('mapa de ações do dia (mesmo caminho da lista)', () => {
  it('encadeia pending -> arrived -> picked_up -> completed', () => {
    expect(nextActionForStatus('pending')).toBe('arrived');
    expect(nextActionForStatus('arrived')).toBe('picked_up');
    expect(nextActionForStatus('picked_up')).toBe('completed');
    expect(nextActionForStatus('completed')).toBeNull();
    expect(nextActionForStatus('skipped')).toBeNull();
  });
});

describe('NextStopCard', () => {
  it('mostra o próximo cão com cliente, endereço e ETA', async () => {
    const { tela } = await painel(parada({ etaMinutes: 12, lateMinutes: 0 }));
    expect(tela.getByText('NEXT STOP')).toBeTruthy();
    expect(tela.getByText('Maria · Bob')).toBeTruthy();
    expect(tela.getByText('123 Main St · San Francisco')).toBeTruthy();
    expect(tela.getByText('~12 min away')).toBeTruthy();
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

  it('parada arrived mostra "Dog picked up" (a ação que marca a coleta)', async () => {
    const { tela, onAction } = await painel(parada({ status: 'arrived' }));
    expect(tela.getByText('Dog picked up')).toBeTruthy();

    await fireEvent.press(tela.getByLabelText('Next stop: Dog picked up for Bob'));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'picked_up');
  });

  it('parada picked_up mostra "Complete" (a ação que marca a entrega)', async () => {
    const { tela, onAction } = await painel(parada({ status: 'picked_up' }));
    expect(tela.getByText('Complete')).toBeTruthy();

    await fireEvent.press(tela.getByLabelText('Next stop: Complete for Bob'));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'completed');
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
    expect(botoes).toHaveLength(2); // navegar + o próximo passo do dia (a foto saiu)
    for (const botao of botoes) {
      expect(typeof botao.props.accessibilityLabel).toBe('string');
      expect(botao.props.accessibilityLabel.length).toBeGreaterThan(0);
    }
  });

  it('os rótulos das ações vêm do mesmo mapa visível da lista', () => {
    expect(NEXT_ACTION_LABEL).toEqual({ arrived: 'I arrived', picked_up: 'Dog picked up', completed: 'Complete' });
  });
});
