#!/usr/bin/env node
/**
 * GERA AS CÓPIAS COMPARTILHADAS DA IMPORTAÇÃO — para o app e a função agendada usarem a MESMA regra.
 *
 * Por que existe: a importação do Google Calendar (cores, dois cães numa parada, escala fixa,
 * exceções, cancelamento) é a regra mais delicada do app. A função agendada precisa dela para rodar
 * com o app fechado — e duas implementações da mesma regra divergem em uma semana. Então o app
 * continua sendo a fonte, e este script COPIA os módulos puros para `supabase/functions/_shared/`
 * (que é o diretório que o deploy das Edge Functions publica), ajustando só os imports.
 *
 * Uso:  node scripts/gera-importacao-compartilhada.mjs
 * (o teste `__tests__/importacao-compartilhada.test.ts` falha se a cópia ficar velha)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..');
const DESTINO = join(RAIZ, 'supabase/functions/_shared/importacao');

/** Fonte → nome do arquivo gerado (todos ficam planos, num diretório só). */
const MODULOS = [
  'features/calendar/dates.ts',
  'features/calendar/googleColors.ts',
  'features/calendar/googleEvents.ts',
  'features/calendar/dayMath.ts',
  'features/integrations/google/calendarChoice.ts',
  'features/integrations/google/calendarSync.ts',
  'features/integrations/google/localReservations.ts',
  'features/integrations/google/calendarApi.ts',
  'features/integrations/google/importPlan.ts',
  'features/integrations/google/importService.ts',
  'features/integrations/google/importPorts.ts',
];

export const CABECALHO =
  '// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.\n' +
  '// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha\n' +
  '// se esta cópia ficar desatualizada.\n';

/** Só os imports mudam: alias do app → caminho relativo com extensão (Deno exige `.ts`). */
export function transformar(fonte) {
  return fonte
    .replace(/from '@\/features\/calendar\/([A-Za-z0-9_]+)'/g, "from './$1.ts'")
    .replace(/from '\.\/([A-Za-z0-9_]+)'/g, "from './$1.ts'")
    .replace(/from '@supabase\/supabase-js'/g, "from 'npm:@supabase/supabase-js@2'");
}

function main() {
  mkdirSync(DESTINO, { recursive: true });
  for (const relativo of MODULOS) {
    const origem = readFileSync(join(RAIZ, relativo), 'utf8');
    const nome = relativo.split('/').pop();
    writeFileSync(join(DESTINO, nome), CABECALHO + transformar(origem), 'utf8');
    console.log('gerado:', nome, 'de', relativo);
  }
}

if (process.argv[1] && process.argv[1].endsWith('gera-importacao-compartilhada.mjs')) main();
