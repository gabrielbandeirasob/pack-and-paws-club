/**
 * Suporte dentro do app: o e-mail de ajuda sai com versao, build, aparelho e conta.
 * Assim o problema chega descrito (qual binario, qual usuario) em vez de virar tres perguntas.
 */
import { SUPPORT_EMAIL, appVersionLabel, supportMailUrl } from '@/features/common/support';

describe('suporte', () => {
  it('rotula a versao com o build quando os dois existem', () => {
    expect(appVersionLabel({ version: '1.0.0', build: '31' })).toBe('1.0.0 (31)');
    expect(appVersionLabel({ version: '1.0.0', build: null })).toBe('1.0.0');
    expect(appVersionLabel({ version: null, build: '31' })).toBe('31');
    expect(appVersionLabel({})).toBe('unknown');
  });

  it('monta o mailto para o e-mail de suporte', () => {
    const url = supportMailUrl({ version: '1.0.0', build: '31', platform: 'ios', email: 'ana@exemplo.com' });
    expect(url.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);
    expect(decodeURIComponent(url)).toContain('App version: 1.0.0 (31)');
    expect(decodeURIComponent(url)).toContain('Device: ios');
    expect(decodeURIComponent(url)).toContain('Signed in as: ana@exemplo.com');
  });

  it('sem conta logada e sem versao nao escreve linha vazia nem "undefined"', () => {
    const texto = decodeURIComponent(supportMailUrl({}));
    expect(texto).toContain('App version: unknown');
    expect(texto).toContain('Signed in as: not signed in');
    expect(texto).not.toContain('undefined');
  });
});
