/**
 * Portas de escrita da importação (o que a roda toca no banco).
 *
 * Regra travada aqui:
 *  - se JÁ existe a mesma reserva no app, o certo é LIGAR o evento a ela — não criar uma segunda;
 *  - `skipRecurringDay` (evento VERMELHO sobre um dia de escala) grava UMA pausa daquele dia, sem
 *    acumular linha repetida e sem desativar a série;
 *  - as portas de CADASTRO (`createClient`/`createDog`) e a limpeza da rodada saíram: a regra nova do
 *    dono (24/09/2026) é não criar cliente nem cão a partir do calendário.
 */
import { escolhaDaRevisao, supabaseImportPorts } from '@/features/integrations/google/importPorts';
import type { BookingForImport, ParsedBooking } from '@/features/integrations/google/importPlan';

type Resposta = { data?: unknown; error?: { message: string } | null };

/**
 * Cliente Supabase de mentira, com o encadeamento que as portas usam
 * (`from(t).select(...).eq(...).eq(...)`, `.insert(...).select('id').single()`, `.delete().eq().eq()`).
 *
 * Cada nó é "awaitável" e responde pela resposta cujo PREFIXO mais longo casa com o caminho chamado; o
 * caminho inteiro (tabela + colunas + filtros) vai para `chamadas`, então o teste confere exatamente o
 * que foi lido e escrito, em que ordem.
 */
function clienteFalso(respostas: Record<string, Resposta> = {}, chamadas: string[] = []) {
  const no = (caminho: string): unknown => {
    const resultado = async (): Promise<Resposta> => {
      chamadas.push(caminho);
      const chave = Object.keys(respostas)
        .filter((candidata) => caminho.startsWith(candidata))
        .sort((a, b) => b.length - a.length)[0];
      return chave ? respostas[chave] : { data: [], error: null };
    };
    return {
      eq: (coluna: string, valor: unknown) => no(`${caminho}:eq(${coluna}=${String(valor)})`),
      // `select` também depois de `insert` (a porta usa `.insert(...).select('id').single()`).
      select: (colunas?: string) => no(`${caminho}:select(${colunas ?? '*'})`),
      limit: (quantidade: number) => no(`${caminho}:limit(${quantidade})`),
      single: () => resultado(),
      maybeSingle: () => resultado(),
      then: (resolve: (valor: Resposta) => unknown, reject?: (erro: unknown) => unknown) => resultado().then(resolve, reject),
    };
  };
  return {
    from: (tabela: string) => ({
      select: (colunas?: string) => no(`${tabela}:select(${colunas ?? '*'})`),
      insert: (linha: unknown) => no(`${tabela}:insert(${JSON.stringify(linha)})`),
      update: (valores: unknown) => no(`${tabela}:update(${JSON.stringify(valores)})`),
      delete: () => no(`${tabela}:delete`),
    }),
  } as never;
}

const parsed: ParsedBooking = {
  serviceType: 'boarding',
  // O que foi lido na cor do evento (paleta antiga, `colorId` 2 = Sage): a tela mostra isso.
  color: { source: 'colorId', labelId: null, labelName: null, backgroundColor: null, colorId: '2', meaning: { kind: 'service', serviceType: 'boarding' } },
  cancels: false,
  dogName: 'Luna',
  startDate: '2026-10-05',
  endDate: '2026-10-08',
  weekdays: [],
  skipDates: [],
  openEnded: false,
};

const existente: BookingForImport = {
  id: 'r-existente',
  kind: 'reservation',
  dogId: 'dog-luna',
  googleEventId: null,
  source: 'app',
  serviceType: 'boarding',
  startDate: '2026-10-05',
  endDate: '2026-10-08',
  weekdays: [],
  skipDates: [],
  status: 'confirmed',
};

