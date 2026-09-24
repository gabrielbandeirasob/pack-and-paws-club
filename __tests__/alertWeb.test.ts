import { Alert, Platform } from 'react-native';

import { showAlert, showAlertWeb, type DialogWindow } from '@/features/ui/alert';

/**
 * O shim de `Alert.alert` (features/ui/alert).
 *
 * No build web o `Alert.alert` do react-native-web e uma funcao VAZIA: o aviso nao aparece e o
 * fluxo que espera uma escolha trava para sempre (foi assim que o passo do comprovante do
 * motorista ficou preso). Estes testes fixam a traducao para os dialogos do navegador e garantem
 * que o caminho do APARELHO continua sendo o Alert nativo — que e o caminho do cliente.
 */

/** Janela falsa: registra o texto de cada dialogo e devolve a resposta que o teste escolher. */
function janelaFalsa(respostas: { confirmar?: boolean; promptar?: string | null } = {}) {
  const chamadas = { alert: [] as string[], confirm: [] as string[], prompt: [] as string[] };
  const win: DialogWindow = {
    alert: (mensagem) => {
      chamadas.alert.push(mensagem);
    },
    confirm: (mensagem) => {
      chamadas.confirm.push(mensagem);
      return respostas.confirmar ?? false;
    },
    prompt: (mensagem) => {
      chamadas.prompt.push(mensagem);
      return respostas.promptar ?? null;
    },
  };
  return { win, chamadas };
}

describe('alert no navegador (shim)', () => {
  it('um botao: mostra o aviso e dispara a acao', () => {
    const { win, chamadas } = janelaFalsa();
    const acao = jest.fn();

    showAlertWeb('Name required', 'Give the driver a name.', [{ text: 'OK', onPress: acao }], undefined, win);

    expect(chamadas.alert).toEqual(['Name required\n\nGive the driver a name.']);
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it('um botao de cancelar: so fecha (e avisa quem esperava o fechamento)', () => {
    const { win } = janelaFalsa();
    const onDismiss = jest.fn();

    showAlertWeb('Looking for the route', 'Reload it and try again.', [{ text: 'Dismiss', style: 'cancel' }], { onDismiss }, win);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dois botoes, um de cancelar: OK faz a acao e Cancelar nao faz nada destrutivo', () => {
    const { win, chamadas } = janelaFalsa({ confirmar: true });
    const remover = jest.fn();

    showAlertWeb('Remove stop', 'Remove Leigh Ann · Kona from the route?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: remover },
    ], undefined, win);

    expect(chamadas.confirm[0]).toContain('OK: Remove');
    expect(chamadas.confirm[0]).toContain('Cancel: Cancel');
    expect(remover).toHaveBeenCalledTimes(1);
  });

  it('dois botoes, um de cancelar: Cancelar chama o que o botao de cancelar faz', () => {
    const { win } = janelaFalsa({ confirmar: false });
    const pular = jest.fn();
    const escolher = jest.fn();

    showAlertWeb('Attach a proof photo?', 'You can attach a photo now, or skip.', [
      { text: 'Choose a photo', onPress: escolher },
      { text: 'No photo', style: 'cancel', onPress: pular },
    ], undefined, win);

    expect(escolher).not.toHaveBeenCalled();
    expect(pular).toHaveBeenCalledTimes(1);
  });

  it('tres botoes: lista numerada e o numero escolhe a opcao certa', () => {
    const { win, chamadas } = janelaFalsa({ promptar: '2' });
    const editar = jest.fn();
    const remover = jest.fn();

    showAlertWeb('Mocha · Luna', 'What do you want to do with this reservation?', [
      { text: 'Edit reservation', onPress: editar },
      { text: 'Remove', style: 'destructive', onPress: remover },
      { text: 'Cancel', style: 'cancel' },
    ], undefined, win);

    expect(chamadas.prompt[0]).toContain('1) Edit reservation');
    expect(chamadas.prompt[0]).toContain('2) Remove');
    expect(chamadas.prompt[0]).toContain('3) Cancel');
    expect(remover).toHaveBeenCalledTimes(1);
    expect(editar).not.toHaveBeenCalled();
  });

  it('dois botoes de ACAO (sem cancelar): tambem vai para a lista numerada', () => {
    const { win, chamadas } = janelaFalsa({ promptar: '2' });
    const feito = jest.fn();
    const desfazer = jest.fn();

    showAlertWeb('Client deleted', 'Nothing else was linked to this client.', [
      { text: 'Done', onPress: feito },
      { text: 'Undo', onPress: desfazer },
    ], undefined, win);

    expect(chamadas.confirm).toHaveLength(0);
    expect(desfazer).toHaveBeenCalledTimes(1);
    expect(feito).not.toHaveBeenCalled();
  });

  it('resposta vazia ou fora da lista nao dispara nenhuma acao', () => {
    const remover = jest.fn();
    const botoes = [
      { text: 'Keep', style: 'cancel' as const },
      { text: 'Remove', style: 'destructive' as const, onPress: remover },
      { text: 'Archive', onPress: jest.fn() },
    ];

    for (const resposta of ['', '9', 'abc', null]) {
      const { win } = janelaFalsa({ promptar: resposta });
      showAlertWeb('Remove the dog?', 'The history goes away.', botoes, undefined, win);
    }

    expect(remover).not.toHaveBeenCalled();
  });

  it('sem navegador (render no servidor do build) nao quebra a tela', () => {
    expect(() => showAlertWeb('Title', 'Message', undefined, undefined, null)).not.toThrow();
  });

  it('no aparelho continua chamando o Alert NATIVO, com os mesmos botoes', () => {
    expect(Platform.OS).not.toBe('web');
    const espiao = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const botoes = [{ text: 'Cancel', style: 'cancel' as const }, { text: 'Remove', style: 'destructive' as const }];

    showAlert('Remove stop', 'Remove this stop?', botoes, { cancelable: true });

    expect(espiao).toHaveBeenCalledWith('Remove stop', 'Remove this stop?', botoes, { cancelable: true });
    espiao.mockRestore();
  });
});
