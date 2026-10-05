/**
 * REDESENHO DO DISPATCH (dono, 05/10/2026) — vetores dos itens que o desenho mudou de propósito.
 *
 * Cada bloco trava um item do pedido: linha de status de atribuição (3), chips compactos (4), cartão
 * com badge de status e sem status repetido (5), van/yard compactos e o yard TOCÁVEL (6/7), hierarquia
 * de ações com overflow (8), um aviso por assunto (9), linha de parada (10), alça discreta (11),
 * "Already in van" recolhível (12), estado vazio (13), rascunho calmo (14) e `Needs update` só quando
 * o dia mudou (15). A REGRA PURA de `precisaRepublicar` tem suíte própria (`precisaRepublicar.test.ts`).
 */
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: jest.fn() } } }));

import { fireEvent, render } from '@testing-library/react-native';
import { DispatchBoard, type DispatchDriver, type DispatchRoute, type DispatchStopItem } from '@/features/dispatch/DispatchBoard';
import type { DogRef } from '@/features/calendar/dayMath';
import { colors } from '@/features/theme/tokens';

const RAFAEL: DispatchDriver = { id: 'm-rafael', name: 'Rafael', alsoManager: true };

const dog = { dogId: 'd-rani', clientName: 'Amy', dogName: 'Rani' };
const dogRosie = { dogId: 'd-rosie', clientName: 'Sam', dogName: 'Rosie' };

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

const parada = (dogId: string, dogName: string, extra: Partial<DispatchRoute['stops'][number]> = {}) => ({
  dogId, clientName: 'Amy', dogName, sequence: 1, status: 'pending' as const,
  latitude: 37.8, longitude: -122.4, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const,
  ...extra,
});

const rota = (over: Partial<DispatchRoute> = {}): DispatchRoute => ({
  routeId: 'r-1', driverId: RAFAEL.id, status: 'draft',
  stops: [parada('d-rani', 'Rani'), parada('d-rosie', 'Rosie', { sequence: 2 })],
  ...over,
});

/* ---------------------------------- item 3 ---------------------------------- */
describe('item 3 — linha de status de atribuição', () => {
  it('tudo atribuído: `✓ All dogs assigned` + `+ Add dog`', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ stops: [parada('d-rani', 'Rani')] })]} {...noops} onAddExtraDog={jest.fn()} />);
    expect(screen.getByText('✓ All dogs assigned')).toBeTruthy();
    expect(screen.getByText('+ Add dog')).toBeTruthy();
    expect(screen.queryByText('Every transport dog is assigned. 🎉')).toBeNull();
  });

  it('com pendência: `1 unassigned` + o chip do cão', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]} routes={[]} {...noops} />);
    expect(screen.getByText('1 unassigned')).toBeTruthy();
    expect(screen.getByLabelText('Assign Rani')).toBeTruthy();
  });
});

/* ---------------------------------- item 4 ---------------------------------- */
describe('item 4 — chips de motorista compactos e roláveis', () => {
  const quemFala = (n: string): DispatchDriver[] => [
    { id: 'raphael', name: 'Raphael' }, { id: 'john', name: 'John' },
    { id: 'gabriel', name: 'Gabriel', alsoManager: true },
  ];

  it('mostra `Nome contagem` sempre (inclusive 0) e SEM "manager" no chip', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={quemFala('x')} dayItems={[]}
      routes={[{ routeId: 'r', driverId: 'gabriel', status: 'draft', stops: [parada('d-rani', 'Rani')] }]} {...noops} />);
    expect(screen.getByText('Raphael 0')).toBeTruthy();
    expect(screen.getByText('Gabriel 1')).toBeTruthy();
    expect(screen.queryByText(/manager/)).toBeNull();
  });

  it('a faixa rola na horizontal sem indicador', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={quemFala('x')} dayItems={[]} routes={[]} {...noops} />);
    const linha = screen.getByTestId('dispatch-linha-motoristas');
    expect(linha.props.horizontal).toBe(true);
    expect(linha.props.showsHorizontalScrollIndicator).toBe(false);
  });
});

/* ---------------------------------- item 5 ---------------------------------- */
describe('item 5 — cartão do motorista', () => {
  it('badge de status compacto e status NÃO repetido', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog, dogRosie]}
      routes={[rota({ status: 'published' })]} {...noops} />);
    expect(screen.getByTestId('driver-status-badge')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText('2 stops')).toBeTruthy();
    // Não existe mais o sufixo " · Published" no subtítulo.
    expect(screen.queryByText(/· Published/)).toBeNull();
  });
});

