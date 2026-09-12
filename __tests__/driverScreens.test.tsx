/**
 * Telas do motorista (Schedule e Assigned). Duas frentes:
 *  1) as funcoes puras (rotulo, agrupamento, ordem) — o que o motorista le na tela;
 *  2) a renderizacao de verdade, com o banco mockado.
 */
import { render } from '@testing-library/react-native';

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => mockGetUser(...a) }, from: (...a: unknown[]) => mockFrom(...a) },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
    useRouter: () => ({ push: mockPush }),
  };
});

import DriverAssignedScreen from '@/app/(tabs)/assigned';
import DriverScheduleScreen from '@/app/(tabs)/schedule';
import { formatDayLabel } from '@/features/calendar/dates';
import {
  groupRoutesByPeriod,
  routeStatusLabel,
  sortStopsBySequence,
  stopLabel,
  stopStatusLabel,
} from '@/features/driver/routeLabels';

/** Banco falso: devolve o resultado em qualquer ordem de chamadas da cadeia. */
function banco(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const mesma = () => builder;
  builder.select = mesma;
  builder.eq = mesma;
  builder.order = mesma;
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resultado).then(resolve);
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'motorista-1' } } });
});

describe('rotulos e ordem (funcoes puras)', () => {
  it('traduz o status da rota', () => {
    expect(routeStatusLabel('published')).toBe('Published');
    expect(routeStatusLabel('draft')).toBe('Draft');
    expect(routeStatusLabel('cancelled')).toBe('Cancelled');
    expect(routeStatusLabel('completed')).toBe('Completed');
    expect(routeStatusLabel('coisa-nova')).toBe('coisa-nova');
  });

  it('traduz o status da parada', () => {
    expect(stopStatusLabel('pending')).toBe('Pending');
    expect(stopStatusLabel('picked_up')).toBe('Picked up');
    expect(stopStatusLabel('completed')).toBe('Done');
    expect(stopStatusLabel('skipped')).toBe('Skipped');
  });

  it('separa hoje, proximas e anteriores (com a ordem que o motorista espera)', () => {
    const rotas = [
      { route_date: '2026-09-20' },
      { route_date: '2026-09-11' },
      { route_date: '2026-09-05' },
      { route_date: '2026-09-12' },
    ];
    const grupos = groupRoutesByPeriod(rotas, '2026-09-11');
    expect(grupos.today.map((r) => r.route_date)).toEqual(['2026-09-11']);
    expect(grupos.upcoming.map((r) => r.route_date)).toEqual(['2026-09-12', '2026-09-20']);
    expect(grupos.past.map((r) => r.route_date)).toEqual(['2026-09-05']);
  });

  it('ordena as paradas pela sequencia, nao pela ordem do banco', () => {
    const paradas = [{ sequence: 3, nome: 'c' }, { sequence: 1, nome: 'a' }, { sequence: 2, nome: 'b' }];
    expect(sortStopsBySequence(paradas).map((p) => p.nome)).toEqual(['a', 'b', 'c']);
    expect(sortStopsBySequence([{ sequence: null, nome: 'x' }, { sequence: 2, nome: 'y' }]).map((p) => p.nome)).toEqual(['x', 'y']);
  });

  it('monta o nome da parada com fallback', () => {
    expect(stopLabel('Maria', 'Mowgli')).toBe('Maria · Mowgli');
    expect(stopLabel(null, '  ')).toBe('Client · Dog');
  });
});

describe('tela Schedule', () => {
  it('agrupa as rotas em Today, Upcoming e Past com a data legivel', async () => {
    const hoje = require('@/features/calendar/dates').todayLocalISO();
    mockFrom.mockReturnValue(
      banco({
        data: [
          { id: 'r1', route_date: hoje, status: 'published', route_stops: [{ id: 's1' }, { id: 's2' }] },
          { id: 'r2', route_date: '2026-09-30', status: 'draft', route_stops: [{ id: 's3' }] },
          { id: 'r3', route_date: '2026-01-02', status: 'completed', route_stops: [{ id: 's4' }] },
        ],
      }),
    );

    const tela = await render(<DriverScheduleScreen />);

    expect(await tela.findByText('Today')).toBeTruthy();
    expect(tela.getByText('Upcoming')).toBeTruthy();
    expect(tela.getByText('Past')).toBeTruthy();
    expect(tela.getByText(formatDayLabel(hoje))).toBeTruthy();
    expect(tela.getByText('2 stops')).toBeTruthy();
    // concordancia: "1 stop" (e nao "1 stops") nas duas rotas de uma parada so
    expect(tela.getAllByText('1 stop')).toHaveLength(2);
    expect(tela.getByText('Published')).toBeTruthy();
    expect(tela.getByText('3 routes · 1 published')).toBeTruthy();
  });

  it('avisa quando nao ha rota publicada', async () => {
    mockFrom.mockReturnValue(banco({ data: [] }));
    const tela = await render(<DriverScheduleScreen />);
    expect(await tela.findByText('No routes published to you yet.')).toBeTruthy();
  });
});

describe('tela Assigned', () => {
  it('mostra as paradas na ordem da rota, com endereco, status e contagem', async () => {
    mockFrom.mockReturnValue(
      banco({
        data: [
          {
            route_stops: [
              { id: 's2', sequence: 2, status: 'pending', dog: { name: 'Kona', client: { name: 'Leigh Ann', address_line_1: '77 Oak Ave', city: 'Daly City' } } },
              { id: 's1', sequence: 1, status: 'completed', dog: { name: 'Mowgli', client: { name: 'Maria', address_line_1: '123 Main St', city: 'San Francisco' } } },
            ],
          },
        ],
      }),
    );

    const tela = await render(<DriverAssignedScreen />);

    expect(await tela.findByText('1. Maria · Mowgli')).toBeTruthy();
    expect(tela.getByText('2. Leigh Ann · Kona')).toBeTruthy();
    expect(tela.getByText('123 Main St · San Francisco')).toBeTruthy();
    expect(tela.getByText('Done')).toBeTruthy();
    expect(tela.getByText('Pending')).toBeTruthy();
    expect(tela.getByText('2 dogs · 1 done')).toBeTruthy();
  });

  it('avisa quando nao ha cao atribuido hoje', async () => {
    mockFrom.mockReturnValue(banco({ data: [] }));
    const tela = await render(<DriverAssignedScreen />);
    expect(await tela.findByText('No dogs assigned to you today.')).toBeTruthy();
  });
});
