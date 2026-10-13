/**
 * DESEMPATE POR CASA quando o nome casa com MAIS DE UM cão (medido 13/10/2026).
 *
 * O escritório relatou *"faltou Sam (Ollie and Sam)"*: há DOIS cães chamados `Sam` no cadastro (Jose e
 * Nina) e o título `Sam/Ollie` traz o `Ollie`, que é do **Jose** — o Sam que interessa é o da MESMA
 * CASA. A regra do dono para a casa já existe desde 29/09/2026 (*"se os dois cachorros são da mesma
 * casa, eles são um pick-up só"*); aqui ela só desempata o nome repetido, e **só quando o sinal é
 * único**: exatamente um candidato da casa de um dos outros nomes do título. Sem esse sinal o app
 * continua sem chutar — a pendência "More than one dog with this name" segue aparecendo.
 */
import {
  planCalendarImport,
  type DogForImport,
  type ImportOutcome,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/eventMarkers';

const AGENDA = 'packandpawsclub@gmail.com';
const JANELA = { from: '2026-10-13', to: '2027-04-11' };

const CAES: DogForImport[] = [
  { id: 'dog-sam-jose', name: 'Sam', clientId: 'cl-jose', clientName: 'Jose' },
  { id: 'dog-ollie', name: 'Ollie', clientId: 'cl-jose', clientName: 'Jose' },
  { id: 'dog-sam-nina', name: 'Sam', clientId: 'cl-nina', clientName: 'Nina' },
];

const evento = (summary: string, id = 'e1'): RemoteEvent => ({
  id,
  summary,
  startDate: '2026-10-13',
  endDate: '2026-10-14',
  appKey: null,
  colorId: null, // sem cor = daycare
  eventLabelId: null,
  recurrence: null,
});

const planejar = (eventos: RemoteEvent[], caes: DogForImport[] = CAES): ImportOutcome[] =>
  planCalendarImport(eventos, caes, [], JANELA, { calendarId: AGENDA });

describe('nome repetido no cadastro: a casa do outro cão desempata', () => {
  it('"Sam/Ollie" traz o Sam da casa do Ollie (Jose), sem pendência', () => {
    const plano = planejar([evento('Sam/Ollie')]);
    expect(plano.filter((item) => item.kind === 'review')).toHaveLength(0);
    const criados = plano.filter((item) => item.kind === 'create').map((item) => (item as { dogId: string }).dogId).sort();
    expect(criados).toEqual(['dog-ollie', 'dog-sam-jose']);
  });

  it('"Sam" sozinho continua pendência: sem sinal de casa o app não chuta', () => {
    const plano = planejar([evento('Sam')]);
    const pendencias = plano.filter((item) => item.kind === 'review');
    expect(pendencias).toHaveLength(1);
    expect((pendencias[0] as { reason: string }).reason).toBe('ambiguous dog');
  });

  it('sinal de casa ambíguo (dois Ollie) NÃO desempata: o Sam segue pendência', () => {
    const caes: DogForImport[] = [
      ...CAES,
      { id: 'dog-ollie-2', name: 'Ollie', clientId: 'cl-outro', clientName: 'Outro' },
    ];
    const plano = planejar([evento('Sam/Ollie')], caes);
    const pendencias = plano.filter((item) => item.kind === 'review');
    // Os DOIS nomes ficaram ambíguos (Sam em dois cadastros, Ollie em dois cadastros): o app não chuta
    // nenhum deles e não cria nada.
    expect(pendencias.map((item) => (item as { parsed: { dogName: string } }).parsed.dogName).sort()).toEqual(['Ollie', 'Sam']);
    expect(pendencias.every((item) => (item as { reason: string }).reason === 'ambiguous dog')).toBe(true);
    expect(plano.filter((item) => item.kind === 'create')).toHaveLength(0);
  });

  it('nome único continua casando como sempre (nada muda para o caso comum)', () => {
    const plano = planejar([evento('Ollie')]);
    expect(plano.filter((item) => item.kind === 'review')).toHaveLength(0);
    expect(plano.filter((item) => item.kind === 'create').map((item) => (item as { dogId: string }).dogId)).toEqual(['dog-ollie']);
  });
});
