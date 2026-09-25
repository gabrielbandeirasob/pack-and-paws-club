/**
 * VETORES DO AGENTE2 — SEDE/VAN DA ORGANIZAÇÃO + TRAVA DO CLOCK IN (itens 1 e 2 do documento
 * de pedidos da operação, áudios de 25/09/2026).
 *
 * O que este arquivo prova:
 *  - a TRAVA É OPT-IN: sem sede cadastrada o clock in continua liberado de qualquer lugar — o
 *    comportamento de quem já está em produção não muda (caso c);
 *  - com sede, motorista LONGE não grava nada em `driver_shifts` e recebe o motivo em PT-BR (caso a);
 *  - com sede, motorista NO RAIO grava normalmente (caso b);
 *  - sem localização (web, permissão negada, GPS sem fix) NÃO trava — o motorista não fica sem
 *    conseguir trabalhar — mas é avisado de que não deu para conferir (caso d);
 *  - a jornada DEDUZIDA passa a começar na van quando a chegada à van é conhecida;
 *  - a migração 034 cria a sede com raio default de 300 m, UMA padrão por organização e leitura
 *    liberada para o motorista (sem ela a trava não teria como funcionar).
 *
 * Todos os números são explícitos e determinísticos: as distâncias vêm de coordenadas fixas
 * (1 grau de latitude ≈ 111 km, mesmo meridiano), nada aqui depende de GPS de verdade.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  SEM_POSICAO_MENSAGEM,
  VAN_RADIUS_DEFAULT_METERS,
  clockInGate,
  distanceText,
  estaNaVan,
  loadVanLocationForDriver,
  locationDraftError,
  parseCoordinate,
  parseRadius,
  saveOrganizationLocation,
  vanLocationForRoute,
  type OrganizationLocation,
} from '@/features/organization/locations';
import { deduceShift, shiftState, type StopMilestones } from '@/features/driver/shift';

/* ------------------------------------------------------------------ *
 * FIXTURES (coordenadas fixas: nada de GPS real)
 * ------------------------------------------------------------------ */

/** Van em (37, -122); o motorista longe está 0,0288° ao norte ≈ 3,2 km. */
const VAN: OrganizationLocation = {
  id: 'v1',
  name: 'Van — Palo Alto',
  kind: 'van',
  addressLine1: '1 Van Way',
  city: 'Palo Alto',
  latitude: 37,
  longitude: -122,
  radiusMeters: 300,
  isDefault: true,
};

const LONGE = { latitude: 37.0288, longitude: -122 };
const NA_VAN = { latitude: 37.0025, longitude: -122 };

const parada = (over: Partial<StopMilestones> & { id: string }): StopMilestones => ({
  sequence: 1,
  status: 'pending',
  arrivedAt: null,
  pickedUpAt: null,
  completedAt: null,
  skippedAt: null,
  ...over,
});

describe('(a) com sede cadastrada e motorista LONGE, o clock in não acontece e o motivo explica', () => {
  it('recusa a 3,2 km com a mensagem e a distância em PT-BR', () => {
    const trava = clockInGate({ location: VAN, position: LONGE });

    expect(trava.allowed).toBe(false);
    expect(trava.kind).toBe('outside');
    expect(trava.distanceKm).toBeCloseTo(3.2, 1);
    expect(trava.message).toBe(
      'Você está a 3,2 km da van "Van — Palo Alto" — o ponto abre quando você chegar (raio de 300 m).',
    );
    expect(trava.radiusMeters).toBe(300);
  });

  it('o raio é uma borda dura: 300 m passa, 320 m não passa', () => {
    // 0,0027° de latitude ≈ 300,2 m — logo fora do raio de 300 m.
    expect(clockInGate({ location: VAN, position: { latitude: 37.0027, longitude: -122 } }).allowed).toBe(false);
    // 0,0025° ≈ 278 m — dentro.
    expect(clockInGate({ location: VAN, position: NA_VAN }).allowed).toBe(true);
  });
});

