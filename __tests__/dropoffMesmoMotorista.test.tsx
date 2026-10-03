/**
 * TRAVA DO DONO (03/10/2026) — *"não faz sentido eu colocar o pick-up de um cachorro com um motorista e
 * depois o drop-off com outro"*: o cão desce com quem o buscou, SEM exceção.
 *
 * Vetores:
 *  1. o mapa cão -> motorista do pick-up só olha a perna de pick-up (rota sem `phase` é pick-up);
 *  2. o cão preso nasce no bloco do motorista dele, mesmo com outro carro mais perto/vazio;
 *  3. irmão de casa sem motorista próprio acompanha o irmão preso;
 *  4. motorista do pick-up INDISPONÍVEL na entrega: o cão vai para revisão e NUNCA para outro motorista;
 *  5. cão sem coordenada não some (vai para o fim do bloco);
 *  6. cão sem motorista no pick-up continua sendo rateado por número de cães;
 *  7. sem a prop `pickupDriverByDog`, o quadro é o de antes (o app antigo não muda);
 *  8. com a prop, "Create drop-off route" só aparece para quem buscou algum cão;
 *  9. na folha de entrega o outro motorista nem é listado — o cão já vem com o dono selecionado.
 */
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), storage: { from: jest.fn(() => ({ createSignedUrl: jest.fn() })) } },
}));

import { fireEvent, render } from '@testing-library/react-native';
import { DispatchBoard, type DispatchDriver, type DispatchRoute } from '@/features/dispatch/DispatchBoard';
import { motoristaDoPickupPorCao, sugerirEntregas, sugerirRotasPorFase } from '@/features/dispatch/routeSuggestion';

const cao = (dogId: string, clientId: string | null, latitude: number | null = null, longitude: number | null = null) => ({
  dogId, clientId, clientName: `${clientId ?? dogId}-casa`, dogName: dogId, latitude, longitude,
});

describe('regra do motorista da entrega — camada pura', () => {
  it('o mapa sai só da perna de pick-up (rota sem phase é pick-up)', () => {
    const mapa = motoristaDoPickupPorCao([
      { driverId: 'rafa', stops: [{ dogId: 'billy' }] },
      { driverId: 'rafa', phase: null, stops: [{ dogId: 'nina' }] },
      { driverId: 'jose', phase: 'pickup', stops: [{ dogId: 'ruby' }] },
      { driverId: 'jose', phase: 'dropoff', stops: [{ dogId: 'nao-conta' }] },
    ]);
    expect([...mapa.entries()].sort()).toEqual([['billy', 'rafa'], ['nina', 'rafa'], ['ruby', 'jose']]);
  });

  it('o cão preso nasce no bloco de quem o buscou (não no carro mais perto)', () => {
    const sugerido = sugerirEntregas(
      [cao('billy', 'amy', 37.10, -122.10), cao('nina', 'lea', 39.10, -124.10)],
      [{ driverId: 'rafa' , driverName: 'Rafael' }, { driverId: 'jose', driverName: 'Jose' }],
      { latitude: 37.10, longitude: -122.10 },
      new Map([['billy', 'jose']]),
    );
    expect(sugerido.blocos.find(b => b.driverId === 'jose')!.caes.map(c => c.dogId)).toEqual(['billy']);
    expect(sugerido.blocos.find(b => b.driverId === 'rafa')!.caes.map(c => c.dogId)).toEqual(['nina']);
    expect(sugerido.semLugar).toEqual([]);
  });

  it('irmão de casa sem motorista próprio acompanha o irmão preso', () => {
    const sugerido = sugerirEntregas(
      [cao('billy', 'amy', 37.1, -122.1), cao('oli', 'amy', 37.1, -122.1)],
      [{ driverId: 'rafa', driverName: 'Rafael' }, { driverId: 'jose', driverName: 'Jose' }],
      null,
      new Map([['billy', 'jose']]),
    );
    expect(sugerido.blocos.find(b => b.driverId === 'jose')!.caes.map(c => c.dogId).sort()).toEqual(['billy', 'oli']);
    expect(sugerido.blocos.some(b => b.driverId === 'rafa')).toBe(false);
  });

  it('motorista do pick-up indisponível: o cão vai para revisão e nunca para outro', () => {
    const sugerido = sugerirEntregas(
      [cao('billy', 'amy', 37.1, -122.1)],
      [{ driverId: 'rafa', driverName: 'Rafael' }],
      null,
      new Map([['billy', 'folga']]),
    );
    expect(sugerido.blocos).toEqual([]);
    expect(sugerido.semLugar.map(c => c.dogId)).toEqual(['billy']);
  });

  it('cão sem coordenada não some: fica no fim do bloco', () => {
    const sugerido = sugerirEntregas(
      [cao('billy', 'amy', 37.1, -122.1), cao('nina', 'lea', null, null)],
      [{ driverId: 'rafa', driverName: 'Rafael' }],
      { latitude: 37.0, longitude: -122.0 },
      new Map([['billy', 'rafa'], ['nina', 'rafa']]),
    );
    expect(sugerido.blocos[0].caes.map(c => c.dogId)).toEqual(['billy', 'nina']);
  });

  it('cão sem motorista no pick-up continua rateado por número de cães', () => {
    const sugerido = sugerirEntregas(
      [cao('billy', 'amy', 37.1, -122.1), cao('nina', 'lea', 37.2, -122.2), cao('ruby', 'katia', 37.3, -122.3)],
      [{ driverId: 'rafa', driverName: 'Rafael' }, { driverId: 'jose', driverName: 'Jose' }],
      null,
      new Map([['billy', 'jose']]),
    );
    // Billy é do Jose (trava). Os dois órfãos são rateados: a carga fica 2 e 1, nunca 3 e 0.
    const porMotorista = new Map(sugerido.blocos.map(b => [b.driverId, b.caes.length]));
    expect([...porMotorista.values()].sort()).toEqual([1, 2]);
    expect(sugerido.blocos.find(b => b.driverId === 'jose')!.caes.map(c => c.dogId)).toEqual(['billy']);
  });

  it('a sugestão por perna usa a trava só no drop-off (o pick-up não muda)', () => {
    const dia = sugerirRotasPorFase(
      [
        { ...cao('billy', 'amy', 37.1, -122.1), pickupRequired: true, dropoffRequired: true },
        { ...cao('nina', 'lea', 37.3, -122.3), pickupRequired: false, dropoffRequired: true },
      ],
      [{ driverId: 'rafa', driverName: 'Rafael' }, { driverId: 'jose', driverName: 'Jose' }],
      [],
      {},
      new Map([['billy', 'jose']]),
    );
    expect(dia.dropoff.blocos.find(b => b.driverId === 'jose')!.caes.map(c => c.dogId)).toEqual(['billy']);
    expect(dia.dropoff.blocos.find(b => b.driverId === 'rafa')!.caes.map(c => c.dogId)).toEqual(['nina']);
    expect(dia.pickup.blocos.flatMap(b => b.caes.map(c => c.dogId))).toEqual(['billy']);
  });
});