/* ---------------------------------- item 5/14 ------------------------------- */
describe('item 14 — rascunho calmo', () => {
  it('badge `Draft` + linha `Not visible to driver yet`, sem bloco', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog, dogRosie]}
      routes={[rota({ status: 'draft' })]} {...noops} />);
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByTestId('driver-draft-badge')).toBeTruthy();
    expect(screen.getByText('Not visible to driver yet')).toBeTruthy();
  });
});

/* ---------------------------------- item 8 ---------------------------------- */
describe('item 8 — hierarquia de ações e overflow', () => {
  it('primário `Optimize route` e secundário `Suggest` na linha; o resto no `•••`', async () => {
    const onOpenStopList = jest.fn();
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog, dogRosie]}
      routes={[rota({ status: 'published' })]} {...noops} onSuggestRoutes={jest.fn()} onApplySuggestion={jest.fn()} onOpenStopList={onOpenStopList} />);
    expect(screen.getByLabelText('Optimize Rafael route')).toBeTruthy();
    expect(screen.getByText('Optimize route')).toBeTruthy();
    expect(screen.getByLabelText('Suggest routes')).toBeTruthy();
    // Unpublish/Done/Cancel NÃO ficam na linha — vivem no overflow.
    expect(screen.queryByLabelText('Unpublish Rafael route')).toBeNull();
    expect(screen.queryByLabelText('Complete Rafael route')).toBeNull();
    expect(screen.queryByLabelText('Cancel Rafael route')).toBeNull();

    await fireEvent.press(screen.getByLabelText('More actions for Rafael'));
    expect(screen.getByLabelText('Stop list for Rafael')).toBeTruthy();
    expect(screen.getByText('Edit times')).toBeTruthy();
    expect(screen.getByLabelText('Unpublish Rafael route')).toBeTruthy();
    expect(screen.getByLabelText('Complete Rafael route')).toBeTruthy();
    expect(screen.getByText('✓ Done')).toBeTruthy();
    expect(screen.getByLabelText('Cancel Rafael route')).toBeTruthy();
    expect(screen.getByText('Cancel route')).toBeTruthy();
  });

  it('publicada NÃO sobe ação de publicar (o motorista já vê as paradas ao vivo)', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog, dogRosie]}
      routes={[rota({ status: 'published', stops: [parada('d-cancelado', 'Scarlet')] })]} {...noops} />);
    expect(screen.queryByLabelText('Republish Rafael route')).toBeNull();
    expect(screen.queryByText('Republish changes')).toBeNull();
    expect(screen.queryByLabelText('Publish Rafael route')).toBeNull();
    // O overflow também não oferece republicar (só Edit times / Unpublish / Done / Cancel).
    await fireEvent.press(screen.getByLabelText('More actions for Rafael'));
    expect(screen.queryByText('Republish')).toBeNull();
    expect(screen.getByLabelText('Unpublish Rafael route')).toBeTruthy();
  });
});

/* ---------------------------------- item 7 ---------------------------------- */
describe('item 7 — yard tocável (grava routes.end_location_id)', () => {
  const VAN = { id: 'v1', name: 'Van 1', isDefault: true, kind: 'van' as const };
  const YARD_A = { id: 'ya', name: 'Main Yard', isDefault: true, kind: 'yard' as const, address: '1089 Memorex Dr' };
  const YARD_B = { id: 'yb', name: 'North Yard', isDefault: false, kind: 'yard' as const, address: '44 North St' };

  it('com 2+ yards, o yard é um radio e o toque chama onChooseYard', async () => {
    const onChooseYard = jest.fn().mockResolvedValue(undefined);
    const onChooseVan = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ stops: [parada('d-rani', 'Rani')] })]} {...noops}
      vans={[VAN, YARD_A, YARD_B]} onChooseVan={onChooseVan} onChooseYard={onChooseYard} />);
    expect(screen.getByTestId('driver-yard-m-rafael')).toBeTruthy();
    expect(screen.getByLabelText('Use Main Yard for Rafael').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByLabelText('Use North Yard for Rafael'));
    expect(onChooseYard).toHaveBeenCalledWith('m-rafael', 'yb');
    expect(onChooseVan).not.toHaveBeenCalled();
  });

  it('com 1 yard o chip é informativo (sem seletor)', async () => {
    const onChooseYard = jest.fn();
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ stops: [parada('d-rani', 'Rani')] })]} {...noops}
      vans={[VAN, YARD_A]} onChooseVan={jest.fn()} onChooseYard={onChooseYard} />);
    expect(screen.getByText('Main Yard · 1089 Memorex Dr')).toBeTruthy();
    expect(screen.queryByLabelText('Use Main Yard for Rafael')).toBeNull();
    fireEvent.press(screen.getByText('Main Yard · 1089 Memorex Dr'));
    expect(onChooseYard).not.toHaveBeenCalled();
  });
});

