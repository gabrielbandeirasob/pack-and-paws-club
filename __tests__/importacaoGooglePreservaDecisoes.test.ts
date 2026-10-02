/**
 * A IMPORTAÇÃO DO GOOGLE NÃO PODE DESFAZER O QUE O GESTOR FEZ NO APP.
 *
 * 🪤 ACHADO DA VISTORIA (02/10/2026) — dois defeitos medidos em `importPorts.ts`:
 *
 *  1. `updateBooking` (reserva) regravava `transport_required` e `goes_to_daycare` a partir do evento
 *     do Google. Numa reserva que JÁ existia isso apagava a decisão do gestor ("precisa de transporte"
 *     desmarcado / "vai pro daycare" desmarcado) a cada Sync — os dois campos voltavam sozinhos ao
 *     valor do evento, e o cão reaparecia na van (ou saía do Total Pack) sem ninguém pedir.
 *  2. `gravarPausas` fazia `delete … where action = 'skip'` de TODA a série antes de reinserir as
 *     pausas do Google — levava junto as pausas criadas NO APP (que só existem no banco), então as
 *     férias/dias parados marcados pelo gestor desapareciam na rodada seguinte.
 *
 * O certo (regra do dono): os dois campos são preenchidos só quando a reserva NASCE (o evento decide
 * o dia/serviço; o resto é do gestor) e a limpeza de pausas só toca as que vieram do Google.
 *
 * Aqui as portas REAIS rodam contra um Supabase FALSO que guarda as linhas e registra as escritas.
 * Com o código anterior ao conserto este arquivo fica VERMELHO nas duas frentes.
 */
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import type { ParsedBooking } from '@/features/integrations/google/importPlan';

type Linha = Record<string, unknown>;

/**
 * Supabase de mentira com ESTADO: guarda as tabelas em memória e aplica cada escrita de verdade, de
 * modo que dá para conferir não só a intenção (o que a porta mandou) mas o RESULTADO (a linha depois).
 * Os filtros são genéricos — o teste não assume os nomes das colunas que cada porta escolhe.
 */
function bancoFalso(inicial: {
  reservations?: Linha[];
  recurring_schedules?: Linha[];
  recurring_exceptions?: Linha[];
}) {
  const estado = {
    reservations: inicial.reservations ?? [],
    recurring_schedules: inicial.recurring_schedules ?? [],
    recurring_exceptions: inicial.recurring_exceptions ?? [],
  };
  const escritas: string[] = [];

  const cliente = {
    from: (tabela: keyof typeof estado) => ({
      insert: (linha: Linha | Linha[]) => {
        const linhas = Array.isArray(linha) ? linha : [linha];
        escritas.push(`insert ${tabela} ${JSON.stringify(linhas)}`);
        estado[tabela].push(...linhas);
        return {
          error: null,
          select: () => ({ single: async () => ({ data: { id: `novo-${estado[tabela].length}` }, error: null }) }),
        };
      },
      update: (valores: Linha) => ({
        eq: async (coluna: string, valor: unknown) => {
          escritas.push(`update ${tabela} ${JSON.stringify(valores)} where ${coluna}=${String(valor)}`);
          for (const linha of estado[tabela]) if (linha[coluna] === valor) Object.assign(linha, valores);
          return { error: null };
        },
      }),
      // A limpeza de pausas usa exatamente dois `eq` antes do `await` (série + o critério).
      delete: () => ({
        eq: (coluna: string, valor: unknown) => ({
          eq: async (coluna2: string, valor2: unknown) => {
            escritas.push(`delete ${tabela} where ${coluna}=${String(valor)} and ${coluna2}=${String(valor2)}`);
            const restantes = estado[tabela].filter(
              (linha) => !(linha[coluna] === valor && linha[coluna2] === valor2),
            );
            estado[tabela].length = 0;
            estado[tabela].push(...restantes);
            return { error: null };
          },
        }),
      }),
    }),
  };

  return { estado, escritas, ports: supabaseImportPorts(cliente as never, 'org-1') };
}

/** O que o EVENTO do Google diz (daycare, um dia, transporte e daycare marcados). */
const doEvento: ParsedBooking = {
  serviceType: 'daycare',
  goesToDaycare: true,
  transportRequired: true,
  color: {
    source: 'colorId',
    labelId: null,
    labelName: null,
    backgroundColor: null,
    colorId: '7',
    meaning: { kind: 'service', serviceType: 'daycare' },
  },
  cancels: false,
  dogName: 'Luna',
  startDate: '2026-10-05',
  endDate: '2026-10-05',
  weekdays: [],
  skipDates: [],
  openEnded: false,
};

