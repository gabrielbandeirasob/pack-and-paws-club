/**
 * Escolha do calendário do Google que a organização usa — ESPELHO e IMPORTAÇÃO.
 *
 * Por que existe (24/09/2026): o app conectava na conta do escritório, o espelho gravava, mas a
 * importação não trazia nada. O diagnóstico em produção provou que a causa era o calendário: o
 * cliente mantém os agendamentos num calendário SECUNDÁRIO (o "bot venda"), e o app lia só o
 * `primary` da conta (`PRIMARY_CALENDAR` fixo em `calendarApi.ts`).
 *
 * Este módulo é PURO (sem rede e sem banco): traduz a lista de calendários da API, diz quem pode
 * escrever, monta o aviso de troca e transforma o erro cru da API numa frase que o gestor entende.
 * Quem guarda a escolha é a organização (`organizations.google_calendar_id`), não o aparelho — o
 * escritório inteiro precisa operar no MESMO calendário.
 */

/** Calendário padrão quando ninguém escolheu nada (o principal da conta conectada). */
export const DEFAULT_CALENDAR_ID = 'primary';

export type CalendarChoice = {
  calendarId: string;
  /** Nome do calendário como o Google o devolve (`summary`) — evita nova consulta só para a tela. */
  summary: string | null;
};

/** Linha de `organizations` com as colunas da escolha (a migração 027). */
export type OrganizationCalendarRow =
  | { google_calendar_id?: string | null; google_calendar_summary?: string | null }
  | null
  | undefined;

/** Item de `users/me/calendarList` que a tela usa. */
export type GoogleCalendarEntry = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
};

const limpo = (valor: string | null | undefined): string | null => {
  const texto = (valor ?? '').trim();
  return texto.length > 0 ? texto : null;
};

/** `null`, vazio ou só espaços caem no padrão — nunca num caminho de URL vazio. */
export function normalizarCalendarId(valor: string | null | undefined): string {
  return limpo(valor) ?? DEFAULT_CALENDAR_ID;
}

/** O que estava gravado na organização (ou nada ainda) → a escolha que o app usa. */
export function escolhaDaOrganizacao(linha: OrganizationCalendarRow): CalendarChoice {
  return {
    calendarId: normalizarCalendarId(linha?.google_calendar_id),
    summary: limpo(linha?.google_calendar_summary),
  };
}

/** O que gravar na organização quando o gestor escolhe. */
export function corpoDaEscolha(escolha: CalendarChoice): { google_calendar_id: string; google_calendar_summary: string | null } {
  return { google_calendar_id: normalizarCalendarId(escolha.calendarId), google_calendar_summary: limpo(escolha.summary) };
}

/** Resposta de `calendarList.list` → itens da tela (sem id não dá para usar: fica de fora). */
export function interpretarCalendarios(payload: unknown): GoogleCalendarEntry[] {
  const itens = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(itens)) return [];
  return itens
    .map((item) => {
      const bruto = item as { id?: unknown; summary?: unknown; primary?: unknown; accessRole?: unknown } | null;
      const id = typeof bruto?.id === 'string' ? bruto.id.trim() : '';
      if (!id) return null;
      return {
        id,
        summary: limpo(typeof bruto?.summary === 'string' ? bruto.summary : null) ?? id,
        primary: bruto?.primary === true,
        accessRole: typeof bruto?.accessRole === 'string' ? bruto.accessRole.trim() : '',
      };
    })
    .filter((item): item is GoogleCalendarEntry => item !== null);
}

/** Principal primeiro, depois por nome: a lista abre no calendário que quase todo mundo quer. */
export function ordenarCalendarios(entradas: GoogleCalendarEntry[]): GoogleCalendarEntry[] {
  return [...entradas].sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return a.summary.localeCompare(b.summary);
  });
}

/** Papel de acesso conhecido (a API sempre manda; entrada inventada em teste pode não mandar). */
export function acessoConhecido(accessRole: string | null | undefined): boolean {
  return limpo(accessRole) !== null;
}

/** Só `owner` e `writer` escrevem: `reader` e `freeBusyReader` derrubam o espelho. */
export function podeEscrever(accessRole: string | null | undefined): boolean {
  const papel = (accessRole ?? '').trim().toLowerCase();
  return papel === 'owner' || papel === 'writer';
}

