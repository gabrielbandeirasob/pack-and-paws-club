import { render } from '@testing-library/react-native';
import { DriverRouteView, type DriverStop } from '@/features/driver/DriverRouteView';
import { NextStopCard, nextActionForStatus, nextStopFor } from '@/features/driver/NextStopCard';
import { RouteMap } from '@/features/maps/RouteMap';
import { agruparEmTarefas } from '@/features/driver/tasks';

jest.mock('@/features/maps/RouteMap', () => ({ RouteMap: jest.fn(() => null) }));

const stops: DriverStop[] = ['Kona', 'Mowgli', 'Luna', 'Filó', 'Lucki'].map((dogName, i) => ({
  id: dogName, dogName, clientName: 'Ana', sequence: i + 1, dropoffSequence: 5 - i,
  status: 'picked_up', address: null, city: null, instructions: null,
}));

function Tela({ paradas, fase }: { paradas: DriverStop[]; fase?: 'pickup' | 'dropoff' }) {
  const next = nextStopFor(paradas);
  return <>
    <NextStopCard stop={next} nextAction={next ? nextActionForStatus(next.status) : null} onNavigate={jest.fn()} onAction={jest.fn()} />
    <DriverRouteView stops={paradas} onAction={jest.fn()} fase={fase} />
  </>;
}

/**
 * A LISTA NÃO TROCA DE ORDEM SOZINHA (cliente, 02/10/2026): *"tem que ter uma mudança clara de rota,
 * de pickup e drop-off. Ele não tem que fazer essa mudança automática."* Antes, ao terminar a última
 * busca, `ordenarParadasDoDia()` reordenava a lista pela perna de entrega sem ninguém pedir. Agora a
 * ordem segue a FASE, e quem vira a fase é o MOTORISTA (botão "Start drop-offs").
 */
it('a lista não troca de ordem sozinha ao terminar a busca; ela segue a fase do motorista', async () => {
  const manha = stops.map((s, i) => ({ ...s, status: i === 0 ? 'pending' as const : s.status }));
  const tela = await render(<Tela paradas={manha} />);
  const conferirOrdem = (nomes: string[]) => {
    expect(tela.getAllByLabelText(/^Open navigation for /).map((n) => n.props.accessibilityLabel)).toEqual(nomes.map((n) => `Open navigation for ${n}`));
    nomes.forEach((nome, i) => expect(tela.getByText(`${i + 1}. ${nome}`)).toBeTruthy());
    const chamadas = jest.mocked(RouteMap).mock.calls;
    expect(chamadas[chamadas.length - 1][0].stops.map((s) => [s.dogName, s.sequence])).toEqual(nomes.map((n, i) => [n, i + 1]));
  };
  conferirOrdem(['Kona', 'Mowgli', 'Luna', 'Filó', 'Lucki']);
  expect(tela.getByLabelText('Next stop: navigate to Kona')).toBeTruthy();

  // Terminou a última busca: a lista CONTINUA na ordem da busca — nada muda sozinho.
  await tela.rerender(<Tela paradas={stops} />);
  conferirOrdem(['Kona', 'Mowgli', 'Luna', 'Filó', 'Lucki']);

  // Só a VIRADA DO MOTORISTA passa a lista para a ordem de ENTREGA.
  await tela.rerender(<Tela paradas={stops} fase="dropoff" />);
  conferirOrdem(['Lucki', 'Filó', 'Luna', 'Mowgli', 'Kona']);
});

it('agrupamento preserva a primeira ocorrência e a ordem recebida dos cães', () => {
  const entrada = [stops[4], stops[2], stops[3], stops[0]].map((s) => ({ ...s, groupId: s.dogName === 'Luna' ? 'outro' : 'casa' }));
  expect(agruparEmTarefas(entrada).map((t) => t.stops.map((s) => s.dogName))).toEqual([['Lucki', 'Filó', 'Kona'], ['Luna']]);
});