/** A reserva que o GESTOR já ajustou: NÃO precisa de transporte e NÃO vai pro daycare. */
const reservaDoGestor: Linha = {
  id: 'res-luna',
  organization_id: 'org-1',
  dog_id: 'luna',
  service_type: 'daycare',
  start_date: '2026-10-05',
  end_date: '2026-10-05',
  transport_required: false,
  goes_to_daycare: false,
  status: 'confirmed',
  google_event_id: 'ev-luna',
  source: 'google',
};

const serieDoGestor: Linha = {
  id: 'serie-1',
  organization_id: 'org-1',
  dog_id: 'luna',
  weekdays: [1, 3],
  start_date: '2026-10-05',
  end_date: '2026-12-31',
  active: true,
  transport_required: true,
  google_event_id: 'ev-serie',
  source: 'google',
};

/** A pausa que o gestor marcou NO APP (`reason` diferente da que a importação grava). */
const pausaDoApp: Linha = {
  id: 'pausa-app',
  organization_id: 'org-1',
  recurring_schedule_id: 'serie-1',
  action: 'skip',
  start_date: '2026-10-12',
  end_date: '2026-10-12',
  reason: 'Skipped on this date',
};

/** A série do Google traz um dia novo de pausa (que deve substituir a pausa do Google, não a do app). */
const serieComPausaDoGoogle: ParsedBooking = {
  ...doEvento,
  startDate: '2026-10-05',
  endDate: '2026-12-31',
  weekdays: [1, 3],
  skipDates: ['2026-11-03'],
};

describe('importação do Google preserva as decisões do gestor', () => {
  it('não reescreve transport_required nem goes_to_daycare na reserva que já existe', async () => {
    const { estado, ports } = bancoFalso({ reservations: [{ ...reservaDoGestor }] });

    await ports.updateBooking({
      bookingId: 'res-luna',
      kind: 'reservation',
      eventId: 'ev-luna',
      dogId: 'luna',
      parsed: doEvento,
    });

    // O evento diz transporte = true / daycare = true; o gestor tinha dito os dois FALSE. A importação
    // manda o serviço e as datas (isso é do evento), mas NÃO pode devolver os dois campos.
    expect(estado.reservations[0]).toMatchObject({
      transport_required: false,
      goes_to_daycare: false,
    });
  });

  it('não APAGA a pausa feita no app ao regravar as pausas do Google', async () => {
    const { estado, ports } = bancoFalso({
      recurring_schedules: [{ ...serieDoGestor }],
      recurring_exceptions: [{ ...pausaDoApp }],
    });

    await ports.updateBooking({
      bookingId: 'serie-1',
      kind: 'recurring',
      eventId: 'ev-serie',
      dogId: 'luna',
      parsed: serieComPausaDoGoogle,
    });

    const pausas = estado.recurring_exceptions;
    // (a) a pausa do app sobrevive — ela não existe no Google, então a importação não pode removê-la.
    expect(pausas.some((pausa) => pausa.id === 'pausa-app')).toBe(true);
    // (b) e a pausa que VEIO do Google é gravada normalmente (a importação continua funcionando).
    expect(pausas.some((pausa) => pausa.start_date === '2026-11-03' && pausa.action === 'skip')).toBe(true);
  });

  it('a limpeza troca só a pausa do Google do mesmo dia (sem duplicar e sem tocar na do app)', async () => {
    const pausaDoGoogle: Linha = {
      id: 'pausa-google',
      organization_id: 'org-1',
      recurring_schedule_id: 'serie-1',
      action: 'skip',
      start_date: '2026-11-03',
      end_date: '2026-11-03',
      reason: 'Pausa marcada no Google Calendar',
    };
    const { estado, ports } = bancoFalso({
      recurring_schedules: [{ ...serieDoGestor }],
      recurring_exceptions: [{ ...pausaDoApp }, { ...pausaDoGoogle }],
    });

    await ports.updateBooking({
      bookingId: 'serie-1',
      kind: 'recurring',
      eventId: 'ev-serie',
      dogId: 'luna',
      parsed: serieComPausaDoGoogle,
    });

    // Uma pausa por dia (a antiga do Google sai, a nova entra) e a do app fica.
    expect(estado.recurring_exceptions.filter((pausa) => pausa.start_date === '2026-11-03')).toHaveLength(1);
    expect(estado.recurring_exceptions.some((pausa) => pausa.id === 'pausa-app')).toBe(true);
  });
});