describe('(b) com sede cadastrada e motorista NO RAIO, o clock in acontece', () => {
  it('libera dentro do raio e não inventa motivo', () => {
    const trava = clockInGate({ location: VAN, position: NA_VAN });

    expect(trava.allowed).toBe(true);
    expect(trava.kind).toBe('inside');
    expect(trava.distanceKm).toBeCloseTo(0.28, 2);
    expect(trava.message).toBeNull();
    expect(estaNaVan(VAN, NA_VAN)).toBe(true);
  });

  it('o raio cadastrado manda: 500 m abre mais longe do que 100 m', () => {
    const motorista = { latitude: 37.0025, longitude: -122 }; // ≈ 278 m
    expect(clockInGate({ location: { ...VAN, radiusMeters: 100 }, position: motorista }).allowed).toBe(false);
    expect(clockInGate({ location: { ...VAN, radiusMeters: 500 }, position: motorista }).allowed).toBe(true);
  });
});

describe('(c) SEM sede cadastrada o comportamento é o de hoje (opt-in)', () => {
  it('não bloqueia nem de longe — nada de pergunta sobre van', () => {
    const trava = clockInGate({ location: null, position: LONGE });

    expect(trava.allowed).toBe(true);
    expect(trava.kind).toBe('no-location');
    expect(trava.message).toBeNull();
    expect(trava.distanceKm).toBeNull();
  });

  it('organização sem nenhuma sede não tem alvo de trava', () => {
    expect(vanLocationForRoute([], null)).toBeNull();
    expect(vanLocationForRoute([], 'v1')).toBeNull();
  });
});

describe('(d) SEM localização o app não trava — só avisa que não deu para conferir', () => {
  it('posição ausente (web/permissão negada) libera com aviso', () => {
    const trava = clockInGate({ location: VAN, position: null });

    expect(trava.allowed).toBe(true);
    expect(trava.kind).toBe('no-position');
    expect(trava.message).toBe(SEM_POSICAO_MENSAGEM);
    expect(trava.distanceKm).toBeNull();
  });

  it('GPS sem fix (0,0) conta como sem posição, não como "no meio do oceano"', () => {
    expect(clockInGate({ location: VAN, position: { latitude: 0, longitude: 0 } }).kind).toBe('no-position');
    expect(clockInGate({ location: VAN, position: { latitude: NaN, longitude: -122 } }).kind).toBe('no-position');
  });
});

describe('qual sede vale para a rota', () => {
  const yard: OrganizationLocation = { ...VAN, id: 'v2', name: 'Yard', kind: 'yard', isDefault: false };

  it('a sede escolhida NA ROTA ganha da padrão', () => {
    expect(vanLocationForRoute([VAN, yard], 'v2')?.id).toBe('v2');
  });

  it('sem escolha na rota, vale a padrão', () => {
    expect(vanLocationForRoute([yard, VAN], null)?.id).toBe('v1');
  });

  it('uma sede só, sem padrão marcado, ainda é a van (caso normal)', () => {
    expect(vanLocationForRoute([{ ...VAN, isDefault: false }], null)?.id).toBe('v1');
  });

  it('duas sedes e nenhuma padrão = sem alvo (melhor não travar do que travar na van errada)', () => {
    expect(vanLocationForRoute([{ ...VAN, isDefault: false }, { ...yard, isDefault: false }], null)).toBeNull();
  });

  it('rota apontando para uma sede inexistente cai na padrão', () => {
    expect(vanLocationForRoute([VAN, yard], 'apagada')?.id).toBe('v1');
  });
});

describe('número que o motorista lê', () => {
  it('metros abaixo de 1 km, vírgula decimal acima', () => {
    expect(distanceText(0.278)).toBe('280 m');
    expect(distanceText(3.2024)).toBe('3,2 km');
    expect(distanceText(0)).toBe('0 m');
    expect(distanceText(Number.NaN)).toBe('0 m');
  });
});

