/**
 * Escolha do calendário do Google pela organização (módulo PURO).
 *
 * O que estes testes travam (o diagnóstico de 24/09/2026 provou que o problema era o calendário —
 * o escritório usa um secundário, o "bot venda", e o app lia só o `primary`):
 *  - sem escolha gravada o app continua no `primary` (nada muda para quem já usava);
 *  - id vazio/espaço não vira caminho de URL vazio — cai no padrão;
 *  - a escolha vai e volta da linha de `organizations` (id + nome);
 *  - quem não é `owner`/`writer` não recebe escrita, e o motivo vira frase para o gestor;
 *  - trocar de calendário AVISA que o que já foi espelhado fica no antigo (o app não move nem apaga).
 */
import {
  acessoConhecido,
  avisoDeTroca,
  corpoDaEscolha,
  DEFAULT_CALENDAR_ID,
  ehSomenteLeitura,
  escolhaDaOrganizacao,
  explicarFalhaDeListagem,
  interpretarCalendarios,
  nomeDoCalendario,
  normalizarCalendarId,
  ordenarCalendarios,
  podeEscrever,
  rotuloDeAcesso,
  textoDeAvisoDeTroca,
  TEXTO_FALTA_DE_ESCOPO,
  TEXTO_SOMENTE_LEITURA,
  type GoogleCalendarEntry,
} from '@/features/integrations/google/calendarChoice';

const BOT_VENDA = 'bot-venda@group.calendar.google.com';
const PRINCIPAL = 'raphael@packandpawsclub.com';

describe('escolha do calendário da organização', () => {
  it('sem escolha gravada o app fica no principal (comportamento antigo)', () => {
    expect(DEFAULT_CALENDAR_ID).toBe('primary');
    for (const linha of [null, undefined, {}, { google_calendar_id: null }, { google_calendar_id: '   ' }]) {
      expect(escolhaDaOrganizacao(linha)).toEqual({ calendarId: 'primary', summary: null });
    }
  });

  it('recupera o calendário escolhido (o "bot venda") da organização', () => {
    const escolha = escolhaDaOrganizacao({ google_calendar_id: BOT_VENDA, google_calendar_summary: ' bot venda ' });
    expect(escolha).toEqual({ calendarId: BOT_VENDA, summary: 'bot venda' });
    // A ida e a volta: o que a tela grava é o que a tela volta a ler.
    expect(escolhaDaOrganizacao(corpoDaEscolha(escolha))).toEqual(escolha);
  });

  it('grava id e nome com os espaços aparados (e id em branco cai no padrão)', () => {
    expect(corpoDaEscolha({ calendarId: ` ${BOT_VENDA} `, summary: ' bot venda ' })).toEqual({
      google_calendar_id: BOT_VENDA,
      google_calendar_summary: 'bot venda',
    });
    expect(corpoDaEscolha({ calendarId: '  ', summary: '' })).toEqual({
      google_calendar_id: 'primary',
      google_calendar_summary: null,
    });
  });

  it('normaliza o id e mostra um nome legível na tela', () => {
    expect(normalizarCalendarId(undefined)).toBe('primary');
    expect(nomeDoCalendario({ calendarId: 'primary', summary: null })).toBe('Primary calendar');
    expect(nomeDoCalendario({ calendarId: BOT_VENDA, summary: null })).toBe(BOT_VENDA);
    expect(nomeDoCalendario({ calendarId: BOT_VENDA, summary: 'bot venda' })).toBe('bot venda');
  });
});

