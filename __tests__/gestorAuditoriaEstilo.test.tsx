/**
 * AUDITORIA DO GESTOR (02/10/2026) — M4 (contraste) e M5 (legendas/alvos de toque).
 *
 * M4: `colors.gold` (C7A75C) usado como TEXTO sobre cartão claro ficava em ~2,3:1 (abaixo do mínimo
 *     WCAG de 4,5:1). Os links "Show/Hide", "Edit ›" e "›" passam a `forest700`.
 * M5: legendas ≥12 pt e alvos de toque ≥44 pt no quadro do gestor.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'manager', view: 'manager', isLoading: false }),
}));

jest.mock('@/lib/supabase', () => {
  const resposta = (tabela: string): { data: unknown; error: null } =>
    tabela === 'organization_members' ? { data: [{ organization_id: 'org-1' }], error: null } : { data: [], error: null };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      storage: { from: () => ({ createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/foto.jpg' }, error: null }) }) },
      from: (tabela: string) => {
        const chain: Record<string, unknown> = {};
        const mesmo = () => chain;
        for (const metodo of ['eq', 'lte', 'gte', 'in', 'order', 'limit']) chain[metodo] = mesmo;
        chain.select = mesmo;
        chain.maybeSingle = async () => resposta(tabela);
        chain.single = async () => resposta(tabela);
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve(resposta(tabela)).then(res);
        return chain;
      },
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { ClientsList } from '@/features/clients/ClientsList';
import { EditClientForm } from '@/features/clients/EditClientForm';
import { DayPlanCard } from '@/features/dashboard/DayPlanCard';
import { PackSheet } from '@/features/dashboard/PackSheet';
import { DispatchBoard, type DispatchDriver, type DispatchRoute, type DispatchStopItem } from '@/features/dispatch/DispatchBoard';
import { colors } from '@/features/theme/tokens';
import DaySummaryScreen from '@/app/day-summary';
import WeekSummaryScreen from '@/app/week-summary';
import { todayLocalISO } from '@/features/calendar/dates';
import { dayChipLabel } from '@/features/dashboard/weeklySummary';

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

describe('M4 — gold como TEXTO vira forest700 (contraste)', () => {
  it('ClientsList: "Edit ›" usa forest700', async () => {
    const tela = await render(
      <ClientsList
        clients={[{ id: 'c1', name: 'Maria', phone: null, address_line_1: null, city: null, state: null, active: true, dogs: [{ name: 'Bob' }] }]}
        loading={false}
        onAddClient={jest.fn()}
        onOpenClient={jest.fn()}
      />,
    );
    expect(tela.getByText('Edit ›')).toHaveStyle({ color: colors.forest700 });
  });

  it('DispatchBoard: "Show"/"Hide" (cão já na van) usa forest700', async () => {
    const dayItems: DispatchStopItem[] = [{ dogId: 'dog-filo', clientName: 'Amor', dogName: 'Filó', reservationKind: 'boarding', inVan: true }];
    const tela = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} />);
    expect(tela.getByText('Show')).toHaveStyle({ color: colors.forest700 });
  });
});

describe('M5 — legendas ≥12 pt e alvos ≥44 pt no quadro do gestor', () => {
  const dayItems: DispatchStopItem[] = [
    { dogId: 'dog-bob', clientName: 'Maria', dogName: 'Bob', reservationKind: 'daycare' },
    { dogId: 'dog-filo', clientName: 'Amor', dogName: 'Filó', reservationKind: 'boarding', inVan: true },
  ];

  it('DispatchBoard: eyebrow, título da fila e "Show" têm ≥12 pt; chip tem 44 pt', async () => {
    const tela = await render(<DispatchBoard date="2026-09-09" drivers={drivers} dayItems={dayItems} routes={[]} {...noops} />);
    expect(tela.getByText('PACK & PAWS CLUB · DISPATCH')).toHaveStyle({ fontSize: 12 });
    expect(tela.getByText(/unassigned/)).toHaveStyle({ fontSize: 12 });
    expect(tela.getByText('Show')).toHaveStyle({ fontSize: 12 });
    expect(tela.getByRole('button', { name: 'Assign Maria · Bob' })).toHaveStyle({ minHeight: 44 });
  });

  it('DayPlanCard: o rótulo do campo tem ≥12 pt', async () => {
    const tela = await render(<DayPlanCard walkLocation={null} photoIdea={null} onSave={jest.fn()} />);
    expect(tela.getByText('Walk location')).toHaveStyle({ fontSize: 12 });
  });

  it('PackSheet: "Walking with" tem ≥12 pt', async () => {
    const tela = await render(
      <PackSheet
        visible
        dayLabel="Monday"
        rows={[{ dogId: 'd1', dogName: 'Filó', clientName: 'Amor', serviceType: 'daycare', inPack: true, walkerId: null }] as never}
        members={[]}
        onToggle={jest.fn()}
        onSetWalker={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(tela.getByText(/Walking with:/)).toHaveStyle({ fontSize: 12 });
  });

  it('Day summary: o rótulo do plano do dia tem ≥12 pt', async () => {
    const tela = await render(<DaySummaryScreen />);
    await waitFor(() => expect(tela.getByText('Walk location')).toBeTruthy());
    expect(tela.getByText('Walk location')).toHaveStyle({ fontSize: 12 });
    expect(tela.getByText('Photo of the day — idea')).toHaveStyle({ fontSize: 12 });
  });

  it('Week summary: o rótulo do dia no chip tem ≥12 pt', async () => {
    const tela = await render(<WeekSummaryScreen />);
    const rotulo = dayChipLabel(todayLocalISO());
    await waitFor(() => expect(tela.getAllByText(rotulo).length).toBeGreaterThan(0));
    expect(tela.getAllByText(rotulo)[0]).toHaveStyle({ fontSize: 12 });
  });
});

/**
 * M4/M5 SEGUNDA PASSADA (02/10/2026) — o que a vistoria achou DEPOIS da primeira rodada: dourado
 * como TEXTO (2,27:1) no formulário do cliente e num badge do Dispatch, e as legendas/alvos que
 * ainda estavam abaixo de 12 pt / 44 pt no lado gestor.
 */
