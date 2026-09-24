/**
 * Resolve o que falta para rodar os módulos PUROS do app direto no Node (sem jest/tsx/ts-node
 * instalados aqui): o alias `@/` do projeto e os imports SEM extensão (`./calendarSync`), que o jest
 * resolve pelo babel e o Node ESM não. Node 26 já apaga os tipos de TypeScript nativamente.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = new URL('../', import.meta.url);

function comExtensao(caminho) {
  if (/\.[cm]?[jt]sx?$/.test(caminho)) return caminho;
  for (const sufixo of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(`${caminho}${sufixo}`)) return `${caminho}${sufixo}`;
  }
  return caminho;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const alvo = fileURLToPath(new URL(specifier.slice(2), RAIZ));
    return next(new URL(`file://${comExtensao(alvo)}`).href, context);
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const alvo = new URL(specifier, context.parentURL ?? RAIZ);
    if (!alvo.pathname.endsWith('.mjs') && !alvo.pathname.endsWith('.json')) {
      return next(new URL(`file://${comExtensao(fileURLToPath(alvo))}`).href, context);
    }
  }
  return next(specifier, context);
}
