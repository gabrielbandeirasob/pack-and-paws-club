/**
 * Suporte dentro do app.
 *
 * Por que existe: quando o cliente reclama de algo, a conversa comeca com tres perguntas
 * ("qual versao? qual aparelho? qual conta?"). O botao de ajuda ja abre o e-mail com tudo
 * isso preenchido — o problema chega descrito, nao adivinhado.
 *
 * URL montada por funcao pura para ser testavel (o iOS nao perdoa "mailto:" malformado).
 */
export const SUPPORT_EMAIL = 'automadigitalsup@gmail.com';

export type SupportInfo = {
  version?: string | null;
  build?: string | null;
  platform?: string | null;
  email?: string | null;
};

/** "1.0.0 (31)" — versao com o numero do build, que e o que identifica o binario. */
export function appVersionLabel(info: Pick<SupportInfo, 'version' | 'build'>): string {
  const version = (info.version ?? '').trim();
  const build = (info.build ?? '').trim();
  if (version && build) return `${version} (${build})`;
  return version || build || 'unknown';
}

export function supportMailUrl(info: SupportInfo): string {
  const linhas = [
    'What happened:',
    '',
    '--- please keep the lines below ---',
    `App version: ${appVersionLabel(info)}`,
    `Device: ${(info.platform ?? 'unknown').trim() || 'unknown'}`,
    `Signed in as: ${(info.email ?? '').trim() || 'not signed in'}`,
  ];
  const assunto = 'Pack & Paws app — help';
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(linhas.join('\n'))}`;
}