describe('a jornada deduzida passa a começar na VAN', () => {
  const rota: StopMilestones[] = [
    parada({ id: 's1', sequence: 1, status: 'completed', arrivedAt: '2026-09-25T11:10:00Z', completedAt: '2026-09-25T11:40:00Z' }),
    parada({ id: 's2', sequence: 2, status: 'arrived', arrivedAt: '2026-09-25T13:00:00Z' }),
  ];

  it('sem chegada à van observada, a dedução é a de sempre (primeira parada)', () => {
    expect(deduceShift(rota)?.startedAt).toBe('2026-09-25T11:10:00.000Z');
    expect(deduceShift(rota, null)?.startedAt).toBe('2026-09-25T11:10:00.000Z');
  });

  it('com a chegada à van, a jornada começa nela', () => {
    expect(deduceShift(rota, '2026-09-25T10:32:00Z')?.startedAt).toBe('2026-09-25T10:32:00.000Z');
  });

  it('sede cadastrada e nenhuma parada ainda: a jornada já está aberta desde a van', () => {
    const estado = shiftState([parada({ id: 's1' })], [], new Date('2026-09-25T11:02:00Z'), {
      vanArrivalAt: '2026-09-25T10:32:00Z',
    });
    expect(estado.kind).toBe('open');
    expect(estado.source).toBe('route');
    expect(estado.startedAt).toBe('2026-09-25T10:32:00.000Z');
    expect(estado.minutes).toBe(30);
  });

  it('organização sem sede (sem vanArrivalAt) não perde a jornada que a rota conta', () => {
    const estado = shiftState(rota, [], new Date('2026-09-25T13:30:00Z'));
    expect(estado.source).toBe('route');
    expect(estado.startedAt).toBe('2026-09-25T11:10:00.000Z');
    expect(estado.endedAt).toBe('2026-09-25T11:40:00.000Z');
  });
});

describe('formulário do gestor (validação pura)', () => {
  const base = { name: 'Van — Palo Alto', kind: 'van' as const, addressLine1: '1 Van Way', city: 'Palo Alto', latitude: '', longitude: '', radiusMeters: '300', isDefault: true };

  it('exige nome e um lugar (endereço OU coordenada)', () => {
    expect(locationDraftError({ ...base, name: '' })).toContain('name');
    expect(locationDraftError({ ...base, addressLine1: '' })).toContain('address or the coordinates');
    expect(locationDraftError({ ...base, addressLine1: '', latitude: '37', longitude: '-122' })).toBeNull();
  });

  it('recusa meia coordenada, "Null Island" e raio fora da faixa', () => {
    expect(locationDraftError({ ...base, latitude: '37' })).toContain('both latitude and longitude');
    expect(locationDraftError({ ...base, latitude: '0', longitude: '0' })).toContain('0,0');
    expect(locationDraftError({ ...base, radiusMeters: '10' })).toContain('between 25 and 5000');
    expect(locationDraftError({ ...base, radiusMeters: 'abc' })).toContain('between 25 and 5000');
    expect(locationDraftError({ ...base, radiusMeters: '' })).toBeNull();
  });

  it('aceita vírgula decimal (teclado brasileiro) e o raio default', () => {
    expect(parseCoordinate('37,7749')).toBeCloseTo(37.7749, 4);
    expect(parseCoordinate('-122.4194')).toBeCloseTo(-122.4194, 4);
    expect(parseCoordinate('')).toBeNull();
    expect(parseCoordinate('37.77.49')).toBeNull();
    expect(parseRadius('')).toBe(VAN_RADIUS_DEFAULT_METERS);
    expect(parseRadius('250,5')).toBe(251);
  });
});

/* ------------------------------------------------------------------ *
 * MIGRAÇÃO 034 — o que precisa existir no banco para a trava funcionar
 * ------------------------------------------------------------------ */

describe('migração 034 (sede da organização)', () => {
  const sql = require('node:fs').readFileSync(
    require('node:path').join(process.cwd(), 'supabase/migrations/202609250034_local_da_organizacao.sql'),
    'utf8',
  ) as string;

  it('cria a sede com raio default de 300 m e coordenada validada', () => {
    expect(sql).toContain('create table if not exists public.organization_locations');
    expect(sql).toMatch(/radius_meters integer not null default 300/);
    expect(sql).toContain('organization_locations_raio_ok');
    expect(sql).toContain('organization_locations_coordenada_ok');
  });

  it('permite mais de uma sede, mas UMA padrão por organização', () => {
    expect(sql).toMatch(/create unique index if not exists organization_locations_uma_padrao[\s\S]*?where is_default/);
    expect(sql).toContain('is_default boolean not null default false');
  });

  it('o motorista LÊ a sede e só o gestor escreve (sem isso não haveria trava possível)', () => {
    expect(sql).toMatch(/create policy organization_locations_member_read[\s\S]*?public\.is_org_member\(organization_id\)/);
    expect(sql).toMatch(/create policy organization_locations_manager_all[\s\S]*?public\.is_org_manager\(organization_id\)/);
    expect(sql).toMatch(/with check \(public\.is_org_manager\(organization_id\)\)/);
    expect(sql).toContain('revoke all on public.organization_locations from anon');
  });

  it('a rota ganha início e fim de sede NULÁVEIS (nada do que já existe muda)', () => {
    expect(sql).toMatch(/add column if not exists start_location_id uuid references public\.organization_locations\(id\) on delete set null/);
    expect(sql).toMatch(/add column if not exists end_location_id uuid references public\.organization_locations\(id\) on delete set null/);
  });

  it('troca da sede padrão é uma transação só, e só o gestor pode chamar', () => {
    expect(sql).toContain('create or replace function public.set_default_organization_location');
    expect(sql).toMatch(/grant execute on function public\.set_default_organization_location\(uuid\) to authenticated/);
    expect(sql).toMatch(/revoke all on function public\.set_default_organization_location\(uuid\) from public, anon/);
  });
});

