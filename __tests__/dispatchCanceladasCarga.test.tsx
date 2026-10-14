jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock('@/features/calendar/dates', () => ({
  ...jest.requireActual('@/features/calendar/dates'),
  todayLocalISO: () => '2026-10-14',
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'manager' } } }) },
    from: (table: string) => {
      let selection = '';
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'single']) {
        chain[method] = (...args: unknown[]) => {
          if (method === 'select') selection = args[0] as string;
          return chain;
        };
      }
      const dog = (id: string) => ({ id, name: id, client: { id: 'owner-' + id, name: 'Owner', latitude: null, longitude: null } });
      const data = () => {
        if (table === 'organization_members') return selection === 'organization_id'
          ? [{ organization_id: 'org' }] : [{ user_id: 'driver', role: 'driver', profiles: { full_name: 'Driver' } }];
        if (table === 'reservations') return ['Active', 'Cancelled'].map(id => ({
          id, status: id === 'Active' ? 'confirmed' : 'cancelled',
          service_type: 'daycare', start_date: '2026-10-14', end_date: '2026-10-14', transport_required: true, dog: dog(id),
        }));
        if (table === 'recurring_schedules') return [{
          id: 'series', weekdays: [3], start_date: '2026-10-01', end_date: null,
          active: true, transport_required: true, dog: dog('Skipped'),
        }];
        if (table === 'recurring_exceptions') return [{
          id: 'skip', recurring_schedule_id: 'series', action: 'skip',
          start_date: '2026-10-14', end_date: '2026-10-14', reason: 'Skipped on this date',
        }];
        return [];
      };
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve);
      return chain;
    },
    rpc: jest.fn(),
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: jest.fn(),
  },
}));

import { render, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import DispatchScreen from '@/app/(tabs)/dispatch';

it('Dispatch loads cancelled reservations and skipped schedules into the pool without inflating unassigned', async () => {
  const screen = await render(<DispatchScreen />);
  await waitFor(() => expect(screen.getByText('Cancelled')).toBeTruthy());
  const pool = within(screen.getByTestId('unassigned-pool'));
  expect(pool.getByText('Active')).toBeTruthy();
  expect(pool.getByText('Cancelled in Google Calendar')).toBeTruthy();
  expect(pool.getByText('Skipped on this date')).toBeTruthy();
  for (const name of ['Cancelled', 'Skipped']) {
    expect(StyleSheet.flatten(pool.getByText(name).props.style).textDecorationLine).toBe('line-through');
    expect(screen.queryByLabelText('Assign ' + name)).toBeNull();
  }
  expect(screen.getByText('1 unassigned')).toBeTruthy();
});
