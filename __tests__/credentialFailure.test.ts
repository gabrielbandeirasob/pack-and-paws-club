/**
 * `ehFalhaDeCredencial` — UM só lugar decide se o refresh token do Google MORREU.
 *
 * Achado da auditoria de integrações (02/10/2026): o robô do servidor retentava para sempre uma
 * credencial revogada e o app continuava dizendo "Connected" quando o Google recusava a renovação. A
 * distinção que resolve os dois é esta função: `invalid_grant`/401 = credencial morta (reconectar);
 * qualquer outra coisa (rede, timeout) = credencial viva (tenta de novo depois).
 *
 * Módulo puro, compartilhado com a função agendada pelo gerador — a cópia do servidor é conferida em
 * `importacao-compartilhada.test.ts`.
 */
import { ehFalhaDeCredencial } from '@/features/integrations/google/credentialFailure';

describe('ehFalhaDeCredencial', () => {
  it('401 é credencial morta (o endpoint de token do Google usa esse status para token inválido)', () => {
    expect(ehFalhaDeCredencial('qualquer coisa', 401)).toBe(true);
    expect(ehFalhaDeCredencial(null, 401)).toBe(true);
    expect(ehFalhaDeCredencial(undefined, 401)).toBe(true);
  });

  it('400 com invalid_grant é credencial morta (acesso revogado pelo dono, senha mudada, app removido)', () => {
    expect(ehFalhaDeCredencial('invalid_grant', 400)).toBe(true);
    expect(ehFalhaDeCredencial('invalid_grant: Token has been revoked', 400)).toBe(true);
    expect(ehFalhaDeCredencial('Token has been expired or revoked.', 400)).toBe(true);
    expect(ehFalhaDeCredencial('invalid refresh token', 400)).toBe(true);
    // O caso do hook: o erro chega embrulhado numa mensagem de `Error`.
    expect(ehFalhaDeCredencial('Error: invalid_grant: Token has been revoked')).toBe(true);
  });

  it('sem status, reconhece o marcador no texto (o app não vê o status HTTP do refresh)', () => {
    expect(ehFalhaDeCredencial('invalid_grant')).toBe(true);
    expect(ehFalhaDeCredencial('  invalid_grant  ')).toBe(true);
  });

  it('erro de REDE não é credencial morta — a próxima rodada funciona', () => {
    expect(ehFalhaDeCredencial('Network request failed')).toBe(false);
    expect(ehFalhaDeCredencial('timeout', 500)).toBe(false);
    expect(ehFalhaDeCredencial('', 500)).toBe(false);
    expect(ehFalhaDeCredencial(null, null)).toBe(false);
    expect(ehFalhaDeCredencial(undefined)).toBe(false);
  });

  it('400 de parâmetro (missing grant_type) NÃO apaga a credencial', () => {
    // O Google usa 400 para muita coisa; só o marcador de credencial morta conta.
    expect(ehFalhaDeCredencial('invalid_request', 400)).toBe(false);
    expect(ehFalhaDeCredencial('invalid_client', 400)).toBe(false);
  });
});