/* ------------------------------------------------------------------ *
 * SERVIÇO (o que o app grava/lê) — com o banco mockado
 * ------------------------------------------------------------------ */

const mockEstado: {
  insercoes: { tabela: string; payload: Record<string, unknown> }[];
  atualizacoes: { tabela: string; payload: Record<string, unknown> }[];
  rpcs: { nome: string; params: Record<string, unknown> }[];
  sedes: Record<string, unknown>[];
  erroSedes: boolean;
} = { insercoes: [], atualizacoes: [], rpcs: [], sedes: [], erroSedes: false };

jest.mock('@/lib/supabase', () => {
  const dados = (tabela: string) => {
    if (tabela === 'routes') return [ROTA];
    if (tabela === 'organization_locations') return mockEstado.erroSedes ? null : mockEstado.sedes;
    return [];
  };
  const cadeia = (tabela: string) => {
    const chain: Record<string, unknown> = { __tabela: tabela };
    const mesmo = () => chain;
    chain.select = mesmo;
    chain.eq = mesmo;
    chain.gte = mesmo;
    chain.lt = mesmo;
    chain.lte = mesmo;
    chain.order = mesmo;
    chain.limit = mesmo;
    chain.maybeSingle = mesmo;
    chain.insert = (payload: Record<string, unknown>) => {
      mockEstado.insercoes.push({ tabela, payload });
      chain.__payload = payload;
      return chain;
    };
    chain.update = (payload: Record<string, unknown>) => {
      mockEstado.atualizacoes.push({ tabela, payload });
      return chain;
    };
    chain.upsert = () => Promise.resolve({ error: null });
    chain.delete = mesmo;
    chain.single = () => Promise.resolve({ data: { id: 'novo', ...(chain.__payload as Record<string, unknown> ?? {}) }, error: null });
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: dados(tabela), error: mockEstado.erroSedes ? { message: 'sem permissão' } : null }).then(res);
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'driver-1' } } }) },
      from: (tabela: string) => cadeia(tabela),
      rpc: async (nome: string, params: Record<string, unknown>) => {
        mockEstado.rpcs.push({ nome, params });
        return { data: null, error: null };
      },
      channel: () => ({ on: () => ({ on: () => ({ subscribe: () => undefined }), subscribe: () => undefined }) }),
      removeChannel: () => undefined,
    },
  };
});

describe('serviço das sedes', () => {
  beforeEach(() => {
    mockEstado.insercoes.length = 0;
    mockEstado.atualizacoes.length = 0;
    mockEstado.rpcs.length = 0;
    mockEstado.sedes = [];
    mockEstado.erroSedes = false;
  });

  it('nunca grava is_default na mão: quem troca a padrão é a função do banco', async () => {
    await saveOrganizationLocation(require('@/lib/supabase').supabase, {
      organizationId: 'org-1',
      name: 'Van — Palo Alto',
      kind: 'van',
      addressLine1: '1 Van Way',
      city: 'Palo Alto',
      latitude: 37,
      longitude: -122,
      radiusMeters: 300,
      isDefault: true,
    });

    expect(mockEstado.insercoes).toHaveLength(1);
    expect(mockEstado.insercoes[0].tabela).toBe('organization_locations');
    expect(mockEstado.insercoes[0].payload.is_default).toBe(false);
    expect(mockEstado.rpcs).toEqual([{ nome: 'set_default_organization_location', params: { p_location_id: 'novo' } }]);
  });

  it('falha ao ler as sedes devolve "sem trava" (nunca bloqueia o motorista por erro de rede)', async () => {
    mockEstado.erroSedes = true;
    const alvo = await loadVanLocationForDriver(require('@/lib/supabase').supabase, { organizationId: 'org-1' });
    expect(alvo).toBeNull();
  });

  it('lê a sede padrão da organização e descarta linha sem coordenada', async () => {
    mockEstado.sedes = [
      { ...VAN, address_line_1: VAN.addressLine1, radius_meters: 300, is_default: true },
      { id: 'quebrada', name: 'Sem pino', latitude: null, longitude: null, is_default: false },
    ];
    const alvo = await loadVanLocationForDriver(require('@/lib/supabase').supabase, { organizationId: 'org-1' });
    expect(alvo?.id).toBe('v1');
    expect(alvo?.radiusMeters).toBe(300);
  });
});

