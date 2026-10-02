/**
 * `describeSyncFailure` — o MOTIVO da falha do espelho (auditoria de integrações, 02/10/2026).
 *
 * O cartão mostrava só "N event(s) could not be sent.", então nem o gestor nem o suporte sabiam se
 * era permissão (calendário somente leitura), rede ou o Google recusando o evento. A função reusa o
 * mesmo mapa de motivos da importação (`motivoDaFalha`) e diz QUAL foi a primeira falha.
 */
import { describeSyncFailure } from '@/features/integrations/google/sync';

describe('describeSyncFailure', () => {
  it('sem falhas, texto vazio (a tela não mostra nada)', () => {
    expect(describeSyncFailure([])).toBe('');
  });

  it('uma falha: conta e mostra o motivo da primeira', () => {
    const texto = describeSyncFailure([
      { action: 'create', reservationId: 'res:1', error: 'criar evento falhou (HTTP 403): The user does not have write access to this calendar.' },
    ]);
    expect(texto).toContain('1 event(s) could not be sent.');
    expect(texto).toContain('The user does not have write access to this calendar.');
  });

  it('motivo conhecido (do banco) é traduzido pela tabela da importação', () => {
    const texto = describeSyncFailure([
      { action: 'update', reservationId: 'res:2', error: 'new row for relation "reservations" violates check constraint "reservations_check"' },
    ]);
    expect(texto).toContain('end_date before start_date');
  });

  it('várias falhas: conta todas e cita só a primeira (a tela não vira um paredão)', () => {
    const texto = describeSyncFailure([
      { action: 'create', reservationId: 'res:1', error: 'primeira falha' },
      { action: 'create', reservationId: 'res:2', error: 'segunda falha' },
    ]);
    expect(texto).toContain('2 event(s) could not be sent.');
    expect(texto).toContain('primeira falha');
    expect(texto).not.toContain('segunda falha');
  });

  it('mensagem crua gigante é cortada (não estoura o layout do cartão)', () => {
    const gigante = 'x'.repeat(400);
    const texto = describeSyncFailure([{ action: 'delete', reservationId: 'res:3', error: gigante }]);
    expect(texto).not.toContain(gigante);
    expect(texto).toContain('x'.repeat(137) + '...');
  });
});