const drivers: DispatchDriver[] = [
  { id: 'driver-rafael', name: 'Rafael' },
  { id: 'driver-jordan', name: 'Jordan' },
  { id: 'driver-sam', name: 'Sam' },
];

const parada = (dogId: string, clientName: string, dogName: string) => ({
  dogId, clientName, dogName, sequence: 1, status: 'pending' as const,
  latitude: 37.8, longitude: -122.4, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const,
});

const routes: DispatchRoute[] = [
  { routeId: 'r-rafael-pickup', driverId: 'driver-rafael', status: 'published', stops: [parada('d-billy', 'Amy', 'Billy')] },
  { routeId: 'r-jordan-pickup', driverId: 'driver-jordan', status: 'published', stops: [parada('d-ruby', 'Katia', 'Ruby')] },
];

const Billy = { dogId: 'd-billy', clientName: 'Amy', dogName: 'Billy', reservationKind: 'daycare' };
const Ruby = { dogId: 'd-ruby', clientName: 'Katia', dogName: 'Ruby', reservationKind: 'daycare' };

const noops = {
  onAssign: jest.fn().mockResolvedValue(undefined),
  onSaveStop: jest.fn().mockResolvedValue(undefined),
  onRemoveStop: jest.fn().mockResolvedValue(undefined),
  onMoveStop: jest.fn().mockResolvedValue(undefined),
  onOptimize: jest.fn().mockResolvedValue(undefined),
  onPublish: jest.fn().mockResolvedValue(undefined),
  onUnpublish: jest.fn().mockResolvedValue(undefined),
  onCancelRoute: jest.fn().mockResolvedValue(undefined),
  onCompleteRoute: jest.fn().mockResolvedValue(undefined),
  onDateChange: jest.fn(),
};

const mapa = new Map([['d-billy', 'driver-rafael'], ['d-ruby', 'driver-jordan']]);

describe('Dispatch — a trava do motorista na tela', () => {
  it('"Create drop-off route" só aparece para quem buscou algum cão', async () => {
    const onCreateDropoffRoute = jest.fn().mockResolvedValue(undefined);
    const tela = await render(
      <DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} dropoffItems={[Billy, Ruby]}
        routes={routes} pickupDriverByDog={mapa} {...noops} onCreateDropoffRoute={onCreateDropoffRoute} />,
    );
    // Jordan buscou a Ruby: pode criar a perna dele (a TROCA DE PERNA saiu — o cartão já mostra as duas).
    await fireEvent.press(tela.getByRole('button', { name: 'Show Jordan' }));
    expect(tela.getByRole('button', { name: 'Create drop-off route for Jordan' })).toBeTruthy();
    // Sam não buscou ninguém e não há cão órfão: não tem o que entregar.
    await fireEvent.press(tela.getByRole('button', { name: 'Show Sam' }));
    expect(tela.queryByRole('button', { name: 'Create drop-off route for Sam' })).toBeNull();
  });

  it('sem a prop, o quadro é o de antes (qualquer cão elegível oferece a ação)', async () => {
    const tela = await render(
      <DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} dropoffItems={[Billy]}
        routes={routes} {...noops} onCreateDropoffRoute={jest.fn()} />,
    );
    await fireEvent.press(tela.getByRole('button', { name: 'Show Jordan' }));
    expect(tela.getByRole('button', { name: 'Create drop-off route for Jordan' })).toBeTruthy();
  });

  it('na folha de entrega o outro motorista nem aparece: o cão vem com o dono selecionado', async () => {
    const tela = await render(
      <DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} dropoffItems={[Billy]}
        routes={routes} pickupDriverByDog={mapa} {...noops} />,
    );
    await fireEvent.press(tela.getByLabelText('Assign drop-offs'));
    await fireEvent.press(tela.getByLabelText('Assign Amy · Billy'));
    expect(tela.getByText('Billy was picked up by Rafael — the drop-off stays with them.')).toBeTruthy();
    expect(tela.getByLabelText('Driver Rafael')).toBeTruthy();
    expect(tela.queryByLabelText('Driver Jordan')).toBeNull();
    expect(tela.queryByLabelText('Driver Sam')).toBeNull();
  });
});
