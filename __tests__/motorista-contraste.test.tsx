/**
 * LEGIBILIDADE E CONTRASTE — os achados MÉDIOS da vistoria (02/10/2026).
 *
 * O projeto adotou 4,5:1 (WCAG AA para texto pequeno) como piso e ≥12 px como legenda mínima. Estes
 * vetores TRAVAM cada correção de cor/tamanho para que uma edição futura não reintroduza o defeito:
 *   - M1: o "eyebrow" (NEXT STOP / JOURNEY) sobre o papel era DOURADO (2,27:1) — agora verde escuro;
 *   - M2: o rótulo de aba INATIVO era #7C877E a 9,5 px (3,67:1) — agora colors.muted a 12 px;
 *   - M3: o chip "Pending" era BRANCO sobre dourado, 10 px (2,31:1) — agora forest900 a 12 px;
 *   - M4: o selo verde de status usava #4E8D5C (3,91:1) — agora colors.success #2F773D.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

import { NextStopCard } from '@/features/driver/NextStopCard';
import { ShiftCard } from '@/features/driver/ShiftCard';
import { DriverRouteView, type DriverStop } from '@/features/driver/DriverRouteView';
import AssignedScreen from '@/app/(tabs)/assigned';
import TabLayout from '@/app/(tabs)/_layout';
import { colors } from '@/features/theme/tokens';

const capturado: { screenOptions: Record<string, any> | null } = { screenOptions: null };

jest.mock('expo-router', () => {
  const Tabs = (props: { screenOptions?: Record<string, any> }) => {
    capturado.screenOptions = props.screenOptions ?? null;
    return null;
  };
  Tabs.Screen = () => null;
  return {
    Tabs,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    // A tela "Assigned" carrega no foco: aqui o efeito roda como um useEffect.
    useFocusEffect: (callback: () => void | (() => void)) => {
      (require('react') as typeof React).useEffect(() => {
        const cleanup = callback();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, []);
    },
  };
});

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', email: 'a@b.test' } } }),
}));

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'driver', view: 'driver', isLoading: false, reload: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => {
  const routeStops = [
    { id: 'st1', sequence: 1, dropoff_sequence: null, status: 'pending', dog: { name: 'Bob', client: { name: 'Maria', address_line_1: '1 St', city: 'Palo Alto' } } },
  ];
  const builder: Record<string, unknown> = {};
  const mesmo = () => builder;
  for (const metodo of ['select', 'eq', 'order', 'limit', 'gte', 'lte']) builder[metodo] = mesmo;
  builder.maybeSingle = mesmo;
  builder.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: [{ id: 'r1', route_stops: routeStops }], error: null }).then(res);
  return { supabase: { from: () => builder, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } } };
});

function parada(over: Partial<DriverStop> = {}): DriverStop {
  return { id: 's1', sequence: 1, status: 'pending', clientName: 'Maria', dogName: 'Bob', address: '1 St', city: null, instructions: null, ...over };
}

describe('M1 — rótulo do topo sobre o papel (dourado 2,27:1 -> verde escuro)', () => {
  it('NEXT STOP e JOURNEY usam colors.forest700', async () => {
    const card = await render(
      <NextStopCard stop={parada()} nextAction="arrived" onNavigate={jest.fn()} onAction={jest.fn()} />,
    );
    expect(StyleSheet.flatten(card.getByText('NEXT STOP').props.style).color).toBe(colors.forest700);

    const jornada = await render(
      <ShiftCard
        state={{ kind: 'none', source: 'none', startedAt: null, endedAt: null, minutes: 0, manualOpen: false }}
        onClockIn={jest.fn()}
        onClockOut={jest.fn()}
      />,
    );
    expect(StyleSheet.flatten(jornada.getByText('JOURNEY').props.style).color).toBe(colors.forest700);
  });
});

describe('M4 — selo de status verde legível', () => {
  it('o selo "Delivered" usa colors.success (#2F773D), não o #4E8D5C antigo', async () => {
    // completed + deliveredAt = parada entregue -> selo "Delivered".
    const tela = await render(
      <DriverRouteView stops={[parada({ status: 'completed', deliveredAt: '2026-10-01T21:05:00.000Z' })]} onAction={jest.fn()} />,
    );
    expect(StyleSheet.flatten(tela.getByText('Delivered').props.style).color).toBe(colors.success);
    expect(colors.success).toBe('#2F773D');
  });
});

describe('M3 — chip "Pending" legível sobre o dourado', () => {
  it('texto forest900 em 12 px (era branco 10 px a 2,31:1)', async () => {
    const tela = await render(<AssignedScreen />);
    await waitFor(() => expect(tela.getByText('Pending')).toBeTruthy());
    const estilo = StyleSheet.flatten(tela.getByText('Pending').props.style);
    expect(estilo.color).toBe(colors.forest900);
    expect(estilo.fontSize).toBe(12);
  });
});

describe('M2 — rótulo de aba inativo legível', () => {
  it('inativo usa colors.muted e o rótulo sobe para 12 px (era #7C877E a 9,5)', async () => {
    await render(<TabLayout />);
    expect(capturado.screenOptions?.tabBarInactiveTintColor).toBe(colors.muted);
    expect(capturado.screenOptions?.tabBarLabelStyle?.fontSize).toBe(12);
  });
});

describe('B1 — legendas com pelo menos 12 px', () => {
  it('o eyebrow do cabeçalho do Assigned subiu de 10 para 12 px', async () => {
    const tela = await render(<AssignedScreen />);
    await waitFor(() => expect(tela.getByText('PACK & PAWS CLUB · DRIVER')).toBeTruthy());
    expect(StyleSheet.flatten(tela.getByText('PACK & PAWS CLUB · DRIVER').props.style).fontSize).toBe(12);
  });
});
