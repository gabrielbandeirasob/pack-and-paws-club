import { fireEvent, render } from '@testing-library/react-native';

import { DispatchBoard } from '@/features/dispatch/DispatchBoard';
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: jest.fn() } } }));

/**
 * VAN ≠ YARD NO SELETOR DO DISPATCH — transcrição do dono (02/10/2026):
 *
 *   *"o yard está aparecendo ali na lista de vans mas não aparece nos drop-off"*
 *   *"tá mostrando van 1, van 2, yard, tipo assim, o que é que tem o yard? tipo, não é uma van o yard,
 *     ele tem que ter o endereço que ele vai finalizar"*
 *
 * O que estes vetores travam:
 *  - o yard NÃO vira chip de van (não é escolhível, não existe "Use Yard for ...");
 *  - ele ganha uma linha PRÓPRIA, rotulada "where the pick-up ends", com o endereço, e sem toque;
 *  - a linha das vans é rotulada "where the day starts" e lista SÓ vans;
 *  - organização SEM yard fica idêntica ao de antes (zero ruído).
 *
 * E o controle de sempre continua valendo: com UMA van só, nada aparece.
 */
const VAN_1 = { id: 'van-1', name: 'Van 1', isDefault: true, kind: 'van' as const };
const VAN_2 = { id: 'van-2', name: 'Van 2', isDefault: false, kind: 'van' as const };
const YARD = { id: 'yard-1', name: 'Yard', isDefault: false, kind: 'yard' as const, address: '1089 Memorex Drive · Santa Clara' };

function props(over: Partial<React.ComponentProps<typeof DispatchBoard>> = {}) {
  return {
    date: '2026-10-02',
    drivers: [{ id: 'motorista-1', name: 'Rafael' }],
    dayItems: [{ dogId: 'lucky', clientName: 'Cristina', dogName: 'Lucky' }],
    routes: [],
    driverLocations: {},
    onAssign: jest.fn(),
    onSaveStop: jest.fn(),
    onRemoveStop: jest.fn(),
    onMoveStop: jest.fn(),
    onMoveDropoff: jest.fn(),
    onOptimize: jest.fn(),
    onPublish: jest.fn(),
    onUnpublish: jest.fn(),
    onCancelRoute: jest.fn(),
    onCompleteRoute: jest.fn(),
    onDateChange: jest.fn(),
    vans: [VAN_1, VAN_2, YARD],
    onChooseVan: jest.fn(),
    ...over,
  } as React.ComponentProps<typeof DispatchBoard>;
}

describe('yard não é van no seletor do Dispatch', () => {
  it('o yard NÃO aparece como opção de van — só as vans viram chip escolhível', async () => {
    const tela = await render(<DispatchBoard {...props()} />);
    expect(tela.getByLabelText('Use Van 1 for Rafael')).toBeTruthy();
    expect(tela.getByLabelText('Use Van 2 for Rafael')).toBeTruthy();
    expect(tela.queryByLabelText('Use Yard for Rafael')).toBeNull();
  });

  it('o yard ganha linha PRÓPRIA com o endereço ("where the pick-up ends") e não responde a toque', async () => {
    const onChooseVan = jest.fn().mockResolvedValue(undefined);
    const tela = await render(<DispatchBoard {...props({ onChooseVan })} />);

    // A linha da van diz o PAPEL dela; o yard tem a dele, separada.
    expect(tela.getByText('Van · where the day starts')).toBeTruthy();
    expect(tela.getByTestId('driver-yard-motorista-1')).toBeTruthy();
    expect(tela.getByText('Yard · where the pick-up ends')).toBeTruthy();
    // O dono pediu o ENDEREÇO: "ele tem que ter o endereço que ele vai finalizar".
    expect(tela.getByText('Yard — 1089 Memorex Drive · Santa Clara')).toBeTruthy();

    // Tocar no yard não escolhe nada (não é um radio) — o seletor de van não é acionado.
    fireEvent.press(tela.getByText('Yard — 1089 Memorex Drive · Santa Clara'));
    expect(onChooseVan).not.toHaveBeenCalled();

    // E o toque numa VAN continua funcionando (o controle de antes segue vivo).
    fireEvent.press(tela.getByLabelText('Use Van 2 for Rafael'));
    expect(onChooseVan).toHaveBeenCalledWith('motorista-1', 'van-2');
  });

  it('UMA van + um yard: nenhum seletor de van (zero ruído), mas o yard continua visível', async () => {
    const tela = await render(<DispatchBoard {...props({ vans: [{ ...VAN_1 }, YARD] })} />);
    expect(tela.queryByTestId('driver-van-motorista-1')).toBeNull();
    expect(tela.queryByLabelText('Use Van 1 for Rafael')).toBeNull();
    expect(tela.getByTestId('driver-yard-motorista-1')).toBeTruthy();
  });

  it('organização SEM yard fica como era: nenhuma linha de yard', async () => {
    const tela = await render(<DispatchBoard {...props({ vans: [VAN_1, VAN_2] })} />);
    expect(tela.queryByTestId('driver-yard-motorista-1')).toBeNull();
    expect(tela.queryByText('Yard · where the pick-up ends')).toBeNull();
    // E o seletor de van segue aparecendo com 2 vans.
    expect(tela.getByLabelText('Use Van 1 for Rafael')).toBeTruthy();
  });

  it('sem a prop onChooseVan nada de yard/van aparece (quadro igual ao de antes)', async () => {
    const tela = await render(<DispatchBoard {...props({ onChooseVan: undefined })} />);
    expect(tela.queryByTestId('driver-yard-motorista-1')).toBeNull();
    expect(tela.queryByLabelText('Use Van 1 for Rafael')).toBeNull();
  });
});
