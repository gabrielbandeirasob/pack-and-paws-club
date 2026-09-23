/**
 * Lista de clientes (ordem + filtro de inativos), aviso de duplicado e desfazer exclusao.
 *
 * O que estes testes protegem:
 * - cliente arquivado nao desaparece da tela sem o gestor pedir, e ativo vem primeiro;
 * - a familia nao vira dois cadastros escondidos: mesmo nome ou mesmo cao avisa antes;
 * - desfazer so e oferecido quando NADA foi perdido, e reinsere com os MESMOS ids.
 */
import {
  canUndoClientDelete,
  clientRestoreRows,
  duplicateHint,
  findDuplicateClients,
  inactiveCount,
  sortClientsForList,
} from '@/features/clients/clientsService';

describe('lista de clientes', () => {
  const clientes = [
    { id: 'c-1', name: 'Zoe Alves', active: false, dogs: [] },
    { id: 'c-2', name: 'Álvaro Dias', active: true, dogs: [] },
    { id: 'c-3', name: 'ana souza', active: true, dogs: [] },
  ];

  it('ativos primeiro e depois ordem alfabetica sem acento', () => {
    // "Álvaro" (alvaro) vem antes de "ana" porque a comparacao e sem acento: a-l < a-n.
    expect(sortClientsForList(clientes).map((c) => c.id)).toEqual(['c-2', 'c-3', 'c-1']);
  });

  it('mostra os inativos por padrao e aceita esconder', () => {
    expect(sortClientsForList(clientes)).toHaveLength(3);
    expect(sortClientsForList(clientes, { showInactive: false }).map((c) => c.id)).toEqual(['c-2', 'c-3']);
    expect(inactiveCount(clientes)).toBe(1);
  });

  it('nao muda a lista original (ordena em copia)', () => {
    const antes = clientes.map((c) => c.id);
    sortClientsForList(clientes);
    expect(clientes.map((c) => c.id)).toEqual(antes);
  });
});

describe('aviso de duplicado', () => {
  const existentes = [
    { id: 'c-1', name: 'Ana Souza', dogs: ['Mowgli'] },
    { id: 'c-2', name: 'Leigh Ann', dogs: ['Kona'] },
  ];

  it('avisa por nome igual (ignorando maiuscula e acento)', () => {
    const achados = findDuplicateClients(existentes, { name: 'ana souza', dogs: [] });
    expect(achados.map((c) => c.id)).toEqual(['c-1']);
    expect(duplicateHint(achados)).toContain('Ana Souza');
    expect(duplicateHint(achados)).toContain('Mowgli');
  });

  it('avisa por nome de cao igual mesmo com nome de cliente diferente', () => {
    const achados = findDuplicateClients(existentes, { name: 'Outro nome', dogs: ['  kona '] });
    expect(achados.map((c) => c.id)).toEqual(['c-2']);
    expect(duplicateHint(achados)).toContain('same family');
  });

  it('aviso de duplicado nao vira [object Object] com o cao na forma da lista (nome + foto)', () => {
    // A lista de clientes carrega o cao com foto (23/09/2026). O aviso de duplicado monta o
    // texto a partir dos nomes — se alguem voltar a usar o objeto direto, vira lixo na tela.
    const comFoto = [{ id: 'c-3', name: 'Leigh Ann', dogs: [{ name: 'Kona', photo_url: 'https://x/dog-photos/org/dog/kona.jpg' }] }];
    const achados = findDuplicateClients(comFoto, { name: 'Outro nome', dogs: ['kona'] });
    expect(achados.map((c) => c.id)).toEqual(['c-3']);
    const aviso = duplicateHint(achados);
    expect(aviso).toContain('Kona');
    expect(aviso).not.toContain('object');
  });

  it('nao avisa sem motivo, nem com entrada vazia', () => {
    expect(duplicateHint(findDuplicateClients(existentes, { name: 'Bruno Lima', dogs: ['Thor'] }))).toBeNull();
    expect(findDuplicateClients(existentes, { name: '', dogs: [] })).toEqual([]);
    expect(duplicateHint([])).toBeNull();
  });

  it('resume a partir de tres candidatos', () => {
    const muitos = [
      { id: 'a', name: 'X', dogs: ['A'] },
      { id: 'b', name: 'Y', dogs: ['A'] },
      { id: 'c', name: 'Z', dogs: ['A'] },
    ];
    expect(duplicateHint(findDuplicateClients(muitos, { name: '', dogs: ['A'] }))).toContain('and 1 more');
  });
});

describe('desfazer a exclusao', () => {
  it('so oferece desfazer quando nao havia reserva nem rota', () => {
    expect(canUndoClientDelete({ dogs: 2, reservations: 0, upcomingReservations: 0, routeStops: 0 })).toBe(true);
    expect(canUndoClientDelete({ dogs: 2, reservations: 1, upcomingReservations: 0, routeStops: 0 })).toBe(false);
    expect(canUndoClientDelete({ dogs: 2, reservations: 0, upcomingReservations: 0, routeStops: 3 })).toBe(false);
  });

  it('reinsere com os MESMOS ids (cliente, caes e instrucoes)', () => {
    const rows = clientRestoreRows({
      organizationId: 'org-1',
      client: { id: 'c-1', name: 'Ana Souza', phone: '4155551234', city: 'San Francisco', active: true, source_contact_identifier: 'contato-9' },
      dogs: [{ id: 'dog-1', name: 'Mowgli', breed: 'Poodle' }],
      instructions: { id: 'ins-1', text: 'Gate code 4321' },
    });
    expect(rows.client).toMatchObject({ id: 'c-1', organization_id: 'org-1', name: 'Ana Souza', source_contact_identifier: 'contato-9' });
    expect(rows.dogs[0]).toMatchObject({ id: 'dog-1', client_id: 'c-1', organization_id: 'org-1', name: 'Mowgli', medical_notes: null });
    expect(rows.instruction).toMatchObject({ id: 'ins-1', client_id: 'c-1', pickup_access_instructions: 'Gate code 4321' });
  });

  it('sem instrucoes nao tenta inserir linha vazia', () => {
    const rows = clientRestoreRows({
      organizationId: 'org-1',
      client: { id: 'c-2', name: 'Sem Instrucao' },
      dogs: [],
      instructions: null,
    });
    expect(rows.instruction).toBeNull();
    expect(rows.dogs).toEqual([]);
    expect(rows.client).toMatchObject({ id: 'c-2', active: true, latitude: null });
  });
});