describe('lista de calendários da conta', () => {
  it('lê nome, principal e papel de acesso — e ignora entrada sem id', () => {
    const itens = interpretarCalendarios({
      kind: 'calendar#calendarList',
      items: [
        { id: PRINCIPAL, summary: PRINCIPAL, primary: true, accessRole: 'owner' },
        { id: BOT_VENDA, summary: 'bot venda', accessRole: 'writer' },
        { id: 'feriados@group.calendar.google.com', summary: 'Feriados', accessRole: 'reader' },
        { summary: 'sem id não dá para usar' },
        null,
      ],
    });
    expect(itens).toHaveLength(3);
    expect(itens[1]).toEqual({ id: BOT_VENDA, summary: 'bot venda', primary: false, accessRole: 'writer' });
  });

  it('devolve lista vazia quando a resposta não tem itens', () => {
    expect(interpretarCalendarios(null)).toEqual([]);
    expect(interpretarCalendarios({})).toEqual([]);
  });

  it('põe o principal em primeiro e ordena o resto pelo nome', () => {
    const entradas: GoogleCalendarEntry[] = [
      { id: 'z', summary: 'Zeladoria', primary: false, accessRole: 'reader' },
      { id: PRINCIPAL, summary: PRINCIPAL, primary: true, accessRole: 'owner' },
      { id: BOT_VENDA, summary: 'bot venda', primary: false, accessRole: 'writer' },
    ];
    expect(ordenarCalendarios(entradas).map((item) => item.id)).toEqual([PRINCIPAL, BOT_VENDA, 'z']);
  });
});

describe('quem pode escrever no calendário escolhido', () => {
  it('owner e writer escrevem; reader e freeBusyReader não', () => {
    expect(podeEscrever('owner')).toBe(true);
    expect(podeEscrever('writer')).toBe(true);
    expect(podeEscrever('reader')).toBe(false);
    expect(podeEscrever('freeBusyReader')).toBe(false);
    expect(acessoConhecido('')).toBe(false);
    expect(acessoConhecido(null)).toBe(false);
  });

  it('etiqueta só aparece quando não dá para escrever', () => {
    expect(rotuloDeAcesso('owner')).toBeNull();
    expect(rotuloDeAcesso('writer')).toBeNull();
    expect(rotuloDeAcesso('reader')).toBe('Read-only');
    expect(rotuloDeAcesso('freeBusyReader')).toBe('Free/busy only');
    expect(rotuloDeAcesso('')).toBeNull();
  });
});

describe('aviso de troca de calendário', () => {
  const botVenda = { calendarId: BOT_VENDA, summary: 'bot venda' };

  it('avisa que o que já foi espelhado fica no calendário antigo', () => {
    const aviso = avisoDeTroca(botVenda, 'feriados@group.calendar.google.com');
    expect(aviso).toContain('bot venda');
    expect(aviso).toMatch(/does not move or delete/);
    expect(textoDeAvisoDeTroca('bot venda')).toBe(aviso);
  });

  it('não avisa nada quando o gestor escolhe o mesmo calendário', () => {
    expect(avisoDeTroca(botVenda, BOT_VENDA)).toBeNull();
    // id em branco normaliza para `primary`: quem está no principal não vê aviso nenhum.
    expect(avisoDeTroca({ calendarId: 'primary', summary: null }, '')).toBeNull();
  });
});

describe('erro legível em vez do erro cru da API', () => {
  it('reconhece calendário somente leitura pelo papel e pelo texto do erro', () => {
    expect(ehSomenteLeitura('qualquer coisa', 'reader')).toBe(true);
    expect(ehSomenteLeitura('qualquer coisa', 'writer')).toBe(false);
    expect(ehSomenteLeitura('criar evento falhou (HTTP 403): The user does not have write access to this calendar.', null)).toBe(true);
    expect(ehSomenteLeitura('criar evento falhou (HTTP 403): Insufficient Permission', null)).toBe(true);
    expect(ehSomenteLeitura('criar evento falhou (HTTP 500): backend error', null)).toBe(false);
    // Escopo é problema do APP (token antigo), não do calendário: não vira "read-only".
    expect(ehSomenteLeitura('listar calendários falhou (HTTP 403): insufficient authentication scopes', null)).toBe(false);
    expect(TEXTO_SOMENTE_LEITURA).toContain('read-only');
  });

  it('traduz a falha de listar calendários (token antigo) em "reconecte"', () => {
    expect(explicarFalhaDeListagem('listar calendários falhou (HTTP 403): Request had insufficient authentication scopes.')).toBe(
      TEXTO_FALTA_DE_ESCOPO,
    );
    expect(TEXTO_FALTA_DE_ESCOPO).toMatch(/Disconnect and connect/);
    // Erro que não é de permissão: mantém o detalhe, para não esconder o problema de verdade.
    expect(explicarFalhaDeListagem('fetch failed')).toContain('fetch failed');
  });
});
