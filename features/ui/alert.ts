/**
 * Alert do app — com uma saida para o NAVEGADOR.
 *
 * Por que existe: no build web, `Alert.alert` do react-native-web e
 * `class Alert { static alert() {} }` — funcao VAZIA. Todo dialogo vira silencio: aviso de
 * erro nao aparece e, pior, o fluxo que ESPERA uma escolha do usuario trava para sempre
 * (foi assim que o passo do comprovante do motorista ficou preso no navegador).
 *
 * `showAlert` tem a MESMA assinatura do `Alert.alert`: no aparelho (iOS/Android) ele so
 * repassa a chamada — nada muda no caminho do cliente — e no navegador traduz para os
 * dialogos do browser:
 *  - 1 botao: `alert` e, em seguida, o onPress do botao (botao de cancelar so fecha);
 *  - 2 botoes, um deles marcado `style: 'cancel'`: `confirm` — OK dispara a acao e
 *    Cancelar dispara o botao de cancelar (ou o `onDismiss`, quando ele nao tem onPress);
 *  - o resto (dois botoes de ACAO, ou 3+ botoes): `prompt` numerado, porque o navegador
 *    nao desenha lista de botoes. Resposta vazia ou fora da lista = fechar (cancelar).
 * Os rotulos vao no texto do dialogo, na MESMA ordem do alerta nativo: o usuario le
 * exatamente quais opcoes existem, nada e escolhido por adivinhacao.
 */
import { Alert, Platform, type AlertButton, type AlertOptions } from 'react-native';

/** A parte da janela que a versao web usa (tipada para poder ser testada com uma falsa). */
export type DialogWindow = {
  alert(message: string): void;
  confirm(message: string): boolean;
  prompt(message: string, valorPadrao?: string): string | null;
};

/** Titulo e mensagem no mesmo texto (o navegador nao tem campo separado). */
function corpo(title: string, message?: string): string {
  return [title, message].filter((parte) => (parte ?? '').trim().length > 0).join('\n\n');
}

/** Lista de botoes como o nativo enxerga: sem nenhum, existe so o OK. */
function normalizarBotoes(buttons?: AlertButton[] | null): AlertButton[] {
  return buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
}

/** Fechou sem escolher acao: vale o botao de cancelar (se ele agir) ou o onDismiss. */
function fechar(cancelar: AlertButton | undefined, options?: AlertOptions): void {
  if (cancelar?.onPress) {
    cancelar.onPress();
    return;
  }
  options?.onDismiss?.();
}

/**
 * Versao web do alerta. Recebe a janela como parametro para o teste dirigir os dialogos
 * (sem `window` de verdade) e para o build estatico — render no servidor — nao quebrar.
 */
export function showAlertWeb(
  title: string,
  message?: string,
  buttons?: AlertButton[] | null,
  options?: AlertOptions,
  janela?: DialogWindow | null,
): void {
  // `null` explicito = "nao ha navegador" (usado no teste e no render do servidor); `undefined`
  // = usa a janela de verdade quando ela existir.
  const win = janela === undefined ? (typeof window === 'undefined' ? null : (window as unknown as DialogWindow)) : janela;
  if (!win) return;

  const botoes = normalizarBotoes(buttons);
  const cancelar = botoes.find((botao) => botao.style === 'cancel');

  if (botoes.length === 1) {
    win.alert(corpo(title, message));
    const unico = botoes[0];
    if (unico.style === 'cancel') fechar(unico, options);
    else unico.onPress?.();
    return;
  }

  if (botoes.length === 2 && cancelar) {
    const acao = botoes.find((botao) => botao !== cancelar) as AlertButton;
    const confirmado = win.confirm(`${corpo(title, message)}\n\nOK: ${acao.text}\nCancel: ${cancelar.text}`);
    if (confirmado) acao.onPress?.();
    else fechar(cancelar, options);
    return;
  }

  const linhas = botoes.map((botao, indice) => `${indice + 1}) ${botao.text}`).join('\n');
  const resposta = win.prompt(`${corpo(title, message)}\n\n${linhas}`, '');
  const escolhido = resposta === null ? null : (botoes[Number(resposta.trim()) - 1] ?? null);
  if (!escolhido) {
    fechar(cancelar, options);
    return;
  }
  escolhido.onPress?.();
}

/** O `Alert.alert` que as telas devem usar: nativo no aparelho, dialogo do browser no web. */
export function showAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[] | null,
  options?: AlertOptions,
): void {
  if (Platform.OS !== 'web') {
    // Repassa com a MESMA aridade da chamada: o Alert nativo se comporta igual e quem espia
    // `Alert.alert` num teste (com o numero exato de argumentos) continua valendo.
    if (options !== undefined) Alert.alert(title, message, buttons ?? undefined, options);
    else if (buttons !== undefined && buttons !== null) Alert.alert(title, message, buttons);
    else if (message !== undefined) Alert.alert(title, message);
    else Alert.alert(title);
    return;
  }
  showAlertWeb(title, message, buttons, options);
}
