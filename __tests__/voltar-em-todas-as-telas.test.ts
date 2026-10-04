import fs from 'node:fs';
import path from 'node:path';

/**
 * CONTRATO DO BOTÃO DE VOLTAR EM TODO O APP (pedido do cliente, 04/10/2026).
 *
 * O cliente reclamou de que faltavam botões para voltar. A auditoria mostrou que o cabeçalho nativo
 * está escondido em todas as telas (`app/_layout.tsx` → `screenOptions={{ headerShown: false }}`) e
 * cada tela desenhava — ou não desenhava — o seu próprio voltar: `‹ Back`, um `‹` solto, ou nada
 * (Activity, Driver hours, Edit client, Edit reservation, Change password, Van & yard, Weekly summary).
 *
 * Este teste lê a pasta de verdade (mesmo estilo do `noStrayTabs.test.ts`): TODA tela empilhada do app
 * tem de montar o `<BackHeader/>` comum. Tela nova fora das abas que esquecer o voltar quebra aqui,
 * antes de chegar no cliente.
 */

/** Telas que NÃO têm e NÃO devem ter "voltar" — cada uma com o motivo. */
const SEM_VOLTAR: Record<string, string> = {
  'login': 'porta de entrada: não existe tela anterior para onde voltar',
  'change-password': 'troca obrigatória de senha: o app NÃO pode deixar o usuário sair daqui',
};
/**
 * `+not-found.tsx` fica fora desta varredura de propósito: o expo-router trata arquivo com prefixo `+`
 * como arquivo especial (não é uma tela empilhada da jornada) e ele já tem a própria saída ("Go to
 * home screen!").
 */

describe('o botão de voltar existe em todas as telas empilhadas', () => {
  const pastaApp = path.join(process.cwd(), 'app');

  it('toda tela fora das abas monta o BackHeader (ou está na lista justificada de exceções)', () => {
    const empilhadas = fs
      .readdirSync(pastaApp)
      .filter((nome) => nome.endsWith('.tsx'))
      .map((nome) => nome.replace(/\.tsx$/, ''))
      .filter((nome) => !nome.startsWith('_') && !nome.startsWith('+'));

    const semVoltar = empilhadas.filter((nome) => {
      if (SEM_VOLTAR[nome]) return false;
      const fonte = fs.readFileSync(path.join(pastaApp, `${nome}.tsx`), 'utf8');
      return !/<BackHeader/.test(fonte);
    });

    expect(semVoltar).toEqual([]);
    // E as exceções continuam sendo só as justificadas (se uma tela ganhar voltar, sai desta lista).
    expect(empilhadas.filter((nome) => SEM_VOLTAR[nome]).sort()).toEqual(
      Object.keys(SEM_VOLTAR).sort(),
    );
  });

  it('nenhuma tela voltou a desenhar o próprio voltar (o dono do rótulo é o BackHeader)', () => {
    const empilhadas = fs
      .readdirSync(pastaApp)
      .filter((nome) => nome.endsWith('.tsx') && !nome.startsWith('_') && !nome.startsWith('+'));

    const proprios = empilhadas.filter((nome) => {
      const fonte = fs.readFileSync(path.join(pastaApp, nome), 'utf8');
      /**
       * O cliente via três padrões diferentes: `‹ Back`, um `‹` solto e um "Back" de texto no FIM de
       * telas longas (Activity, Driver hours, Van & yard) — que ninguém encontrava. Agora quem desenha
       * o voltar é só o `features/ui/BackHeader.tsx`, então nenhuma tela pode ter botão de voltar
       * próprio: nem rótulo "Back"/"Go back", nem `onPress` chamando `router.back()` na mão (chamada
       * programa de `router.back()` depois de salvar é outra coisa e continua permitida).
       */
      return /accessibilityLabel="(Back|Go back)"/.test(fonte) || /onPress=\{\(\) => router\.back\(\)\}/.test(fonte);
    });

    expect(proprios).toEqual([]);
  });

  it('o componente é o único dono do rótulo: TODO voltar fala "Go back"', () => {
    const fonte = fs.readFileSync(path.join(process.cwd(), 'features', 'ui', 'BackHeader.tsx'), 'utf8');
    expect(fonte).toContain('accessibilityLabel="Go back"');
    expect(fonte).toContain('‹ Back');
    // O alvo de toque de iOS (44pt) e o recuo do hitSlop vivem aqui, não em cada tela.
    expect(fonte).toContain('minHeight: 44');
    expect(fonte).toContain('hitSlop={12}');
  });
});