/* ------------------------------------------------------------------ *
 * TELA DO MOTORISTA — o caminho de verdade: aperta o clock in e vê o que o banco recebe
 * ------------------------------------------------------------------ */

const mockPosicao: { compartilhada: { latitude: number; longitude: number } | null; fresca: { latitude: number; longitude: number } | null } = {
  compartilhada: null,
  fresca: null,
};

jest.mock('@/features/driver/locationService', () => ({
  getCurrentDriverLocation: async () => mockPosicao.fresca,
  startLocationSharing: async (onUpdate: (update: { latitude: number; longitude: number }) => void) => {
    if (mockPosicao.compartilhada) onUpdate(mockPosicao.compartilhada);
    return { stop: () => undefined };
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    // executa no mount, como o expo-router faz quando a tela ganha foco
    (require('react') as typeof React).useEffect(() => {
      const cleanup = callback();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, []);
  },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}));

const ROTA = {
  id: 'r1',
  organization_id: 'org-1',
  lock_version: 3,
  published_at: '2026-09-25T12:00:00.000Z',
  start_location_id: null,
  end_location_id: null,
  organization: { proof_pickup_required: false, proof_dropoff_required: false },
  route_stops: [
    {
      id: 's1',
      sequence: 1,
      status: 'pending',
      stop_group_id: null,
      window_start: null,
      window_end: null,
      exact_time: null,
      priority: 'normal',
      pickup_proof_path: null,
      dropoff_proof_path: null,
      arrived_at: null,
      picked_up_at: null,
      completed_at: null,
      skipped_at: null,
      status_updated_at: null,
      eta_notice_at: null,
      eta_notice_kind: null,
      dog: {
        id: 'd1',
        name: 'Bob',
        behavior_notes: null,
        medical_notes: null,
        photo_url: null,
        client: {
          name: 'Maria',
          address_line_1: '9 Client St',
          city: 'Palo Alto',
          phone: '+15550001111',
          latitude: 37.01,
          longitude: -122.01,
          client_instructions: null,
        },
      },
    },
  ],
};

/** Sede como o PostgREST devolve (snake_case). */
const SEDE_ROW = { ...VAN, address_line_1: VAN.addressLine1, radius_meters: VAN.radiusMeters, is_default: true };

function insercoesDe(tabela: string) {
  return mockEstado.insercoes.filter((linha) => linha.tabela === tabela);
}

/** Aperta o clock in manual do motorista (mesmo caminho da tela: botão → motivo → salvar). */
async function apertarClockIn() {
  const Tela = require('../app/(tabs)/driver').default;
  const tela = await render(<Tela />);
  await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());
  await fireEvent.press(tela.getByLabelText('Clock in'));
  await waitFor(() => expect(tela.getByLabelText('Reason for the manual record')).toBeTruthy());
  await fireEvent.changeText(tela.getByLabelText('Reason for the manual record'), 'Journey started at the van');
  await fireEvent.press(tela.getByLabelText('Save manual record'));
  return tela;
}

