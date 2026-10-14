jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), storage: { from: jest.fn(() => ({ createSignedUrl: jest.fn() })) } },
}));

import { render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { DispatchBoard, type DispatchRoute } from '@/features/dispatch/DispatchBoard';

const date = '2026-10-14';
const cancelled = { dogId: 'Cancelled', dogName: 'Cancelled', clientName: 'Owner', serviceType: 'daycare' as const, reason: 'Cancelled in Google Calendar' as const };
const active = { dogId: 'Active', dogName: 'Active', clientName: 'Owner' };
const callbacks = {
  onAssign: jest.fn(), onSaveStop: jest.fn(), onRemoveStop: jest.fn(), onMoveStop: jest.fn(),
  onOptimize: jest.fn(), onPublish: jest.fn(), onUnpublish: jest.fn(), onCancelRoute: jest.fn(),
  onCompleteRoute: jest.fn(), onDateChange: jest.fn(),
};
const props = { date, drivers: [{ id: 'driver', name: 'Driver' }], dayItems: [active], routes: [] as DispatchRoute[], ...callbacks };
const route: DispatchRoute = {
  routeId: 'route', driverId: 'driver', status: 'published',
  stops: [active, cancelled].map((item, index) => ({
    ...item, sequence: index + 1, status: 'pending', latitude: null, longitude: null,
    windowStart: null, windowEnd: null, exactTime: null, priority: 'normal', travelSeconds: 600,
  })),
};


it('dispatch: published off-day stop retains the original badge, count and plain name', async () => {
  const screen = await render(<DispatchBoard {...props} routes={[route]} />);
  expect(screen.getByTestId('stop-off-day-Cancelled').props.children).toBe("Cancelled — removed from today's route");
  expect(StyleSheet.flatten(screen.getByText('Cancelled').props.style).textDecorationLine).toBeUndefined();
  expect(within(screen.getByTestId('unassigned-pool')).queryByText('Cancelled')).toBeNull();
  expect(screen.getByText('2 stops')).toBeTruthy();
  expect(screen.getByText('Pick-ups · 2 stops')).toBeTruthy();
  expect(screen.queryByText('Cancelled in Google Calendar')).toBeNull();
});
