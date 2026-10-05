import fs from 'node:fs';
import path from 'node:path';

/**
 * DOIS AJUSTES PEDIDOS DEPOIS DE TESTAR A 128 (dono, 04/10/2026):
 *
 *  1. *"quando eu arrasto o cachorro a tela desce ou sobe junto"* — o `ScrollView` do quadro fica ativo
 *     durante o arrasto e, no iOS, o scroll nativo rouba o gesto de pan: a lista rola junto com o cão.
 *     A correção é o quadro DESLIGAR o scroll enquanto o arrasto está em andamento.
 *
 *  2. *"a caixa seletora do pick-up e drop off tem uma coloração confusa"* — o seletor de perna usava o
 *     MESMO desenho (`driverOption`) dos chips de motorista logo abaixo dele, e o estado ativo era um
 *     bloco verde cheio. Agora o seletor tem desenho PRÓPRIO (segmented control fino, ativo em `sage` com
 *     borda verde), separado por um rótulo próprio.
 *
 * Este vetor trava as duas coisas no código onde elas vivem (o componente do arrasto e o quadro).
 */

const raiz = process.cwd();
const ler = (...partes: string[]) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

describe('arrasto e seletor de perna — os dois ajustes pedidos depois da 128', () => {
  it('o componente do arrasto avisa o quadro para DESLIGAR o scroll durante o gesto', () => {
    const reorder = ler('features', 'dispatch', 'ReorderableStops.tsx');

    // O aviso de "estou arrastando" existe e é usado no começo e no fim do gesto (inclui o cancelamento).
    expect(reorder).toContain('onDraggingChange');
    expect(reorder).toMatch(/onDraggingChange\?\.\(true\)|onDraggingChange\(true\)/);
    expect(reorder).toMatch(/onDraggingChange\?\.\(false\)|onDraggingChange\(false\)/);
    // E o toque na alça captura o gesto antes do conteúdo (Android) — a alça é o único alvo do arrasto.
    expect(reorder).toContain('onStartShouldSetPanResponderCapture');
  });

  it('o quadro desliga o scroll enquanto arrasta e volta a ligar ao soltar', () => {
    const quadro = ler('features', 'dispatch', 'DispatchBoard.tsx');

    expect(quadro).toContain('scrollEnabled={!arrastando}');
    expect(quadro).toContain('onDraggingChange={setArrastando}');
    // O scroll do quadro precisa de identidade para o teste (e para o próprio time conferir no aparelho).
    expect(quadro).toContain('testID="dispatch-scroll"');
  });

  it('o seletor de perna tem desenho PRÓPRIO (não é o chip do motorista) e o ativo é discreto', () => {
    const quadro = ler('features', 'dispatch', 'DispatchBoard.tsx');
    const motorista = ler('app', '(tabs)', 'driver.tsx');

    // No quadro: o seletor da perna não pode mais vestir o mesmo estilo dos chips de motorista.
    const trecho = quadro.slice(quadro.indexOf('dispatch-phase-selector'), quadro.indexOf('dispatch-phase-selector') + 900);
    expect(trecho).not.toContain('styles.driverOption');
    expect(trecho).toContain('styles.faseOpcao');
    // Ativo = verde CLARO (sage) com texto escuro; nada de bloco verde cheio em metade da tela.
    expect(quadro).toMatch(/faseOpcaoAtiva: \{[^}]*backgroundColor: colors\.sage/);
    expect(quadro).toMatch(/faseOpcaoTextoAtivo: \{[^}]*color: colors\.forest900/);

    // No motorista, segmento iOS: papel sobre trilho sage, ainda com texto escuro.
    expect(motorista).toMatch(/phaseActive: \{[^}]*backgroundColor: colors\.paper/);
    expect(motorista).toMatch(/phaseTextActive: \{[^}]*color: colors\.forest900/);
  });
});
