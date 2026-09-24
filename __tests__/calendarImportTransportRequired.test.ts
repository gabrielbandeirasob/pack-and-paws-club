/**
 * A reserva que NASCE do Google entra com `transport_required: true`.
 *
 * Achado de 23/09/2026 (print do dono): o escritório escreveu "Pick filó" no Google, sincronizou, e
 * o cão não entrou na fila da van. Duas causas: (1) o título não tinha palavra de serviço e o evento
 * era descartado; (2) `transport_required` tem default **false** no banco, então mesmo uma reserva
 * importada não aparecia no Dispatch. A primeira mora em importPlan (coberta lá); esta aqui trava a
 * segunda: quem nasce do Google nasce com transporte marcado.
 *
 * O `service_type` que estes testes veem é o da COR do evento (verde boarding / azul daycare) — o
 * título não decide mais o serviço.
 */
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import type { ParsedBooking } from '@/features/integrations/google/importPlan';

const parsed: ParsedBooking = {
  serviceType: 'daycare',
  // O que foi lido na cor do evento (paleta antiga, `colorId` 7 = Peacock).
  color: { source: 'colorId', labelId: null, labelName: null, backgroundColor: null, colorId: '7', meaning: { kind: 'service', serviceType: 'daycare' } },
  cancels: false,
  dogName: 'filó',
  startDate: '2026-09-25',
  endDate: '2026-09-25',
  weekdays: [],
  skipDates: [],
  openEnded: false,
};

const serie: ParsedBooking = {
  ...parsed,
  weekdays: [1, 3],
  endDate: '2026-12-31',
  skipDates: ['2026-10-12'],
};

function clienteFalso(linhas: Record<string, unknown>[]) {
  return {
    from: (tabela: string) => ({
      insert: (linha: Record<string, unknown> | Record<string, unknown>[]) => {
        // O gravarPausas insere um ARRAY (uma ausência por data), então o falso precisa aceitar os dois.
        for (const registro of Array.isArray(linha) ? linha : [linha]) linhas.push({ tabela, ...registro });
        return {
          error: null,
          select: () => ({ single: async () => ({ data: { id: 'criado-1' }, error: null }) }),
        };
      },
      // gravarPausas limpa as ausências antigas antes de gravar as novas: .delete().eq().eq()
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  } as never;
}

describe('importação cria reserva com transporte marcado', () => {
  it('reserva avulsa do Google entra com transport_required', async () => {
    const linhas: Record<string, unknown>[] = [];
    const ports = supabaseImportPorts(clienteFalso(linhas), 'org-1');

    await ports.createBooking({ eventId: 'ev-filo', dogId: 'dog-filo', kind: 'reservation', parsed });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      tabela: 'reservations',
      organization_id: 'org-1',
      dog_id: 'dog-filo',
      service_type: 'daycare',
      start_date: '2026-09-25',
      transport_required: true,
      google_event_id: 'ev-filo',
      source: 'google',
    });
  });

  it('série do Google também entra com transporte, e as pausas viram ausências', async () => {
    const linhas: Record<string, unknown>[] = [];
    const ports = supabaseImportPorts(clienteFalso(linhas), 'org-1');

    await ports.createBooking({ eventId: 'ev-serie', dogId: 'dog-filo', kind: 'recurring', parsed: serie });

    expect(linhas[0]).toMatchObject({ tabela: 'recurring_schedules', transport_required: true, weekdays: [1, 3], source: 'google' });
    expect(linhas[1]).toMatchObject({ tabela: 'recurring_exceptions', recurring_schedule_id: 'criado-1', action: 'skip', start_date: '2026-10-12' });
  });
});
