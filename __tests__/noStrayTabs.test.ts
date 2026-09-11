import fs from 'node:fs';
import path from 'node:path';

import { getTabsForRole } from '@/features/navigation/roleTabs';

// O app mostrou uma aba "two" na barra de baixo (resto do template do Expo).
// O expo-router registra TODO arquivo dentro de app/(tabs)/ como aba: nao basta
// declarar as abas na mao, tem de nao existir arquivo sobrando na pasta.
// Este teste le a pasta de verdade e falha se aparecer aba nao declarada.
describe('rotas das abas', () => {
  it('nao sobra arquivo de aba fora das abas declaradas', () => {
    const tabsDir = path.join(process.cwd(), 'app', '(tabs)');
    const arquivos = fs
      .readdirSync(tabsDir)
      .filter((nome) => nome.endsWith('.tsx') && nome !== '_layout.tsx')
      .map((nome) => nome.replace(/\.tsx$/, ''));

    const declaradas = new Set([
      ...getTabsForRole('manager').map((tab) => tab.route),
      ...getTabsForRole('driver').map((tab) => tab.route),
    ]);

    expect(arquivos.filter((nome) => !declaradas.has(nome))).toEqual([]);
  });

  it('as telas que os papeis usam existem na pasta', () => {
    const tabsDir = path.join(process.cwd(), 'app', '(tabs)');
    const arquivos = new Set(fs.readdirSync(tabsDir));
    for (const nome of ['index', 'calendar', 'dispatch', 'clients', 'more', 'driver', 'schedule', 'assigned', 'profile']) {
      expect(arquivos.has(`${nome}.tsx`)).toBe(true);
    }
  });
});