/* ---------------------------------- item 10 --------------------------------- */
describe('item 10 — linha de parada escaneável', () => {
  it('número · nome · hora planejada · deslocamento gravado · ⋯', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ stops: [parada('d-rani', 'Rani', { windowStart: '09:10', windowEnd: '10:10', travelSeconds: 720 })] })]} {...noops} />);
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Rani')).toBeTruthy();
    expect(screen.getByText('9:10 AM')).toBeTruthy();
    expect(screen.getByText('12 min away')).toBeTruthy();
    expect(screen.getByLabelText('Options for Rani')).toBeTruthy();
  });

  it('não inventa deslocamento quando o Optimize nunca gravou', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ stops: [parada('d-rani', 'Rani')] })]} {...noops} />);
    expect(screen.queryByText(/min away/)).toBeNull();
  });
});

/* ---------------------------------- item 9 ---------------------------------- */
describe('item 9 — um aviso por assunto', () => {
  it('contador compacto no topo e o detalhe só na linha da parada', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ status: 'published', stops: [parada('d-cancelado', 'Scarlet')] })]} {...noops} />);
    expect(screen.getByText('⚠ 1 booking changed')).toBeTruthy();
    expect(screen.getByText("Cancelled — removed from today's route")).toBeTruthy();
    // A frase longa antiga NÃO repete no topo.
    expect(screen.queryByText(/no longer in today's day/)).toBeNull();
  });
});

/* ------------- republicação: REMOVIDA (dono, 05/10/2026) ------------- */
describe('sem `Needs update` / `Republish changes` — o motorista lê as paradas AO VIVO', () => {
  it('publicada com parada cancelada: badge `Published` + `⚠ 1 booking changed`, e NENHUM republish', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ status: 'published', stops: [parada('d-rani', 'Rani'), parada('d-cancelado', 'Scarlet', { sequence: 2 })] })]} {...noops} />);
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByTestId('driver-status-badge')).toBeTruthy();
    expect(screen.getByText('⚠ 1 booking changed')).toBeTruthy();
    expect(screen.queryByText('Needs update')).toBeNull();
    expect(screen.queryByText(/unpublished change/)).toBeNull();
    expect(screen.queryByLabelText('Republish Rafael route')).toBeNull();
    expect(screen.queryByText('Republish changes')).toBeNull();
  });

  it('publicada sem mudança: badge `Published` e nenhum convite a republicar', async () => {
    const paradas = [parada('d-rani', 'Rani'), parada('d-rosie', 'Rosie', { sequence: 2 })];
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog, dogRosie]}
      routes={[rota({ status: 'published', stops: paradas })]} {...noops} />);
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.queryByText('Needs update')).toBeNull();
    expect(screen.queryByLabelText('Republish Rafael route')).toBeNull();
  });

  it('rascunho continua publicando pelo caminho normal (`Publish route`)', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ status: 'draft' })]} {...noops} />);
    expect(screen.getByLabelText('Publish Rafael route')).toBeTruthy();
    expect(screen.getByText('Publish route')).toBeTruthy();
  });
});

/* ---------------------------------- item 11 -------------------------------- */
describe('item 11 — alça de arrasto discreta', () => {
  it('em repouso a alça é `muted` (não compete com a linha)', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog, dogRosie]}
      routes={[rota({ status: 'draft' })]} {...noops} />);
    expect(screen.getByTestId('grip-pickup-d-rani', { includeHiddenElements: true })).toHaveStyle({ color: colors.muted });
  });
});

