/**
 * O CALENDÁRIO É A FONTE (exigência do cliente, 25/10/2026).
 *
 * O escritório lança tudo no Google Calendar, do jeito que ele fala: com emoji de casa ("Woody 🏠"),
 * com apelido entre parênteses ("Charlie (Gio)"), com nome curto ("Lulu" para "Lulu Puppy"). Se o
 * app tratar isso como "cão fora do cadastro", o cão existe e o dia não entra.
 *
 * E o outro lado da mesma moeda: evento de cão desconhecido NÃO é evento apagado. Antes, a reserva
 * que já apontava para ele era cancelada no fim da rodada ("Lulu Pupoy" ia perder o dia).
 */
import { planCalendarImport, type BookingForImport, type DogForImport } from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const JANELA = { from: '2026-10-25', to: '2027-04-22' };
const AZUL = '7'; // daycare

function evento(parcial: Partial<RemoteEvent> & { id: string }): RemoteEvent {
  return { summary: '', startDate: '2026-10-26', endDate: '2026-10-27', appKey: null, colorId: AZUL, recurrence: null, ...parcial };
}

const CAES: DogForImport[] = [
  { id: 'dog-woody', name: 'Woody', clientName: 'Ana' },
  { id: 'dog-charlie', name: 'Charlie', clientName: 'Gio' },
  { id: 'dog-lulu', name: 'Lulu Puppy', clientName: 'Bia' },
  { id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann' },
  { id: 'dog-luna-a', name: 'Luna', clientName: 'Ana' },
  { id: 'dog-luna-b', name: 'Luna', clientName: 'Bruno' },
];

function reserva(over: Partial<BookingForImport> = {}): BookingForImport {
  return {
    id: 'r-lulu',
    kind: 'reservation',
    dogId: 'dog-lulu',
    googleEventId: null,
    googleCalendarId: 'primary',
    source: 'google',
    serviceType: 'daycare',
    startDate: '2026-10-26',
    endDate: '2026-10-26',
    status: 'confirmed',
    ...over,
  };
}

describe('calendário como fonte: nome escrito à mão', () => {
  it('emoji de casa no título não esconde o cão cadastrado (Woody 🏠)', () => {
    const plano = planCalendarImport([evento({ id: 'e-woody', summary: 'Woody 🏠' })], CAES, [], JANELA, { labels: [] });
    expect(plano.map((i) => i.kind)).toEqual(['create']);
  });

  it('apelido entre parênteses casa com o cão do cadastro (Charlie (Gio))', () => {
    const plano = planCalendarImport([evento({ id: 'e-charlie', summary: 'Charlie (Gio)' })], CAES, [], JANELA, { labels: [] });
    expect(plano.map((i) => i.kind)).toEqual(['create']);
  });

  it('nome curto casa com o nome completo quando só existe um (Lulu -> Lulu Puppy)', () => {
    const plano = planCalendarImport([evento({ id: 'e-lulu', summary: 'Lulu' })], CAES, [], JANELA, { labels: [] });
    expect(plano.map((i) => i.kind)).toContain('create');
    const criado = plano.find((i) => i.kind === 'create');
    expect(criado && 'dogId' in criado ? criado.dogId : null).toBe('dog-lulu');
  });

  it('homônimo continua pendente: dois "Luna" não são adivinhados', () => {
    const plano = planCalendarImport([evento({ id: 'e-luna', summary: 'Luna' })], CAES, [], JANELA, { labels: [] });
    expect(plano.map((i) => i.kind)).toEqual(['review']);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'ambiguous dog' });
  });
});

describe('cão desconhecido não apaga reserva existente', () => {
  it('evento com nome fora do cadastro não gera cancelamento da reserva ligada a ele', () => {
    const plano = planCalendarImport(
      [evento({ id: 'e-desconhecido', summary: 'Zeca' })],
      CAES,
      [reserva({ googleEventId: 'e-desconhecido' })],
      JANELA,
      { labels: [] },
    );
    // O vínculo por evento faz o app entender "o cão foi renomeado no calendário": nada a fazer,
    // e principalmente NADA a cancelar.
    expect(plano.filter((i) => i.kind === 'cancel')).toEqual([]);
  });

  it('cão fora do cadastro e sem vínculo aparece para revisão, sem cancelar nada', () => {
    const plano = planCalendarImport(
      [evento({ id: 'e-sem-vinculo', summary: 'Zeca' })],
      CAES,
      [],
      JANELA,
      { labels: [] },
    );
    expect(plano.map((i) => i.kind)).toEqual(['review']);
    expect(plano[0]).toMatchObject({ reason: 'unknown dog' });
  });

  it('reserva cujo evento SUMIU do calendário continua sendo cancelada', () => {
    const plano = planCalendarImport(
      [],
      CAES,
      [reserva({ id: 'r-orfa', googleEventId: 'e-que-nao-existe-mais' })],
      JANELA,
      { labels: [] },
    );
    expect(plano.map((i) => i.kind)).toEqual(['cancel']);
  });
});
