/**
 * DEFEITO C (03/10/2026) — ETA absurdo no cartão do Dispatch.
 *
 * Caso real: o cartão mostrou "~23322 min to Maui" com o motorista a 9.716 km das paradas. O app do
 * MOTORISTA já tratava isso ("far from your stops", teto ETA_MAXIMO_PLAUSIVEL_MIN = 240 min); o cartão
 * do GESTOR continuava mostrando o número absurdo. Aqui o cartão passa a usar O MESMO limite — sem
 * inventar regra nova de ETA.
 */
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), storage: { from: jest.fn(() => ({ createSignedUrl: jest.fn() })) } },
}));

import { render } from '@testing-library/react-native';
import { DispatchBoard, type DispatchDriver, type DispatchRoute } from '@/features/dispatch/DispatchBoard';

const drivers: DispatchDriver[] = [{ id: 'driver-maui', name: 'Maui' }];

const routes: DispatchRoute[] = [{
  routeId: 'rota-1', driverId: 'driver-maui', status: 'published',
  stops: [{
    dogId: 'dog-maui', clientName: 'Akmal', dogName: 'Maui', sequence: 1, status: 'pending',
    latitude: 37.79, longitude: -122.4, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal',
  }],
}];

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

// Motorista em São Paulo (BR), parada em San Francisco: ~10.000 km ⇒ ~24.000 min — o "23322 min" do print.
const bemLonge = { 'driver-maui': { latitude: -23.55, longitude: -46.63, updatedAt: new Date().toISOString() } };
// Motorista a ~5 km da parada: número normal.
const perto = { 'driver-maui': { latitude: 37.83, longitude: -122.4, updatedAt: new Date().toISOString() } };

const plano = (tela: Awaited<ReturnType<typeof render>>) => JSON.stringify(tela.toJSON());

it('motorista longe demais: mostra "far from your stops" em vez de minutos absurdos', async () => {
  const tela = await render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} routes={routes} driverLocations={bemLonge} {...noops} />);
  expect(plano(tela)).toContain('far from your stops');
  expect(plano(tela)).not.toMatch(/\d+ min to/);
});

it('motorista perto: continua mostrando os minutos', async () => {
  const tela = await render(<DispatchBoard date="2026-10-03" drivers={drivers} dayItems={[]} routes={routes} driverLocations={perto} {...noops} />);
  expect(plano(tela)).toMatch(/\d+ min to Maui/);
});
