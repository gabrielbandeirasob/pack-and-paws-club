// Pedido do cliente (04/10/2026): calendário e Dispatch identificam apenas o cão; as asserções permanecem.
import { act, fireEvent, render } from '@testing-library/react-native';
// RNTL renders visible native modals as RCTModalHostView nodes.
function visibleModalCount(node: any): number {
  if (!node) return 0;
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + visibleModalCount(child), 0);
  return (node.type === 'Modal' || node.type === 'RCTModalHostView' ? 1 : 0) + visibleModalCount(node.children);
}

import { DispatchBoard, type DispatchDriver } from '@/features/dispatch/DispatchBoard';

// O board mostra o comprovante de entrega e esse componente pede link assinado ao Supabase. O mock
// evita que o módulo real valide a configuração (que não existe no teste).
jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/foto.jpg' }, error: null }),
      }),
    },
  },
}));

const drivers: DispatchDriver[] = [{ id: 'driver-rafael', name: 'Rafael' }];

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

const MELANIE = { id: 'dog-mel', dogName: 'Melanie', clientName: 'Leigh Ann' };

// Screenshot fixture (05/10): registry dog already in UNASSIGNED, no route for Gabriel.
const screenshotDrivers: DispatchDriver[] = [
  { id: 'raphael', name: 'Raphael' }, { id: 'john', name: 'John' },
  { id: 'gabriel', name: 'Gabriel', alsoManager: true },
];
const rani = { dogId: 'rani', dogName: 'Rani', clientName: 'Fixture client', extra: true };
async function openRani(onAssign: (...args: any[]) => Promise<void>) {
  const screen = await render(<DispatchBoard date="2026-10-05" drivers={screenshotDrivers}
    dayItems={[rani, { dogId: 'boarding', dogName: 'Boarding fixture', clientName: 'Fixture', inVan: true, reservationKind: 'boarding' }]}
    routes={[]} {...noops} onAssign={onAssign} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Show Gabriel' }));
  expect(screen.getByText('0 stops')).toBeTruthy();
  expect(screen.getByText('Rani · manual')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Assign Rani' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Driver Gabriel' }));
  return screen;
}

it('adds the registry dog without stacking two native modals', async () => {
  const onAddExtraDog = jest.fn();
  const screen = await render(<DispatchBoard date="2026-10-05" drivers={screenshotDrivers}
    dayItems={[]} routes={[]} {...noops} dogs={[MELANIE]} onAddExtraDog={onAddExtraDog} />);
  await fireEvent.press(screen.getByLabelText('Add any dog'));
  await fireEvent.press(screen.getByLabelText('Select dog'));
  expect(visibleModalCount(screen.toJSON())).toBe(1);
  await fireEvent.press(screen.getByLabelText('Select Melanie of Leigh Ann'));
  expect(onAddExtraDog).toHaveBeenCalledWith(MELANIE);
  expect(visibleModalCount(screen.toJSON())).toBe(0);
});

it('shows an async rejection and releases loading so manual assignment can be retried', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  const onAssign = jest.fn().mockImplementationOnce(() => pending).mockResolvedValue(undefined);
  const screen = await openRani(onAssign);
  await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
  expect(screen.getByRole('button', { name: 'Save stop' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
  expect(onAssign).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('Network unavailable. Try again.')); await pending.catch(() => {}); });
  expect(screen.getByText('Network unavailable. Try again.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save stop' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));
  expect(onAssign).toHaveBeenLastCalledWith('rani', 'gabriel', expect.anything());
  expect(screen.queryByRole('button', { name: 'Save stop' })).toBeNull();
});

