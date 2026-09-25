/**
 * MOTIVO DO PROBLEMA — a parada que não pôde ser feita.
 *
 * Defeito corrigido em 25/09/2026 (achado na caçada de bugs): o botão *Problem* do motorista só marcava
 * `status = 'skipped'`. O escritório recebia o aviso ("reported a problem") **sem saber o que houve** —
 * portão fechado? cachorro não estava? cliente ausente? O banco tem o campo de texto (`proof_note`) e o
 * push do gestor já o inclui; faltava perguntar.
 *
 * Por que LISTA e não campo de texto: o motorista está na rua, muitas vezes dirigindo. Um toque resolve, e
 * o escritório recebe sempre uma frase consistente (dá para contar/agrupar depois).
 *
 * Escolha do agente2: usar `proof_note` (campo que já existe e já é exibido ao gestor) em vez de criar
 * coluna nova — menos mudança na véspera da apresentação, e o texto sai prefixado ("Problem: ...") para
 * não ser confundido com observação de foto.
 */

import { showAlert } from '@/features/ui/alert';

/** Motivos possíveis de uma parada não realizada (frases curtas, em inglês — quem lê é o escritório). */
export const MOTIVOS_DE_PROBLEMA = [
  'Client not home',
  'Dog not available',
  'Access blocked',
  'Ran out of time',
] as const;

export const PREFIXO_DO_PROBLEMA = 'Problem: ';

/** Texto que vai para o banco (e daí para o push do gestor). */
export function textoDoProblema(motivo: string): string {
  return `${PREFIXO_DO_PROBLEMA}${motivo.trim()}`;
}

/**
 * Pergunta o motivo e devolve o texto pronto para gravar, ou `null` quando o motorista desiste
 * (cancelar NÃO pode marcar a parada como problema).
 */
export function escolherMotivoDoProblema(): Promise<string | null> {
  return new Promise((resolve) => {
    let respondido = false;
    const responder = (valor: string | null) => {
      if (respondido) return;
      respondido = true;
      resolve(valor);
    };
    showAlert(
      'What happened?',
      'The office is told the reason together with the alert.',
      [
        ...MOTIVOS_DE_PROBLEMA.map((motivo) => ({ text: motivo, onPress: () => responder(textoDoProblema(motivo)) })),
        { text: 'Cancel', style: 'cancel' as const, onPress: () => responder(null) },
      ],
      { cancelable: true, onDismiss: () => responder(null) },
    );
  });
}