/** Etiqueta da lista, quando o gestor precisa saber que ali não dá para escrever. */
export function rotuloDeAcesso(accessRole: string | null | undefined): string | null {
  const papel = (accessRole ?? '').trim();
  if (!papel || podeEscrever(papel)) return null;
  if (papel === 'freeBusyReader') return 'Free/busy only';
  return 'Read-only';
}

/**
 * Nome para a tela: o `summary` do Google quando existe (é ele que mostra "bot venda") e, sem ele,
 * algo identificável em vez de um id comprido.
 */
export function nomeDoCalendario(escolha: CalendarChoice): string {
  const nome = limpo(escolha.summary);
  if (nome) return nome;
  return normalizarCalendarId(escolha.calendarId) === DEFAULT_CALENDAR_ID ? 'Primary calendar' : escolha.calendarId;
}

/**
 * Aviso obrigatório antes de trocar de calendário (pedido do dono): o que já foi espelhado fica
 * onde está. O app NUNCA apaga nem move evento no calendário do escritório.
 */
export function textoDeAvisoDeTroca(nomeAntigo: string): string {
  return `Bookings already mirrored stay in ${nomeAntigo} — the app does not move or delete anything there. From the next Sync on it creates and reads in the calendar you pick here.`;
}

/** Aviso só quando a escolha MUDA de verdade (escolher o mesmo calendário não avisa nada). */
export function avisoDeTroca(atual: CalendarChoice, novoId: string): string | null {
  if (normalizarCalendarId(novoId) === normalizarCalendarId(atual.calendarId)) return null;
  return textoDeAvisoDeTroca(nomeDoCalendario(atual));
}

/** Frase que o gestor entende quando o calendário escolhido não aceita escrita. */
export const TEXTO_SOMENTE_LEITURA =
  'This calendar is read-only for the connected account, so bookings cannot be mirrored to it. Pick a calendar you can write to.';

/** Frase para o caso do token não ter permissão de listar calendários (precisa reconectar). */
export const TEXTO_FALTA_DE_ESCOPO =
  'The connected account has not allowed the app to list its calendars yet. Disconnect and connect Google Calendar again to grant it.';

/**
 * O espelho falhou porque o calendário é de leitura?
 *
 * Duas provas aceitáveis: o papel de acesso que a própria API devolveu na lista (`reader` /
 * `freeBusyReader`) ou o texto do erro. O `insufficient authentication scopes` NÃO conta — ali o
 * problema é a permissão do APP (token antigo), não o calendário.
 */
export function ehSomenteLeitura(mensagem: string, accessRole?: string | null): boolean {
  if (acessoConhecido(accessRole)) return !podeEscrever(accessRole);
  if (/insufficient authentication scopes/i.test(mensagem)) return false;
  return /read-?only|does not have (write|modify|edit)|insufficient ?permission|forbidden|HTTP 403/i.test(mensagem);
}

/** Erro legível na hora de LISTAR os calendários (o token atual não tem o escopo, por exemplo). */
export function explicarFalhaDeListagem(mensagem: string): string {
  if (/insufficient authentication scopes|insufficient ?permission|forbidden|HTTP 403/i.test(mensagem)) {
    return TEXTO_FALTA_DE_ESCOPO;
  }
  return `Could not load the calendars of the connected account: ${mensagem}`;
}

/**
 * Frase para o token não ter permissão de ler as CORES do calendário (as etiquetas da paleta nova).
 *
 * Mesmo caso do aviso acima, outro escopo: `GET /calendars/{id}` (que devolve
 * `labelProperties.eventLabels`) não aceita `calendar.events`; precisa de
 * `calendar.calendars.readonly`. Token gravado antes de 25/09/2026 não tem — daí a frase dizer
 * exatamente o que fazer (desconectar e conectar de novo) e o que o app faz enquanto isso (lê a
 * paleta antiga pelo `colorId`).
 */
export const TEXTO_FALTA_DE_ESCOPO_CORES =
  'The connected account has not allowed the app to read the colors of this calendar yet, so custom colors (the new Google labels, like Cobalt) cannot be read here. Disconnect and connect Google Calendar again to grant it — until then the app reads only the old color palette.';

/** Erro legível na hora de ler as cores do calendário. */
export function explicarFalhaDeEtiquetas(mensagem: string): string {
  if (/insufficient authentication scopes|insufficient ?permission|forbidden|HTTP 403/i.test(mensagem)) {
    return TEXTO_FALTA_DE_ESCOPO_CORES;
  }
  return `Could not read the colors of this calendar: ${mensagem}`;
}
