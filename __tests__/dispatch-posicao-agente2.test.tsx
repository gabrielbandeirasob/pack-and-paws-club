/**
 * VETORES DO AGENTE2 — a linha de posição/ETA do Dispatch (melhoria 3 + correção de 25/09/2026).
 *
 * O que estes vetores travam:
 *  1. motorista SEM posição publicada → "not sharing" e **nenhum ETA** (antes aparecia "~0 min to Zara",
 *     número inventado — achado no print da org do cliente na véspera da apresentação);
 *  2. posição recente → idade legível + ETA;
 *  3. posição velha (>45 min) → aviso e ETA escondido.
 */
import { render } from '@testing-library/react-native';

// O DispatchBoard puxa ProofViewer, que importa o cliente do Supabase (exige env): no jest, mock.
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), storage: { from: jest.fn(() => ({ createSignedUrl: jest.fn() })) } },
}));

import { DispatchBoard, type DispatchDriver, type DispatchRoute } from '@/features/dispatch/DispatchBoard';

const drivers: DispatchDriver[] = [{ id: 'driver-1', name: 'Rafael' }];

const routes: DispatchRoute[] = [{
  routeId: 'rota-1',
  driverId: 'driver-1',
  status: 'published',
  stops: [{
    dogId: 'dog-zara', clientName: 'Zara kot', dogName: 'Zara', sequence: 1, status: 'pending',
    latitude: 37.44, longitude: -122.17, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal',
  }],
}];

const semAcao = {
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

async function linhaDaPosicao(driverLocations: Record<string, { latitude: number; longitude: number; updatedAt: string }>) {
  const tela = await render(
    <DispatchBoard date="2026-09-26" drivers={drivers} dayItems={[]} routes={routes} driverLocations={driverLocations} {...semAcao} />,
  );
  const textos = tela.root ? tela.toJSON() : null;
  const plano = JSON.stringify(textos);
  const achados = [...plano.matchAll(/"([^"]*(?:📍|min to|ETA hidden|position)[^"]*)"/g)].map((m) => m[1]);
  return achados.join(' | ');
}

const agoraIso = (minutosAtras: number) => new Date(Date.now() - minutosAtras * 60_000).toISOString();

it('motorista SEM posicao: diz "not sharing" e NAO inventa ETA', async () => {
  const linha = await linhaDaPosicao({});
  expect(linha).toContain('not sharing');
  expect(linha).not.toContain('min to');
});

it('posicao recente: idade legivel + ETA', async () => {
  const linha = await linhaDaPosicao({ 'driver-1': { latitude: 37.4, longitude: -122.1, updatedAt: agoraIso(5) } });
  expect(linha).toContain('5 min ago');
  expect(linha).toContain('min to Zara');
  expect(linha).not.toContain('stale');
});

it('posicao velha demais: avisa e esconde o ETA', async () => {
  const linha = await linhaDaPosicao({ 'driver-1': { latitude: 37.4, longitude: -122.1, updatedAt: agoraIso(120) } });
  expect(linha).toContain('2 h 0 min ago');
  expect(linha).toContain('position stale');
  expect(linha).toContain('ETA hidden (position too old)');
  expect(linha).not.toContain('min to Zara');
});