it('keeps the board usable after adding Rani without a reservation', async () => {
  const { useState } = require('react');
  const dog = { id: 'rani', dogName: 'Rani', clientName: 'Fixture client' };
  function Harness() {
    const [items, setItems] = useState([]);
    return <DispatchBoard date="2026-10-05" drivers={screenshotDrivers} dayItems={items} routes={[]}
      {...noops} dogs={[dog]} onAddExtraDog={() => setItems([rani])} />;
  }
  const screen = await render(<Harness />);
  for (let attempt = 0; attempt < 2; attempt++) {
    await fireEvent.press(screen.getByLabelText('Add any dog'));
    await fireEvent.press(screen.getByLabelText('Select dog'));
    await fireEvent.changeText(screen.getByLabelText('Search dog or client'), 'rani');
    expect(visibleModalCount(screen.toJSON())).toBe(1);
    await fireEvent.press(screen.getByLabelText('Select Rani of Fixture client'));
    expect(visibleModalCount(screen.toJSON())).toBe(0);
    expect(screen.getByText('Rani · manual')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Show Gabriel' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Assign Rani' }));
    expect(screen.getByRole('button', { name: 'Save stop' })).toBeEnabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  }
});

it('searches by client, cancels, and resets the manual picker on reopen', async () => {
  const onAddExtraDog = jest.fn();
  const screen = await render(<DispatchBoard date="2026-10-05" drivers={screenshotDrivers}
    dayItems={[]} routes={[]} {...noops} dogs={[MELANIE]} onAddExtraDog={onAddExtraDog} />);
  await fireEvent.press(screen.getByLabelText('Add any dog'));
  await fireEvent.press(screen.getByLabelText('Select dog'));
  await fireEvent.changeText(screen.getByLabelText('Search dog or client'), 'not found');
  expect(screen.getByText('No dogs found for “not found”.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Cancel dog selection'));
  await fireEvent.press(screen.getByLabelText('Select dog'));
  expect(screen.getByLabelText('Search dog or client')).toHaveDisplayValue('');
  await fireEvent.changeText(screen.getByLabelText('Search dog or client'), 'leigh');
  expect(screen.getByLabelText('Select Melanie of Leigh Ann')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(visibleModalCount(screen.toJSON())).toBe(0);
  expect(onAddExtraDog).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('Add any dog'));
  await fireEvent.press(screen.getByLabelText('Select dog'));
  expect(screen.getByLabelText('Search dog or client')).toHaveDisplayValue('');
});

describe('Dispatch — Add any dog (pedido do dono, 23/09/2026)', () => {
  it('deixa o gestor puxar do cadastro um cão que não está no calendário do dia', async () => {
    const onAddExtraDog = jest.fn();
    const screen = await render(
      <DispatchBoard date="2026-09-09" drivers={drivers} dayItems={[]} routes={[]} {...noops} dogs={[MELANIE]} onAddExtraDog={onAddExtraDog} />,
    );

    await fireEvent.press(screen.getByLabelText('Add any dog'));
    await fireEvent.press(screen.getByLabelText('Select dog'));
    await fireEvent.press(screen.getByLabelText('Select Melanie of Leigh Ann'));

    expect(onAddExtraDog).toHaveBeenCalledWith(MELANIE);
  });

  it('não mostra o botão quando a tela não passa o cadastro (não inventa opção vazia)', async () => {
    const screen = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={[]} routes={[]} {...noops} />);

    expect(screen.queryByLabelText('Add any dog')).toBeNull();
  });

  it('marca no chip o cão que o gestor adicionou à mão (não confundir com o que veio do calendário)', async () => {
    const screen = await render(
      <DispatchBoard
        date="2026-09-09"
        drivers={drivers}
        dayItems={[{ dogId: 'dog-mel', clientName: 'Leigh Ann', dogName: 'Melanie', extra: true }]}
        routes={[]}
        {...noops}
      />,
    );

    expect(screen.getByText('Melanie · manual')).toBeTruthy();
    expect(screen.getByText('1 unassigned')).toBeTruthy();
  });

  it('o cão adicionado à mão segue o mesmo caminho de atribuição de rota', async () => {
    const onAssign = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <DispatchBoard
        date="2026-09-09"
        drivers={drivers}
        dayItems={[{ dogId: 'dog-mel', clientName: 'Leigh Ann', dogName: 'Melanie', extra: true }]}
        routes={[]}
        {...noops}
        onAssign={onAssign}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Assign Melanie' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));

    expect(onAssign).toHaveBeenCalledWith('dog-mel', 'driver-rafael', expect.anything());
  });
});
