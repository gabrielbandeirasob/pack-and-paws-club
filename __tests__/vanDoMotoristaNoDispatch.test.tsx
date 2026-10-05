import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DispatchBoard } from '@/features/dispatch/DispatchBoard';
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: jest.fn() } } }));

/**
 * VAN DE CADA MOTORISTA no quadro do Dispatch — pergunta do dono (01/10/2026): *"vamos supor que tenhas
 * várias vans, o erro não vai se repetir?"*.
 *
 * O defeito original foi a rota nascer apontando para a van PADRÃO (que era um cadastro de teste em São
 * Francisco, a ~35 km dos clientes) e travar o clock in do motorista. Estas provas:
 *  - com UMA van cadastrada o controle NEM APARECE (zero ruído — é o mundo de hoje);
 *  - com DUAS ou mais, cada motorista tem a sua van e o gestor troca num toque;
 *  - a van já gravada na rota aparece MARCADA (o gestor vê o que está valendo);
 *  - sem a prop `onChooseVan` nada aparece (quadro igual ao de antes).
 */
const VAN_FRANCISCO = { id: 'sf', name: 'Van teste', isDefault: true };
const VAN_SAN_MATEO = { id: 'sm', name: 'Van 1', isDefault: false };

function props(over: Partial<React.ComponentProps<typeof DispatchBoard>> = {}) {
  return {
    date: '2026-10-01',
    drivers: [{ id: 'motorista-1', name: 'Rafael' }, { id: 'motorista-2', name: 'Jordan' }],
    dayItems: [{ dogId: 'lucky', clientName: 'Cristina', dogName: 'Lucky' }],
    routes: [],
    driverLocations: {},
    onAssign: jest.fn(),
    onSaveStop: jest.fn(),
    onRemoveStop: jest.fn(),
    onMoveStop: jest.fn(),
    onOptimize: jest.fn(),
    onPublish: jest.fn(),
    onUnpublish: jest.fn(),
    onCancelRoute: jest.fn(),
    onCompleteRoute: jest.fn(),
    onDateChange: jest.fn(),
    vans: [VAN_FRANCISCO, VAN_SAN_MATEO],
    onChooseVan: jest.fn(),
    ...over,
  } as React.ComponentProps<typeof DispatchBoard>;
}

describe('van por motorista no Dispatch', () => {
  it('com UMA van cadastrada o controle não aparece (zero ruído)', async () => {
    const tela = await render(<DispatchBoard {...props({ vans: [{ ...VAN_SAN_MATEO, isDefault: true }] })} />);
    expect(tela.queryByLabelText('Use Van 1 for Rafael')).toBeNull();
    expect(tela.toJSON()).toBeTruthy();
  });

  it('sem a prop onChooseVan o quadro fica como era (nada de controle órfão)', async () => {
    const tela = await render(<DispatchBoard {...props({ onChooseVan: undefined })} />);
    expect(tela.queryByLabelText('Use Van 1 for Rafael')).toBeNull();
  });

  it('com duas vans cada motorista escolhe a sua num toque', async () => {
    const onChooseVan = jest.fn().mockResolvedValue(undefined);
    const tela = await render(<DispatchBoard {...props({ onChooseVan })} />);

    expect(tela.getByLabelText('Use Van teste for Rafael')).toBeTruthy();
    expect(tela.getByLabelText('Use Van 1 for Rafael')).toBeTruthy();
    // PROPOSTA B (dono, 03/10/2026): um motorista por vez — o chip troca quem está na tela; cada
    // motorista visível tem o seu próprio seletor de van.
    await fireEvent.press(tela.getByRole('button', { name: 'Show Jordan' }));
    expect(tela.getByLabelText('Use Van 1 for Jordan')).toBeTruthy();
    await fireEvent.press(tela.getByRole('button', { name: 'Show Rafael' }));

    fireEvent.press(tela.getByLabelText('Use Van 1 for Rafael'));
    await waitFor(() => expect(onChooseVan).toHaveBeenCalledTimes(1));
    expect(onChooseVan.mock.calls[0]).toEqual(['motorista-1', 'sm']);
  });

  it('a van já gravada na rota aparece MARCADA e não é reescrita', async () => {
    const onChooseVan = jest.fn().mockResolvedValue(undefined);
    const tela = await render(
      <DispatchBoard
        {...props({
          onChooseVan,
          routes: [
            {
              routeId: 'rota-1',
              driverId: 'motorista-1',
              status: 'draft',
              startLocationId: 'sf',
              stops: [
                {
                  dogId: 'lucky', clientName: 'Cristina', dogName: 'Lucky', sequence: 1, status: 'pending',
                  latitude: 37.44, longitude: -122.14, windowStart: null, windowEnd: null, exactTime: null,
                  priority: 'normal',
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(tela.getByLabelText('Use Van teste for Rafael').props.accessibilityState).toMatchObject({ checked: true });
    expect(tela.getByLabelText('Use Van 1 for Rafael').props.accessibilityState).toMatchObject({ checked: false });

    // Tocar na van que já está valendo não escreve nada (o cartão nem chama a tela).
    fireEvent.press(tela.getByLabelText('Use Van teste for Rafael'));
    await waitFor(() => expect(onChooseVan).not.toHaveBeenCalled());
  });
});

/**
 * ATALHO PARA A LISTA DE PARADAS no cartão do Dispatch (o dono procurou ali e não achou, 01/10/2026:
 * *"cliquei no cartao do driver e nao vi nada disso"*) — antes a lista só abria pelo cartão da Home.
 */
describe('lista de paradas no cartão do Dispatch', () => {
  const rotaComParada = {
    routeId: 'rota-1', driverId: 'motorista-1', status: 'draft' as const, startLocationId: null,
    stops: [{
      dogId: 'lucky', clientName: 'Cristina', dogName: 'Lucky', sequence: 1, status: 'pending' as const,
      latitude: 37.44, longitude: -122.14, windowStart: null, windowEnd: null, exactTime: null,
      priority: 'normal' as const,
    }],
  };

  it('sem rota não há atalho (não existe parada para listar)', async () => {
    const onOpenStopList = jest.fn();
    const tela = await render(<DispatchBoard {...props({ onOpenStopList })} />);
    expect(tela.queryByLabelText('Stop list for Rafael')).toBeNull();
  });

  it('com rota, o toque abre a lista do motorista certo', async () => {
    const onOpenStopList = jest.fn();
    const tela = await render(<DispatchBoard {...props({ onOpenStopList, routes: [rotaComParada] })} />);
    // Redesenho (item 8): "Edit times" (a lista de paradas) vive no overflow do cartão.
    await fireEvent.press(tela.getByLabelText('More actions for Rafael'));
    await fireEvent.press(tela.getByLabelText('Stop list for Rafael'));
    expect(onOpenStopList).toHaveBeenCalledWith('rota-1', 'Rafael');
  });

  it('sem a prop o cartão fica como era (nada de link órfão)', async () => {
    const tela = await render(<DispatchBoard {...props({ routes: [rotaComParada] })} />);
    expect(tela.queryByLabelText('Stop list for Rafael')).toBeNull();
  });
});