describe('clock in na tela do motorista (trava por distância)', () => {
  beforeEach(() => {
    mockEstado.insercoes.length = 0;
    mockEstado.rpcs.length = 0;
    mockEstado.sedes = [];
    mockEstado.erroSedes = false;
  });

  it('(a) sede cadastrada + motorista a 3,2 km: NADA é gravado e o motivo aparece na tela', async () => {
    mockEstado.sedes = [SEDE_ROW];
    mockPosicao.compartilhada = LONGE;
    mockPosicao.fresca = LONGE;

    const tela = await apertarClockIn();

    await waitFor(() => expect(tela.getByText(/o ponto abre quando você chegar/)).toBeTruthy());
    expect(tela.getByText(/Você está a 3,2 km da van "Van — Palo Alto"/)).toBeTruthy();
    expect(insercoesDe('driver_shifts')).toHaveLength(0);
  });

  it('(b) sede cadastrada + motorista no raio: a jornada manual é gravada', async () => {
    mockEstado.sedes = [SEDE_ROW];
    // Sem ponto compartilhado: o que decide aqui é a LEITURA FRESCA do GPS no momento do toque
    // (0,0025° de latitude ≈ 278 m da van), que é o caminho que o motorista usa na rua.
    mockPosicao.compartilhada = null;
    mockPosicao.fresca = NA_VAN;

    const tela = await apertarClockIn();

    await waitFor(() => expect(insercoesDe('driver_shifts')).toHaveLength(1));
    const gravado = insercoesDe('driver_shifts')[0].payload as { start_reason?: string; started_at?: string; driver_id?: string };
    expect(gravado.start_reason).toBe('Journey started at the van');
    expect(typeof gravado.started_at).toBe('string');
    expect(gravado.driver_id).toBe('driver-1');
    await waitFor(() => expect(tela.getByText('Journey started — manual record.')).toBeTruthy());
  });

  it('(c) SEM sede cadastrada: o clock in continua funcionando de qualquer lugar (opt-in)', async () => {
    mockEstado.sedes = []; // organização sem sede = comportamento de hoje
    mockPosicao.compartilhada = LONGE; // e o motorista está longe de onde a van seria
    mockPosicao.fresca = LONGE;

    await apertarClockIn();

    await waitFor(() => expect(insercoesDe('driver_shifts')).toHaveLength(1));
  });

  it('(d) sem localização: não trava, grava e avisa que não deu para conferir', async () => {
    mockEstado.sedes = [SEDE_ROW];
    mockPosicao.compartilhada = null; // web/permissão negada/GPS sem fix
    mockPosicao.fresca = null;

    const tela = await apertarClockIn();

    await waitFor(() => expect(insercoesDe('driver_shifts')).toHaveLength(1));
    await waitFor(() => expect(tela.getByText(SEM_POSICAO_MENSAGEM)).toBeTruthy());
  });

  it('chegando na van, a jornada abre sozinha e começa ali (não sobra nada para apertar)', async () => {
    mockEstado.sedes = [SEDE_ROW];
    mockPosicao.compartilhada = NA_VAN; // o compartilhamento de posição vê o motorista na van
    mockPosicao.fresca = NA_VAN;

    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);

    // É o pedido do áudio: a jornada começa NA VAN, não no primeiro cão — mesmo sem nenhuma parada.
    await waitFor(() => expect(tela.getByText(/On the clock since/)).toBeTruthy());
    expect(tela.queryByLabelText('Clock in')).toBeNull();
    expect(tela.getByLabelText('Clock out')).toBeTruthy();
    expect(insercoesDe('driver_shifts')).toHaveLength(0); // nada foi gravado: é a dedução
  });

  it('com sede cadastrada o cartão da jornada diz onde o clock in abre', async () => {
    mockEstado.sedes = [SEDE_ROW];
    mockPosicao.compartilhada = LONGE;
    mockPosicao.fresca = LONGE;

    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByText(/O clock in abre na van "Van — Palo Alto"/)).toBeTruthy());
    expect(tela.getByText(/você está a 3,2 km/)).toBeTruthy();
  });

  it('sem sede cadastrada o cartão da jornada não fala de van (nada mudou para quem já usa)', async () => {
    mockEstado.sedes = [];
    mockPosicao.compartilhada = LONGE;
    mockPosicao.fresca = LONGE;

    const Tela = require('../app/(tabs)/driver').default;
    const tela = await render(<Tela />);

    await waitFor(() => expect(tela.getByLabelText('Clock in')).toBeTruthy());
    expect(tela.queryByText(/O clock in abre na van/)).toBeNull();
    expect(tela.queryByText(/Você está a/)).toBeNull();
  });
});