/* ---------------------------------- item 12 -------------------------------- */
describe('item 12 — "Already in van" recolhível', () => {
  it('linha discreta com a contagem; expande a lista no toque', async () => {
    const dayItems: DispatchStopItem[] = [{ ...dog, inVan: true, reservationKind: 'boarding' }];
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={dayItems} routes={[]} {...noops} />);
    expect(screen.getByTestId('dispatch-ja-na-van')).toBeTruthy();
    expect(screen.getByText('Already in van')).toBeTruthy();
    expect(screen.queryByTestId('boarding-na-van-d-rani')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Show boarding dogs already in the van'));
    expect(screen.getByTestId('boarding-na-van-d-rani')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Hide boarding dogs already in the van'));
    expect(screen.queryByTestId('boarding-na-van-d-rani')).toBeNull();
  });
});

/* ---------------------------------- item 13 -------------------------------- */
describe('item 13 — estado vazio do motorista', () => {
  it('sem paradas: `No stops assigned` + `Suggest assignments` + atribuir à mão', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]} routes={[]}
      {...noops} onSuggestRoutes={jest.fn()} onApplySuggestion={jest.fn()} onAddExtraDog={jest.fn()}
      dogs={[{ id: 'd', dogName: 'Rani', clientName: 'Amy' } as DogRef]} />);
    expect(screen.getByText('No stops assigned')).toBeTruthy();
    expect(screen.getByText('Suggest assignments')).toBeTruthy();
    expect(screen.getByLabelText('Add a dog by hand')).toBeTruthy();
    expect(screen.getByTestId('dispatch-route-m-rafael-pickup')).toBeTruthy();
  });
});

/* --------------------------- POLIMENTO (05/10/2026) ------------------------ */
describe('polimento — sem repetir estado, cartão compacto, modal do stale', () => {
  it('rascunho: `Draft` + `Not visible to driver yet` e NENHUM botão `Draft only`', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ status: 'draft' })]} {...noops} />);
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Not visible to driver yet')).toBeTruthy();
    expect(screen.queryByText('Draft only')).toBeNull();
    expect(screen.getByLabelText('Publish Rafael route')).toBeTruthy();
  });

  it('van e yard dividem a MESMA linha de recursos', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ status: 'draft' })]}
      vans={[{ id: 'v1', name: 'Van 1', isDefault: true, kind: 'van' }, { id: 'v2', name: 'Van 2', isDefault: false, kind: 'van' }, { id: 'y1', name: 'Main Yard', isDefault: false, kind: 'yard', address: '1089 Memorex Drive' }]}
      onChooseVan={jest.fn()} onChooseYard={jest.fn()} {...noops} />);
    expect(screen.getByTestId('driver-van-m-rafael').parent).toBe(screen.getByTestId('driver-yard-m-rafael').parent);
  });

  it('"Already in van" explica em UMA linha curta', async () => {
    const dayItems: DispatchStopItem[] = [{ ...dog, inVan: true, reservationKind: 'boarding' }];
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={dayItems} routes={[]} {...noops} />);
    await fireEvent.press(screen.getByLabelText('Show boarding dogs already in the van'));
    expect(screen.getByText('Dogs already riding in the van and not included as route stops.')).toBeTruthy();
    expect(screen.queryByText(/finish it there too/)).toBeNull();
  });

  it('rota mudada: modal do app com `Reload` no verde escuro', async () => {
    const onReloadRotas = jest.fn();
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]} routes={[]}
      avisoRotaMudou onReloadRotas={onReloadRotas} {...noops} />);
    expect(screen.getByText('Route changed on another device')).toBeTruthy();
    expect(screen.getByText('This route was updated elsewhere. Reload to see the latest version.')).toBeTruthy();
    const botao = screen.getByLabelText('Reload');
    expect(botao).toHaveStyle({ backgroundColor: colors.forest700 });
    await fireEvent.press(botao);
    expect(onReloadRotas).toHaveBeenCalledTimes(1);
  });

  it('com o aviso aceso o menu de overflow NÃO monta (nunca dois modais)', async () => {
    const screen = await render(<DispatchBoard date="2026-10-05" drivers={[RAFAEL]} dayItems={[dog]}
      routes={[rota({ status: 'published' })]} avisoRotaMudou onReloadRotas={jest.fn()} {...noops} />);
    expect(screen.getByLabelText('Reload')).toBeTruthy();
    // Mesmo tocando no `•••`, o menu não entra em cena enquanto o aviso está aceso: só um Modal existe.
    await fireEvent.press(screen.getByLabelText('More actions for Rafael'));
    expect(screen.queryByLabelText('Unpublish Rafael route')).toBeNull();
    expect(screen.getByLabelText('Reload')).toBeTruthy();
  });
});
