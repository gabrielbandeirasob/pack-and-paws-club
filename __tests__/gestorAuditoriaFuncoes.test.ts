/**
 * AUDITORIA DO GESTOR (02/10/2026) — provas das correções de FUNÇÃO PURA.
 *
 * A1: "Add from Contacts" mandava `pickup_access_instructions` no insert de `clients` (coluna que não
 *     existe — vive em `client_instructions`) e o contato COM anotação não salvava (PGRST204).
 * B6: um cão em daycare E boarding no mesmo dia aparece nas DUAS seções do Calendário (são reservas
 *     distintas) e a Home conta UMA vez (como boarding) via `contagemDoDia`. Fixa a regra e o porquê.
 */
import { clientInsertPayload } from '@/features/clients/clientsService';
import { contagemDoDia } from '@/features/dashboard/dayService';
import { buildDay } from '@/features/calendar/dayMath';
import type { NewClientInput } from '@/features/clients/types';

const inputComAnotacao: NewClientInput = {
  name: 'Leigh Ann',
  phone: '+1 415 555 0100',
  address_line_1: '580 California St',
  address_line_2: 'Apt 12',
  city: 'San Francisco',
  state: 'CA',
  postal_code: '94104',
  source_contact_identifier: 'contact-9',
  second_owner_name: 'Sam Wald',
  second_owner_phone: '+1 415 555 0199',
  // A nota do contato do iPhone — a coluna que NÃO existe em `clients`.
  pickup_access_instructions: 'Call box 185. Key inside lockbox.',
  contains_access_code: true,
};

describe('A1 — insert do cliente só leva colunas reais de `clients`', () => {
  it('NÃO inclui `pickup_access_instructions` nem `contains_access_code`', () => {
    const payload = clientInsertPayload(inputComAnotacao, 'org-1');
    expect(payload).not.toHaveProperty('pickup_access_instructions');
    expect(payload).not.toHaveProperty('contains_access_code');
  });

  it('leva as colunas reais (inclusive second_owner_* e o vínculo do contato)', () => {
    expect(clientInsertPayload(inputComAnotacao, 'org-1')).toEqual({
      organization_id: 'org-1',
      name: 'Leigh Ann',
      phone: '+1 415 555 0100',
      second_owner_name: 'Sam Wald',
      second_owner_phone: '+1 415 555 0199',
      address_line_1: '580 California St',
      address_line_2: 'Apt 12',
      city: 'San Francisco',
      state: 'CA',
      postal_code: '94104',
      source_contact_identifier: 'contact-9',
    });
  });

  it('sem anotação, o payload continua o mesmo (nada de campo undefined solto)', () => {
    const { pickup_access_instructions, contains_access_code, ...semNota } = inputComAnotacao;
    const payload = clientInsertPayload(semNota as NewClientInput, 'org-2');
    expect(Object.keys(payload).sort()).toEqual([
      'address_line_1', 'address_line_2', 'city', 'name', 'organization_id',
      'phone', 'postal_code', 'second_owner_name', 'second_owner_phone',
      'source_contact_identifier', 'state',
    ]);
  });
});

describe('B6 — cão em daycare E boarding no mesmo dia', () => {
  /** O mesmo cão (Filó) com UMA reserva de daycare em D e UMA hospedagem cobrindo D. */
  const dia = '2026-10-05';
  const reservas = [
    {
      id: 'r-daycare', dog: { id: 'd-filo', dogName: 'Filó', clientName: 'Amor' },
      serviceType: 'daycare' as const, startDate: dia, endDate: dia, transportRequired: true,
    },
    {
      id: 'r-boarding', dog: { id: 'd-filo', dogName: 'Filó', clientName: 'Amor' },
      serviceType: 'boarding' as const, startDate: '2026-10-03', endDate: '2026-10-08', transportRequired: true,
    },
  ];

  it('o Calendário LISTA o cão nas duas seções (são reservas distintas, de propósito)', () => {
    const day = buildDay(dia, reservas, [], []);
    expect(day.daycare.map((item) => item.dogName)).toEqual(['Filó']);
    expect(day.boarding.map((item) => item.dogName)).toEqual(['Filó']);
  });

  it('a Home conta UMA vez, como boarding (regra única de `contagemDoDia`)', () => {
    const day = buildDay(dia, reservas, [], []);
    expect(contagemDoDia(day)).toEqual({ daycare: 0, boarding: 1 });
  });
});
