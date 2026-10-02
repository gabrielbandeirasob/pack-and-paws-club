/**
 * A CÓPIA COMPARTILHADA DA IMPORTAÇÃO NÃO PODE FICAR VELHA.
 *
 * A função agendada (`supabase/functions/google-calendar-sync`) roda a MESMA regra de importação do
 * app, a partir de `supabase/functions/_shared/importacao/*`. Esses arquivos são GERADOS de
 * `features/...` por `scripts/gera-importacao-compartilhada.mjs` — e este teste é a trava: se alguém
 * editar a regra no app e esquecer de rodar o gerador, a CI quebra aqui, com o nome do arquivo.
 *
 * A transformação abaixo é a mesma do gerador (alias do app → caminho relativo com `.ts`, e o
 * `@supabase/supabase-js` → `npm:@supabase/supabase-js@2`). Mexeu num, mexa no outro.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..');
const DESTINO = join(RAIZ, 'supabase/functions/_shared/importacao');

const CABECALHO =
  '// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.\n' +
  '// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha\n' +
  '// se esta cópia ficar desatualizada.\n';

const MODULOS = [
  'features/calendar/dates.ts',
  'features/calendar/googleColors.ts',
  'features/calendar/googleEvents.ts',
  'features/calendar/dayMath.ts',
  'features/integrations/google/calendarChoice.ts',
  'features/integrations/google/credentialFailure.ts',
  'features/integrations/google/calendarSync.ts',
  'features/integrations/google/localReservations.ts',
  'features/integrations/google/calendarApi.ts',
  'features/integrations/google/importPlan.ts',
  'features/integrations/google/importService.ts',
  'features/integrations/google/importPorts.ts',
];

function transformar(fonte: string): string {
  return fonte
    .replace(/from '@\/features\/calendar\/([A-Za-z0-9_]+)'/g, "from './$1.ts'")
    .replace(/from '\.\/([A-Za-z0-9_]+)'/g, "from './$1.ts'")
    .replace(/from '@supabase\/supabase-js'/g, "from 'npm:@supabase/supabase-js@2'");
}

describe('importação compartilhada (app × função agendada)', () => {
  it.each(MODULOS)('%s está sincronizado com a cópia do servidor', (relativo) => {
    const origem = readFileSync(join(RAIZ, relativo), 'utf8');
    const copia = readFileSync(join(DESTINO, relativo.split('/').pop() as string), 'utf8');
    expect(copia).toBe(CABECALHO + transformar(origem));
  });

  it('a cópia não arrasta dependência de React Native nem alias do app', () => {
    for (const relativo of MODULOS) {
      const copia = readFileSync(join(DESTINO, relativo.split('/').pop() as string), 'utf8');
      expect(copia).not.toMatch(/from '@\//);
      expect(copia).not.toMatch(/from 'react-native'/);
      expect(copia).not.toMatch(/from 'expo/);
      // Deno exige extensão em import relativo: todo `from './x'` tem de estar `.ts`.
      expect(copia).not.toMatch(/from '\.\/[A-Za-z0-9_]+'/);
    }
  });
});
