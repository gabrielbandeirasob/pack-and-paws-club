/**
 * VETORES DA DISTRIBUIÇÃO DO PACK (pedido do dono, 29/09/2026).
 *
 * O que estes vetores travam: "motorista Gabriel ficou com tais cachorros, motorista Rafael ficou com
 * tal" — o agrupamento sai do `walking with` (walkerId) da folha do Total Pack, e não da rota.
 * Nomes de cães reais do cliente, como nos outros vetores do projeto.
 */
import { packDistribution, packRows, type DayDog, type PackEntry, type PackRow } from '@/features/dashboard/dayOperation';

const caes: DayDog[] = [
  { dogId: 'filo', dogName: 'Filó', clientName: 'Amor', serviceType: 'daycare' },
  { dogId: 'luna', dogName: 'Luna', clientName: 'John', serviceType: 'daycare' },
  { dogId: 'mowgli', dogName: 'Mowgli', clientName: 'Leigh Ann', serviceType: 'boarding' },
  { dogId: 'kona', dogName: 'Kona', clientName: 'Leigh Ann', serviceType: 'daycare' },
  { dogId: 'cocoa', dogName: 'Cocoa', clientName: 'Sylvie', serviceType: 'daycare', goesToDaycare: false },
];

const membros = [
  { id: 'gabriel', name: 'Gabriel' },
  { id: 'rafael', name: 'Rafael' },
  { id: 'jordan', name: 'Jordan' },
];

const entradas: PackEntry[] = [
  { dogId: 'filo', inPack: true, walkerId: 'gabriel' },
  { dogId: 'luna', inPack: true, walkerId: 'gabriel' },
  { dogId: 'mowgli', inPack: true, walkerId: 'rafael' },
  { dogId: 'kona', inPack: true, walkerId: null },
  // Cocoa é chegada fora do horário: já nasce FORA do pack (contrato do cliente, 28/09/2026).
];

describe('packDistribution', () => {
  it('agrupa por pessoa na ordem da folha do Total Pack, com quem não ficou com cão nenhum fora da lista', () => {
    const linhas = packRows(caes, entradas);
    const grupos = packDistribution(linhas, membros);

    expect(grupos.map((grupo) => [grupo.name, grupo.dogs.map((cao) => cao.dogName)])).toEqual([
      ['Gabriel', ['Filó', 'Luna']],
      ['Rafael', ['Mowgli']],
      ['Unassigned', ['Kona']],
    ]);
    // Jordan não ficou com nenhum cão: não aparece (lista do dono é "quem ficou com o quê").
    expect(grupos.some((grupo) => grupo.name === 'Jordan')).toBe(false);
  });

  it('cão tirado do pack (X do gestor) não entra na distribuição, nem quando é chegada fora do horário', () => {
    const linhas = packRows(caes, [...entradas, { dogId: 'cocoa', inPack: true, walkerId: 'jordan' }]);
    expect(packDistribution(linhas, membros).some((grupo) => grupo.dogs.some((cao) => cao.dogName === 'Cocoa'))).toBe(true);

    const comX = packRows(caes, [...entradas, { dogId: 'cocoa', inPack: false, walkerId: 'jordan' }]);
    const grupos = packDistribution(comX, membros);
    expect(grupos.some((grupo) => grupo.dogs.some((cao) => cao.dogName === 'Cocoa'))).toBe(false);
    // Cocoa sem entrada nenhuma também fica de fora: `goesToDaycare: false` = fora do pack por padrão.
    expect(packDistribution(packRows(caes, entradas), membros).flatMap((g) => g.dogs).map((c) => c.dogName))
      .not.toContain('Cocoa');
  });

  it('caminhante que não está mais entre os membros ativos aparece como "Team member" em vez de sumir', () => {
    const linhas: PackRow[] = packRows(caes, [
      { dogId: 'filo', inPack: true, walkerId: 'antigo' },
      { dogId: 'luna', inPack: true, walkerId: 'gabriel' },
    ]);
    const grupos = packDistribution(linhas, membros);
    // Mowgli e Kona não têm entrada no dia ⇒ entram no pack por padrão e ainda sem caminhante: é o
    // grupo de "Unassigned", que vem por último. O caminhante antigo fica no meio, com o rótulo dele.
    expect(grupos.map((grupo) => grupo.name)).toEqual(['Gabriel', 'Team member', 'Unassigned']);
    expect(grupos[1].dogs.map((cao) => cao.dogName)).toEqual(['Filó']);
  });

  it('sem ninguém assinado, a lista é só o grupo de sem caminhante', () => {
    const linhas = packRows(caes, [{ dogId: 'filo', inPack: true, walkerId: null }]);
    const grupos = packDistribution(linhas, membros);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ walkerId: null, name: 'Unassigned' });
  });

  it('os rótulos podem ser escritos por quem chama (a tela passa o idioma dela)', () => {
    const linhas = packRows(caes, [{ dogId: 'filo', inPack: true, walkerId: null }]);
    const grupos = packDistribution(linhas, [], { semCaminhante: 'Sem caminhante' });
    expect(grupos[0].name).toBe('Sem caminhante');
  });
});