describe('M4 — gold como TEXTO restante vira forest700', () => {
  it('EditClientForm: "Keep" (desfazer remoção de cão) usa forest700', async () => {
    const alertas: { text?: string; onPress?: () => void }[][] = [];
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_titulo?: string, _msg?: string, botoes?: unknown) => {
      alertas.push((botoes ?? []) as { text?: string; onPress?: () => void }[]);
    });
    const tela = await render(
      <EditClientForm
        current={{
          name: 'Ana Souza', phone: '4155551234', second_owner_name: null, second_owner_phone: null,
          address_line_1: '100 Market St', address_line_2: null, city: 'San Francisco', state: 'CA',
          postal_code: '94103', notes: null, special_scheduling_instructions: null, latitude: null, longitude: null,
        }}
        dogs={[{ id: 'dog-1', name: 'Mowgli', breed: null, behavior_notes: null, medical_notes: null, photo_url: null }]}
        instructions={null}
        active
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    fireEvent.press(tela.getByLabelText('Remove Mowgli'));
    alertas.at(-1)?.find((botao) => botao.text === 'Remove')?.onPress?.();
    await waitFor(() => expect(tela.getByText('Keep')).toBeTruthy());
    expect(tela.getByText('Keep')).toHaveStyle({ color: colors.forest700 });
    spy.mockRestore();
  });

  it('DispatchBoard: a hora exata "@ 07:45" usa forest700', async () => {
    const rota: DispatchRoute[] = [{
      routeId: 'route-1', driverId: 'driver-rafael', status: 'published',
      stops: [{ dogId: 'dog-bob', clientName: 'Maria', dogName: 'Bob', sequence: 1, status: 'pending', latitude: 37.79, longitude: -122.4, windowStart: null, windowEnd: null, exactTime: '07:45', priority: 'normal' }],
    }];
    const tela = await render(
      <DispatchBoard date="2026-09-09" drivers={drivers} dayItems={[{ dogId: 'dog-bob', clientName: 'Maria', dogName: 'Bob', reservationKind: 'daycare' }]} routes={rota} {...noops} />,
    );
    expect(tela.getByText('@ 07:45')).toHaveStyle({ color: colors.forest700 });
  });
});

