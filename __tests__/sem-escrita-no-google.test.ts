/**
 * O APP NÃO ESCREVE NO CALENDÁRIO DO CLIENTE — TRAVA DE CÓDIGO (05/10/2026).
 *
 * Pedido do dono, depois de entender que o espelho criava/alterava/apagava evento no calendário do
 * cliente: *"quero que o aplicativo apenas importe do cliente… quero remover essa capacidade dele de
 * criar ou mudar o calendário do cliente"*.
 *
 * A remoção mexeu em três camadas, e este teste guarda as TRÊS — é o que transforma a decisão em
 * garantia, em vez de confiar na memória de quem mexer depois:
 *
 *  1. ESCOPO OAuth (`features/integrations/google/config.ts`): só `readonly`. Um token de leitura faz o
 *     Google RECUSAR escrita mesmo que alguém reintroduza uma chamada por engano.
 *  2. CLIENTE REST (`features/integrations/google/calendarApi.ts`): não existem mais `createEvent`,
 *     `updateEvent`, `deleteEvent` nem a listagem filtrada pela marca do espelho.
 *  3. NENHUMA REQUISIÇÃO DE ESCRITA no código do app: quem fala com a API do Calendar só pode usar
 *     `GET`.
 *
 * Se este teste falhar, a resposta NÃO é ajustar o teste: é voltar atrás na mudança que o ativou (ou
 * trazer a decisão do dono para a mesa de novo — a capacidade foi removida a pedido dele).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..');

/** Arquivos `.ts`/`.tsx` de um diretório, recursivo (ignora node_modules e lixo de build). */
function arquivosDeCodigo(diretorio: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(diretorio)) {
    if (['node_modules', '.expo', 'dist', '.git'].includes(entrada)) continue;
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) {
      encontrados.push(...arquivosDeCodigo(caminho));
    } else if (/\.(ts|tsx)$/.test(entrada)) {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}

/** Métodos HTTP que ESCREVEM. Um GET é a única coisa que o app pode fazer no Calendar. */
const VERBOS_DE_ESCRITA = [/method:\s*'POST'/, /method:\s*'PATCH'/, /method:\s*'PUT'/, /method:\s*'DELETE'/];

/** O arquivo fala com a API do Google Calendar? */
function falaComOCalendar(texto: string): boolean {
  return texto.includes('googleapis.com/calendar') || texto.includes('CALENDAR_API');
}

describe('o app não escreve no calendário do cliente', () => {
  it('nenhum arquivo que fala com o Calendar usa POST/PATCH/PUT/DELETE', () => {
    const infratores: string[] = [];
    for (const pasta of ['features', 'app', 'supabase/functions']) {
      for (const arquivo of arquivosDeCodigo(join(RAIZ, pasta))) {
        const texto = readFileSync(arquivo, 'utf8');
        if (!falaComOCalendar(texto)) continue;
        const linhas = texto.split('\n');
        linhas.forEach((linha, indice) => {
          if (VERBOS_DE_ESCRITA.some((padrao) => padrao.test(linha))) {
            infratores.push(`${arquivo.replace(RAIZ + '/', '')}:${indice + 1}: ${linha.trim()}`);
          }
        });
      }
    }
    expect(infratores).toEqual([]);
  });

  it('o cliente REST do Calendar não tem função de escrita nem listagem filtrada pelo espelho', () => {
    const fonte = readFileSync(join(RAIZ, 'features/integrations/google/calendarApi.ts'), 'utf8');
    // Export NÃO existe (o comentário do arquivo pode CITAR os nomes que foram removidos — é
    // documentação da decisão, e é bom que esteja lá).
    for (const proibida of ['createEvent', 'updateEvent', 'deleteEvent', 'toEventBody', 'listEvents']) {
      expect(fonte).not.toMatch(new RegExp(`export (async )?function ${proibida}\\b`));
    }
    expect(fonte).not.toContain('eventLabelVersion');
    // O que ele FAZ: ler eventos (todos, sem filtro de marca), ler calendários e ler as cores.
    for (const permitida of ['listAllEvents', 'listCalendars', 'getCalendarLabels']) {
      expect(fonte).toContain(permitida);
    }
  });

  it('os escopos pedidos ao Google são só de LEITURA', () => {
    const fonte = readFileSync(join(RAIZ, 'features/integrations/google/config.ts'), 'utf8');
    expect(fonte).toContain("'https://www.googleapis.com/auth/calendar.events.readonly'");
    expect(fonte).not.toContain("'https://www.googleapis.com/auth/calendar.events'");
    // Nenhum escopo sem `readonly` além dos que já são de leitura por natureza.
    const escopos = [...fonte.matchAll(/'(https:\/\/www\.googleapis\.com\/auth\/[^']+)'/g)].map((m) => m[1]);
    expect(escopos.length).toBeGreaterThan(0);
    for (const escopo of escopos) {
      expect(escopo.endsWith('.readonly')).toBe(true);
    }
  });

  it('o módulo do espelho não existe mais (nem no app, nem na cópia do servidor)', () => {
    const caminhos = [
      'features/integrations/google/calendarSync.ts',
      'features/integrations/google/sync.ts',
      'features/calendar/googleEvents.ts',
      'supabase/functions/_shared/importacao/calendarSync.ts',
    ];
    for (const relativo of caminhos) {
      expect(() => statSync(join(RAIZ, relativo))).toThrow();
    }
  });
});
