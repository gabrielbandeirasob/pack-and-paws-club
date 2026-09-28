/**
 * AUTORIA DAS LINHAS DO GOOGLE (`created_by`) — produção, 28/09/2026.
 *
 * Relato do dono: *"o erro persiste, ele não está pegando os agendamentos ao sincronizar"*. O log do
 * relógio (função do servidor) dizia `0 criados · 2 atualizados · 6 falhas`, e o motivo cru era:
 *
 *   null value in column "created_by" of relation "reservations" violates not-null constraint
 *
 * As tabelas que a importação escreve usam `created_by uuid not null default auth.uid()`. No APARELHO o
 * padrão funciona (tem sessão); na FUNÇÃO não existe `auth.uid()` (roda com chave de serviço, sem JWT),
 * então o padrão virava NULL e o banco recusava — o relógio ATUALIZAVA o que existia, mas nunca CRIAVA.
 * Era isso que o escritório via como "não pega os agendamentos".
 *
 * O que estes vetores travam:
 *  - com `criadoPor` (servidor: o gestor que conectou o calendário), o insert MANDA o autor;
 *  - sem `criadoPor` (app), o insert NÃO manda: continua valendo o `default auth.uid()` de sempre;
 *  - vale nas três tabelas que a importação escreve (reservas, séries e pausas/dias extras).
 */
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import type { ParsedBooking } from '@/features/integrations/google/importPlan';

const PARSED: ParsedBooking = {
  serviceType: 'daycare',
  color: {
    source: 'colorId',
    labelId: null,
    labelName: null,
    backgroundColor: null,
    colorId: '7',
    meaning: { kind: 'service', serviceType: 'daycare' },
  },
  cancels: false,
  dogName: 'Bella',
  startDate: '2026-09-28',
  endDate: '2026-09-28',
  weekdays: [1, 3, 5],
  skipDates: [],
  transportRequired: true,
  goesToDaycare: true,
  openEnded: false,
};

/** Cliente de mentira que só ANOTA o que foi mandado inserir e responde sucesso. */
function clienteQueAnota(inseridos: { tabela: string; linha: unknown }[]) {
  const no = (tabela: string, linha?: unknown): unknown => ({
    __tabela: tabela,
    eq: () => no(tabela),
    delete: () => no(tabela),
    select: () => no(tabela),
    single: async () => ({ data: { id: 'novo-id' }, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: async (resolve: (valor: { data: unknown; error: null }) => unknown) => resolve({ data: null, error: null }),
    // o insert registra a linha no momento da chamada
    ...(linha !== undefined ? {} : {}),
  });
  return {
    from: (tabela: string) => ({
      insert: (linha: unknown) => {
        inseridos.push({ tabela, linha });
        return no(tabela, linha);
      },
      delete: () => no(tabela),
      select: () => no(tabela),
      update: () => no(tabela),
    }),
  };
}

describe('created_by: o servidor assina a linha, o app deixa o padrão', () => {
  it('reserva: com criadoPor, o autor vai no insert (é o conserto do "não pega os agendamentos")', async () => {
    const inseridos: { tabela: string; linha: unknown }[] = [];
    const portas = supabaseImportPorts(clienteQueAnota(inseridos) as never, 'org-1', { criadoPor: 'gestor-1' });

    await portas.createBooking({ eventId: 'ev-1', dogId: 'dog-1', kind: 'reservation', parsed: PARSED });

    const linha = inseridos.find((item) => item.tabela === 'reservations')?.linha as Record<string, unknown>;
    expect(linha.created_by).toBe('gestor-1');
    expect(linha.organization_id).toBe('org-1');
    expect(linha.google_event_id).toBe('ev-1');
  });

  it('reserva: sem criadoPor (o app), o autor NÃO vai no insert — vale o default auth.uid()', async () => {
    const inseridos: { tabela: string; linha: unknown }[] = [];
    const portas = supabaseImportPorts(clienteQueAnota(inseridos) as never, 'org-1');

    await portas.createBooking({ eventId: 'ev-1', dogId: 'dog-1', kind: 'reservation', parsed: PARSED });

    const linha = inseridos.find((item) => item.tabela === 'reservations')?.linha as Record<string, unknown>;
    expect(linha).not.toHaveProperty('created_by');
  });

  it('série recorrente: também leva o autor', async () => {
    const inseridos: { tabela: string; linha: unknown }[] = [];
    const portas = supabaseImportPorts(clienteQueAnota(inseridos) as never, 'org-1', { criadoPor: 'gestor-1' });

    await portas.createBooking({ eventId: 'ev-serie', dogId: 'dog-1', kind: 'recurring', parsed: PARSED });

    const linha = inseridos.find((item) => item.tabela === 'recurring_schedules')?.linha as Record<string, unknown>;
    expect(linha.created_by).toBe('gestor-1');
  });

  it('pausa de UM dia (evento vermelho) e dia extra (roxo) também levam o autor', async () => {
    const inseridos: { tabela: string; linha: unknown }[] = [];
    const portas = supabaseImportPorts(clienteQueAnota(inseridos) as never, 'org-1', { criadoPor: 'gestor-1' });

    await portas.skipRecurringDay({ scheduleId: 'serie-1', date: '2026-09-28', eventId: 'ev-1' });
    await portas.addScheduleExtraDay({ scheduleId: 'serie-1', date: '2026-09-29', eventId: 'ev-2' });

    const pausas = inseridos.filter((item) => item.tabela === 'recurring_exceptions' && (item.linha as Record<string, unknown>).action === 'skip');
    const extras = inseridos.filter((item) => item.tabela === 'recurring_exceptions' && (item.linha as Record<string, unknown>).action === 'extra');
    expect(pausas[0].linha).toMatchObject({ created_by: 'gestor-1', action: 'skip' });
    expect(extras[0].linha).toMatchObject({ created_by: 'gestor-1', action: 'extra' });
  });
});
