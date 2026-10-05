jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: jest.fn() } } }));
import { render, within } from '@testing-library/react-native';
import { DispatchBoard } from '@/features/dispatch/DispatchBoard';

const dog = { dogId: 'dog', dogName: 'Maui', clientName: 'Amy' };
const stop = { ...dog, sequence: 1, status: 'pending' as const, latitude: 0, longitude: 0, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const };
const noop = jest.fn();
const props = { date: '2026-10-04', drivers: [{ id: 'driver', name: 'Rafael' }], dayItems: [dog], routes: [], onAssign: noop, onSaveStop: noop, onRemoveStop: noop, onMoveStop: noop, onOptimize: noop, onPublish: noop, onUnpublish: noop, onCancelRoute: noop, onCompleteRoute: noop, onDateChange: noop, onAddExtraDog: noop };

it('puts the assignment pool before both the driver selector and card inside the scroll', async () => {
  const screen = await render(<DispatchBoard {...props} />);
  const scroll = screen.getByTestId('dispatch-scroll');
  const flatten = (node: typeof scroll): typeof scroll[] => [node, ...node.children.flatMap(child => typeof child === 'string' ? [] : flatten(child))];
  const nodes = flatten(scroll);
  const pool = within(scroll).getByText('1 unassigned');
  expect(nodes.indexOf(pool)).toBeLessThan(nodes.indexOf(within(scroll).getByLabelText('Show Rafael')));
  expect(nodes.indexOf(pool)).toBeLessThan(nodes.indexOf(within(scroll).getByTestId('dispatch-route-driver-pickup')));
  expect(within(scroll).getByLabelText('Assign Maui')).toBeTruthy();
  expect(within(scroll).getByLabelText('Add any dog')).toBeTruthy();
});

it('replaces the empty pool title with a single short assigned message, keeping Add any dog', async () => {
  const screen = await render(<DispatchBoard {...props} routes={[{ routeId: 'route', driverId: 'driver', status: 'draft', stops: [stop] }]} />);
  expect(screen.queryByText('0 unassigned')).toBeNull();
  expect(screen.getByText('✓ All dogs assigned').props.numberOfLines).toBe(1);
  expect(screen.queryByLabelText('Assign Maui')).toBeNull();
  expect(screen.getByLabelText('Add any dog')).toBeTruthy();
});

it('caps action badges at two while keeping both timing constraints and the drag/options controls', async () => {
  const screen = await render(<DispatchBoard {...props} routes={[{ routeId: 'route', driverId: 'driver', status: 'draft', stops: [{ ...stop, status: 'skipped', priority: 'priority', pickupPin: 'first', windowStart: '09:00', windowEnd: '11:00', exactTime: '10:00' }, { ...stop, dogId: 'other', dogName: 'Luna', sequence: 2 }] }]} />);
  const badges = screen.getByTestId('stop-badges-pickup-dog');
  expect(badges.children).toHaveLength(2);
  expect(within(badges).getByText('⚠ Problem')).toBeTruthy();
  expect(within(badges).getByText('🔒 1st')).toBeTruthy();
  expect(within(badges).queryByText('⚡ High')).toBeNull();
  expect(screen.getByText('9:00 AM')).toBeTruthy();
  expect(screen.getByTestId('reorder-pickup-dog').props.accessibilityHint).toContain('High priority');
  expect(screen.getByTestId('drag-pickup-dog')).toBeTruthy();
  expect(screen.getByLabelText('Options for Maui')).toBeTruthy();
});

/**
 * NADA ESCONDIDO ATRÁS DE ROLAGEM (dono, 04/10/2026: *"quero o unassigned fique na parte de cima para
 * sabermos quais dogs estão sem motorista e facilitar o serviço"*).
 *
 * A primeira entrega desta rodada tinha posto os cães sem motorista e as ações em faixas com rolagem
 * HORIZONTAL: no iPhone estreito o "Publish" e o "✓ Done" ficavam fora da tela e o gestor teria de
 * descobrir um gesto para achar a ação — e com 6 cães soltos (o dia dele) a maioria ficaria escondida.
 * Aqui o contrato é o oposto: a faixa QUEBRA EM LINHAS e a contagem fica fora dela, sempre visível.
 */
it('mostra os cães sem motorista sem rolagem horizontal (nada de cão escondido)', async () => {
  const screen = await render(<DispatchBoard {...props} />);
  expect(screen.getByTestId('unassigned-pool')).toHaveStyle({ flexWrap: 'wrap' });
  // a contagem fica FORA da faixa dos chips: ela não rola junto e não desaparece ao deslizar
  expect(within(screen.getByTestId('unassigned-pool')).queryByText('1 unassigned')).toBeNull();
  expect(screen.getByText('1 unassigned')).toBeTruthy();
  expect(screen.getByLabelText('Assign Maui')).toBeTruthy();
});

it('a faixa de ações quebra em linhas em vez de esconder Publish e Done', async () => {
  const screen = await render(<DispatchBoard {...props} routes={[{ routeId: 'route', driverId: 'driver', status: 'draft', stops: [stop] }]} />);
  expect(screen.getByTestId('dispatch-actions-scroll')).toHaveStyle({ flexWrap: 'wrap' });
  expect(screen.getByLabelText('Publish Rafael route')).toBeTruthy();
});
