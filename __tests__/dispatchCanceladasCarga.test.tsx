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
      let status: string | undefined;
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order', 'single']) {
        chain[method] = (...args: unknown[]) => {
          if (method === 'eq' && args[0] === 'status') status = args[1] as string;
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
        })).filter(row => !status || row.status === status);
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
import DispatchScreen from '@/app/(tabs)/dispatch';
import { loadDayDogs } from '@/features/dashboard/dayService';
import { supabase } from '@/lib/supabase';

/** Trava de papel das telas do gestor: aqui o alvo é a tela, não a trava (que tem teste próprio). */
jest.mock('@/features/auth/somenteGestor', () => ({ useSomenteGestor: () => null }));

it('dispatch: confirmed-only query leaves cancelled and skipped dogs out of the operation pool', async () => {
  const screen = await render(<DispatchScreen />);
  await waitFor(() => expect(screen.getByText('Active')).toBeTruthy());
  const pool = within(screen.getByTestId('unassigned-pool'));
  expect(pool.queryByText('Cancelled')).toBeNull();
  expect(pool.queryByText('Skipped')).toBeNull();
  expect(screen.queryByText('Cancelled in Google Calendar')).toBeNull();
  expect(screen.getByText('1 unassigned')).toBeTruthy();
});

it('loadDayDogs: returns only the original dog array from confirmed reservations', async () => {
  const dogs = await loadDayDogs(supabase, 'org', '2026-10-14');
  expect(dogs.map(dog => dog.dogName)).toEqual(['Active']);
  expect(Array.isArray(dogs)).toBe(true);
});