describe('M5 (2ª passada) — legendas ≥12 pt e alvos ≥44 pt no lado gestor', () => {
  it('ClientsList: eyebrow e INACTIVE com ≥12 pt; "Call"/"Text" e chip de inativos com 44 pt', async () => {
    const tela = await render(
      <ClientsList
        clients={[
          { id: 'c1', name: 'Maria', phone: '4155551234', address_line_1: null, city: null, state: null, active: true, dogs: [{ name: 'Bob' }] },
          { id: 'c2', name: 'Joao', phone: null, address_line_1: null, city: null, state: null, active: false, dogs: [] },
        ]}
        loading={false}
        onAddClient={jest.fn()}
        onOpenClient={jest.fn()}
      />,
    );
    expect(tela.getByText('PACK & PAWS CLUB')).toHaveStyle({ fontSize: 12 });
    expect(tela.getByText('INACTIVE')).toHaveStyle({ fontSize: 12 });
    expect(tela.getByLabelText('Call Maria')).toHaveStyle({ minHeight: 44 });
    expect(tela.getByLabelText('Hide inactive clients')).toHaveStyle({ minHeight: 44 });
  });

  it('DispatchBoard: setas de dia com 44 pt; chip da van e atalho da lista de paradas com 44 pt', async () => {
    const rota: DispatchRoute[] = [{
      routeId: 'route-1', driverId: 'driver-rafael', status: 'published',
      stops: [{ dogId: 'dog-bob', clientName: 'Maria', dogName: 'Bob', sequence: 1, status: 'pending', latitude: 37.79, longitude: -122.4, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' }],
    }];
    const tela = await render(
      <DispatchBoard
        date="2026-09-09" drivers={drivers} dayItems={[{ dogId: 'dog-bob', clientName: 'Maria', dogName: 'Bob', reservationKind: 'daycare' }]}
        routes={rota} vans={[{ id: 'van-1', name: 'Van 1', isDefault: true }, { id: 'van-2', name: 'Van 2', isDefault: false }]}
        onChooseVan={jest.fn()} onOpenStopList={jest.fn()} {...noops}
      />,
    );
    expect(tela.getByLabelText('Previous day')).toHaveStyle({ width: 44, height: 44 });
    expect(tela.getByLabelText('Use Van 1 for Rafael')).toHaveStyle({ minHeight: 44 });
    expect(tela.getByLabelText('Stop list for Rafael')).toHaveStyle({ minHeight: 44 });
  });

  it('EditClientForm: rótulo com ≥12 pt e "Remove cão"/"Add photo" com 44 pt', async () => {
    const tela = await render(
      <EditClientForm
        current={{
          name: 'Ana Souza', phone: '4155551234', second_owner_name: null, second_owner_phone: null,
          address_line_1: '100 Market St', address_line_2: null, city: 'San Francisco', state: 'CA',
          postal_code: '94103', notes: null, special_scheduling_instructions: null, latitude: null, longitude: null,
        }}
        dogs={[{ id: 'dog-1', name: 'Mowgli', breed: null, behavior_notes: null, medical_notes: null, photo_url: null }]}
        instructions={null}
        active
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(tela.getAllByText('Dog name')[0]).toHaveStyle({ fontSize: 12 });
    expect(tela.getByLabelText('Remove Mowgli')).toHaveStyle({ minHeight: 44 });
    expect(tela.getByLabelText('Add photo for Mowgli')).toHaveStyle({ minHeight: 44 });
  });

  it('DayPlanCard: subtítulo/dica com ≥12 pt e "Save" com 44 pt', async () => {
    const tela = await render(<DayPlanCard walkLocation={null} photoIdea={null} onSave={jest.fn()} />);
    expect(tela.getByText('Photo and walk location — decided the day before.')).toHaveStyle({ fontSize: 12 });
    expect(tela.getByLabelText('Save the day plan')).toHaveStyle({ minHeight: 44 });
  });

  it('PackSheet: tutor/chip com ≥12 pt e chip do caminhante com 44 pt', async () => {
    const tela = await render(
      <PackSheet
        visible
        dayLabel="Monday"
        rows={[{ dogId: 'd1', dogName: 'Filó', clientName: 'Amor', serviceType: 'daycare', inPack: true, walkerId: null }] as never}
        members={[{ id: 'p1', name: 'Rafael' }] as never}
        onToggle={jest.fn()}
        onSetWalker={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(tela.getByText('Amor · Daycare')).toHaveStyle({ fontSize: 12 });
    expect(tela.getByLabelText('Walker for Filó: Unassigned')).toHaveStyle({ minHeight: 44 });
  });

  it('Day summary: o rótulo do quadro com ≥12 pt', async () => {
    const tela = await render(<DaySummaryScreen />);
    await waitFor(() => expect(tela.getByText('Total Pack')).toBeTruthy());
    expect(tela.getByText('Total Pack')).toHaveStyle({ fontSize: 12 });
  });

  it('Week summary: a pílula "This week" tem 44 pt de alvo e ≥12 pt no rótulo', async () => {
    const tela = await render(<WeekSummaryScreen />);
    await waitFor(() => expect(tela.getByLabelText('Previous week')).toBeTruthy());
    await fireEvent.press(tela.getByLabelText('Previous week'));
    await waitFor(() => expect(tela.getByLabelText('Back to this week')).toBeTruthy());
    expect(tela.getByLabelText('Back to this week')).toHaveStyle({ minHeight: 44 });
    expect(tela.getByText('This week')).toHaveStyle({ fontSize: 12 });
  });
});