describe('escolhaDaRevisao', () => {
  it('liga o evento à reserva que já existe (nada de duplicar)', () => {
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-luna', bookings: [existente] })).toEqual({ kind: 'reservation', id: 'r-existente' });
  });

  it('cria quando não existe nada igual', () => {
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-luna', bookings: [] })).toEqual({ criar: true });
  });

  it('reserva parecida mas de outro cão não serve de ligação', () => {
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-outro', bookings: [existente] })).toEqual({ criar: true });
  });

  it('reserva de OUTRO serviço não é a mesma reserva (o serviço vem da cor)', () => {
    const daycare: ParsedBooking = { ...parsed, serviceType: 'daycare' };
    expect(escolhaDaRevisao({ parsed: daycare, dogId: 'dog-luna', bookings: [existente] })).toEqual({ criar: true });
  });

  it('data diferente não é a mesma reserva', () => {
    const outra = { ...existente, startDate: '2026-10-12', endDate: '2026-10-15' };
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-luna', bookings: [outra] })).toEqual({ criar: true });
  });

  it('série recorrente casa por dias da semana', () => {
    const serieDoGoogle: ParsedBooking = { ...parsed, weekdays: [1, 3], openEnded: true };
    const serieExistente: BookingForImport = {
      ...existente,
      id: 'serie-1',
      kind: 'recurring',
      weekdays: [3, 1],
      status: 'active',
    };
    expect(escolhaDaRevisao({ parsed: serieDoGoogle, dogId: 'dog-luna', bookings: [serieExistente] })).toEqual({ kind: 'recurring', id: 'serie-1' });
  });
});

describe('createBooking grava o serviço que veio da COR', () => {
  const clienteComInsert = (linhas: Record<string, unknown>[]) =>
    ({
      from: (tabela: string) => ({
        insert: (linha: Record<string, unknown>) => {
          linhas.push({ tabela, ...linha });
          return { error: null, select: () => ({ single: async () => ({ data: { id: 'criado-1' }, error: null }) }) };
        },
      }),
    }) as never;

  it('reserva avulsa entra com service_type da cor e transporte marcado', async () => {
    const linhas: Record<string, unknown>[] = [];
    const ports = supabaseImportPorts(clienteComInsert(linhas), 'org-1');

    await ports.createBooking({ eventId: 'ev-pietro', dogId: 'dog-pietro', kind: 'reservation', parsed: { ...parsed, serviceType: 'daycare', dogName: 'Pietro', startDate: '2026-09-25', endDate: '2026-09-25' } });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      tabela: 'reservations',
      organization_id: 'org-1',
      dog_id: 'dog-pietro',
      service_type: 'daycare',
      start_date: '2026-09-25',
      transport_required: true,
      google_event_id: 'ev-pietro',
      source: 'google',
    });
  });

  it('verde (boarding) grava boarding — o mesmo caminho, o serviço é que muda', async () => {
    const linhas: Record<string, unknown>[] = [];
    const ports = supabaseImportPorts(clienteComInsert(linhas), 'org-1');

    await ports.createBooking({ eventId: 'ev-verde', dogId: 'dog-pietro', kind: 'reservation', parsed });

    expect(linhas[0]).toMatchObject({ service_type: 'boarding', google_event_id: 'ev-verde' });
  });
});

describe('skipRecurringDay (evento vermelho sobre um dia de escala)', () => {
  const caminhoLimpeza = 'recurring_exceptions:delete:eq(recurring_schedule_id=serie-1):eq(action=skip):eq(start_date=2026-09-30)';

  it('apaga a pausa do mesmo dia antes de gravar (não acumula linha repetida)', async () => {
    const chamadas: string[] = [];
    const ports = supabaseImportPorts(clienteFalso({}, chamadas), 'org-1');

    await ports.skipRecurringDay({ scheduleId: 'serie-1', date: '2026-09-30', eventId: 'ev-red' });

    // A limpeza vem primeiro e sai pelo caminho exato (série + skip + data); a pausa entra depois.
    expect(chamadas).toEqual([
      caminhoLimpeza,
      'recurring_exceptions:insert(' +
        JSON.stringify({
          organization_id: 'org-1',
          recurring_schedule_id: 'serie-1',
          action: 'skip',
          start_date: '2026-09-30',
          end_date: '2026-09-30',
          reason: 'Cancelled in Google Calendar',
        }) +
        ')',
    ]);
  });

  it('erro do banco na limpeza sobe (a tela mostra o motivo, não um sucesso falso)', async () => {
    const ports = supabaseImportPorts(clienteFalso({ [caminhoLimpeza]: { error: { message: 'RLS negou a pausa' } } }), 'org-1');

    await expect(ports.skipRecurringDay({ scheduleId: 'serie-1', date: '2026-09-30', eventId: 'ev-red' })).rejects.toThrow('RLS negou a pausa');
  });
});
