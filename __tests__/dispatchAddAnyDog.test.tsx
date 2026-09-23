import { fireEvent, render } from '@testing-library/react-native';

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

    expect(screen.getByText('Leigh Ann · Melanie · manual')).toBeTruthy();
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

    await fireEvent.press(screen.getByRole('button', { name: 'Assign Leigh Ann · Melanie' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Driver Rafael' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save stop' }));

    expect(onAssign).toHaveBeenCalledWith('dog-mel', 'driver-rafael', expect.anything());
  });
});
