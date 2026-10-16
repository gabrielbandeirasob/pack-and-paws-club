import { nativeBuildVersion } from 'expo-application';
import { Platform } from 'react-native';

/**
 * A build NATIVA deste aparelho (`CFBundleVersion` — a 166 de 16/10/2026, lida do Info.plist do IPA).
 *
 * ⚠️ NÃO use `Constants.expoConfig?.ios?.buildNumber` para decidir versão: o número é gerado pelo EAS
 * (`appVersionSource: "remote"` + `autoIncrement: true` no `eas.json`) e **não** existe no `app.json`,
 * então em app publicado ele volta indefinido — serve para escrever no e-mail de suporte, não para regra.
 *
 * `EXPO_PUBLIC_BUILD_ATUAL` é a SIMULAÇÃO do harness no navegador (a build web não tem número nativo) e
 * vale SÓ no web: em aparelho quem manda é o número nativo, para que um valor esquecido no ambiente não
 * faça um app de verdade se achar velho e travar o escritório.
 * (Medido em 16/10/2026: mudar `EXPO_PUBLIC_*` exige `expo export -c` — o cache do Metro reusa o bundle
 * antigo e a variável nova NÃO entra.)
 */
export function buildDoAparelho(plataforma: string = Platform.OS): number | null {
  if (plataforma === 'web') {
    const simulada = Number(process.env.EXPO_PUBLIC_BUILD_ATUAL ?? '');
    if (Number.isFinite(simulada) && simulada > 0) return simulada;
  }
  try {
    const nativo = Number(nativeBuildVersion ?? '');
    return Number.isFinite(nativo) && nativo > 0 ? nativo : null;
  } catch {
    // Web/desenvolvimento sem módulo nativo: sem informação (e sem informação NÃO bloqueia).
    return null;
  }
}
