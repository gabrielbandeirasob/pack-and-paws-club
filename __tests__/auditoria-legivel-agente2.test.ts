/**
 * VETORES DO AGENTE2 — auditoria legível (melhoria 1 da revisão das contas, 25/09/2026).
 *
 * O requisito é do dono: o escritório precisa ver "quem fez o que" — quem cancelou a reserva, quem trocou
 * o nome do cão, quem marcou problema na rota. O que eu NÃO aceito: resumo que inventa. Se o campo mudado
 * não tem tradução conhecida, o texto mostra o nome técnico em vez de adivinhar.
 */
import { describeAuditEntry, tempoRelativo, type AuditEntry } from '@/features/audit/describe';

const ALEX = 'u-alex';
const nomes = { [ALEX]: 'Alex Rivera', 'u-sam': 'Sam Costa' };

function entrada(parcial: Partial<AuditEntry>): AuditEntry {
  return {
    id: 1,
    action: 'updated',
    entity_type: 'dogs',
    entity_id: 'd-1',
    actor_user_id: ALEX,
    created_at: '2026-09-25T01:12:27Z',
    metadata: null,
    ...parcial,
  };
}

it('rename de cao sai como frase de gente', () => {
  const lido = describeAuditEntry(entrada({
    entity_type: 'dogs',
    metadata: { changed: ['name'], before: { name: 'Mowgli' }, after: { name: 'Mowgli [teste]' } },
  }), nomes);
  expect(lido.actor).toBe('Alex Rivera');
  expect(lido.resumo).toBe('renamed the dog Mowgli → Mowgli [teste]');
});

it('mudanca de status de parada mostra de -> para (o caso "marcou problema")', () => {
  const lido = describeAuditEntry(entrada({
    entity_type: 'route_stops',
    metadata: { changed: ['status'], before: { status: 'pending' }, after: { status: 'problem' } },
  }), nomes);
  expect(lido.resumo).toBe('changed the stop — status pending → problem');
});

it('remocao de reserva diz o que saiu', () => {
  const lido = describeAuditEntry(entrada({
    action: 'deleted',
    entity_type: 'reservations',
    metadata: { before: {} },
  }), nomes);
  expect(lido.resumo).toBe('removed the booking');
  expect(lido.detalhe).toBe('the record no longer exists');
});

it('quem fez aparece pelo nome; autor desconhecido vira Someone (nunca credito errado)', () => {
  expect(describeAuditEntry(entrada({ actor_user_id: 'u-sam' }), nomes).actor).toBe('Sam Costa');
  expect(describeAuditEntry(entrada({ actor_user_id: null }), nomes).actor).toBe('Someone');
  expect(describeAuditEntry(entrada({ actor_user_id: 'u-outro' }), nomes).actor).toBe('Someone');
});

it('campo sem traducao conhecida aparece pelo nome tecnico, sem inventar significado', () => {
  const lido = describeAuditEntry(entrada({
    entity_type: 'clients',
    metadata: { changed: ['observacao_interna'], before: {}, after: {} },
  }), nomes);
  expect(lido.resumo).toBe('changed the client');
  expect(lido.detalhe).toBe('changed: observacao_interna');
});

it('campos com traducao viram rotulos amigaveis e sem repetir', () => {
  const lido = describeAuditEntry(entrada({
    entity_type: 'clients',
    metadata: { changed: ['phone', 'address_line_1', 'address_line_2', 'postal_code'], before: {}, after: {} },
  }), nomes);
  expect(lido.detalhe).toBe('changed: phone, address, ZIP');
});

it('criacao nao carrega detalhe de campos', () => {
  const lido = describeAuditEntry(entrada({
    action: 'created',
    entity_type: 'clients',
    metadata: { after: { name: 'Ana Souza' } },
  }), nomes);
  expect(lido.resumo).toBe('added the client Ana Souza');
  expect(lido.detalhe).toBeNull();
});

it('tabela sem traducao usa o proprio nome da tabela', () => {
  const lido = describeAuditEntry(entrada({ entity_type: 'tabela_nova', metadata: { after: {} } }), nomes);
  expect(lido.resumo).toBe('changed the tabela_nova');
});

it('tempo relativo: agora, minutos, horas, ontem e data', () => {
  const agora = new Date('2026-09-25T12:00:00Z');
  expect(tempoRelativo('2026-09-25T11:59:40Z', agora)).toBe('just now');
  expect(tempoRelativo('2026-09-25T11:48:00Z', agora)).toBe('12 min ago');
  expect(tempoRelativo('2026-09-25T09:00:00Z', agora)).toBe('3 h ago');
  expect(tempoRelativo('2026-09-24T09:00:00Z', agora)).toBe('yesterday');
  expect(tempoRelativo('2026-09-20T09:00:00Z', agora)).toBe('5 days ago');
  expect(tempoRelativo('2026-09-01T09:00:00Z', agora)).toBe('09/01/2026');
});
