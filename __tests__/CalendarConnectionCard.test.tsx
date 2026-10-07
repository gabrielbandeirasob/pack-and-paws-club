import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { CalendarConnectionCard, janelaDeImportacao } from '@/features/integrations/google/CalendarConnectionCard';
import { TEXTO_FALTA_DE_ESCOPO, TEXTO_FALTA_DE_ESCOPO_CORES } from '@/features/integrations/google/calendarChoice';
import { planCalendarImport, type BookingForImport, type DogForImport } from '@/features/integrations/google/importPlan';
import { esquecerSincronizacao, lerUltimaSincronizacao, marcarSincronizacao } from '@/features/integrations/google/lastSyncStore';

import { enviarCredencialAoServidor, revogarCredencialDoServidor, servidorTemCredencial } from '@/features/integrations/google/serverCredential';

jest.mock('@/features/integrations/google/useCalendarConnection');
// A importacao e testada no seu proprio modulo; aqui o card so precisa dizer o que fez com o resumo.
jest.mock('@/features/integrations/google/importService', () => ({
  runCalendarImport: jest.fn(),
  hasImportChanges: jest.requireActual('@/features/integrations/google/importService').hasImportChanges,
}));
/**
 * A CREDENCIAL NO SERVIDOR e o RELÓGIO LOCAL, mockados (achado da CI em 28/09/2026).
 *
 * O cartão, ao abrir com `autoImport`, pergunta à função do servidor se a credencial já está lá
 * (`servidorTemCredencial`) — chamada de REDE de verdade dentro de um teste de unidade. Aqui na máquina
 * de desenvolvimento ela responde rápido; no runner da CI (sem rota para o domínio) ela pendura até o
 * timeout do Jest: o portão de qualidade ficou vermelho com 1 teste de 1121 falhando por timeout, num
 * arquivo que passava em 0,8 s localmente. Teste de unidade não fala com a rede: os dois módulos entram
 * mockados, e o comportamento da trava de 10 min segue coberto em `__tests__/sincronizacao-automatica.test.ts`.
 */
jest.mock('@/features/integrations/google/serverCredential', () => ({
  servidorTemCredencial: jest.fn(async () => true),
  enviarCredencialAoServidor: jest.fn(async () => true),
  revogarCredencialDoServidor: jest.fn(async () => true),
}));

// A lista de calendarios e as cores do calendario vem da API do Google: aqui sao injetadas (nenhuma
// chamada de rede).
jest.mock('@/features/integrations/google/calendarApi', () => ({
  listCalendars: jest.fn(),
  calendarIdDaOrigem: jest.fn(async () => CAL_PRINCIPAL),
  getCalendarLabels: jest.fn(),
  CalendarApiError: jest.requireActual('@/features/integrations/google/calendarApi').CalendarApiError,
}));

/** O que está gravado na ORGANIZAÇÃO (a escolha é por organização, não por aparelho). */
let mockOrganizacao: { google_calendar_id: string | null; google_calendar_summary: string | null } = {
  google_calendar_id: null,
  google_calendar_summary: null,
};

const CAL_PRINCIPAL = 'raphael@packandpawsclub.com';
/** Calendário secundário do escritório: é nele que estão os agendamentos (o print do cliente). */
const CAL_BOT_VENDA = 'bot-venda@group.calendar.google.com';
const CAL_FERIADOS = 'feriados@group.calendar.google.com';

const contaCalendarios = [
  { id: CAL_PRINCIPAL, summary: CAL_PRINCIPAL, primary: true, accessRole: 'owner' },
  { id: CAL_BOT_VENDA, summary: 'bot venda', primary: false, accessRole: 'writer' },
  { id: CAL_FERIADOS, summary: 'Feriados', primary: false, accessRole: 'reader' },
];

/** Escritas no banco: o alvo e conferir o que a tela manda para o Supabase. */
const insercoes: { tabela: string; valores: Record<string, unknown> }[] = [];
const atualizacoes: { tabela: string; valores: Record<string, unknown> }[] = [];
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const chain: Record<string, unknown> = {};
      chain.insert = (valores: Record<string, unknown>) => {
        insercoes.push({ tabela, valores });
        return chain;
      };
      chain.update = (valores: Record<string, unknown>) => {
        atualizacoes.push({ tabela, valores });
        return chain;
      };
      chain.delete = () => chain;
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = async () => ({ data: { id: 'novo-id' }, error: null });
      chain.maybeSingle = async () => ({ data: mockOrganizacao, error: null });
      // Escrita com `.select('id')`: o banco devolve a linha atingida — sem isso o card trataria a gravação
      // como bloqueada (é justamente o que o app passou a conferir, vistoria 02/10/2026).
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'novo-id' }], error: null }).then(res);
      return chain;
    },
  },
}));

const useCalendarConnection = jest.requireMock('@/features/integrations/google/useCalendarConnection').useCalendarConnection as jest.Mock;
const runCalendarImport = jest.requireMock('@/features/integrations/google/importService').runCalendarImport as jest.Mock;
const listCalendars = jest.requireMock('@/features/integrations/google/calendarApi').listCalendars as jest.Mock;
const getCalendarLabels = jest.requireMock('@/features/integrations/google/calendarApi').getCalendarLabels as jest.Mock;

/** Conexao falsa no formato que o card consome. */
function conexao(
  status: 'not_configured' | 'disconnected' | 'expired' | 'connected',
  extras: Record<string, unknown> = {},
) {
  return {
    status,
    email: status === 'connected' ? 'raphael@packandpawsclub.com' : null,
    connect: jest.fn().mockResolvedValue('connected'),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue('token-123'),
    rememberEmail: jest.fn().mockResolvedValue(true),
    ...extras,
  };
}

const hoje = todayLocalISO();
const dogs: DogForImport[] = [{ id: 'dog-luna', name: 'Luna', clientName: 'Maria' }];
const bookings: BookingForImport[] = [];
const onImported = jest.fn();

function props() {
  return { organizationId: 'org-1', dogs, bookings, onImported };
}

/**
 * Espera a escolha da organização chegar na tela (a leitura é assíncrona).
 * `toHaveTextContent` (e não `within(...).getByText`) porque a consulta dentro de um nó procura nos
 * FILHOS — o texto do próprio `Text` com testID não é encontrado assim.
 */
async function esperandoEscolha(screen: Awaited<ReturnType<typeof render>>, nome: string) {
  await waitFor(() => expect(screen.getByTestId('google-calendar-escolhido')).toHaveTextContent(nome));
}

describe('CalendarConnectionCard', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    insercoes.length = 0;
    atualizacoes.length = 0;
    mockOrganizacao = { google_calendar_id: null, google_calendar_summary: null };
    // A marca da sincronização automática vive fora do React: sem zerar, um teste contaminaria o outro.
    await esquecerSincronizacao();
    runCalendarImport.mockResolvedValue({ created: 0, updated: 0, cancelled: 0, review: [], failures: [] });
    listCalendars.mockResolvedValue(contaCalendarios);
    getCalendarLabels.mockResolvedValue([]);
    // `mockClear` NÃO desfaz `mockResolvedValue`: sem voltar ao padrão aqui, um teste que força a
    // credencial a falhar contaminaria os seguintes (a conferência pós-Connect usa os dois).
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(true);
    (servidorTemCredencial as jest.Mock).mockResolvedValue(true);
    (revogarCredencialDoServidor as jest.Mock).mockResolvedValue(true);
  });

  it('explica que o Google nao esta no build, em vez de mostrar botao que nao funciona', async () => {
    useCalendarConnection.mockReturnValue(conexao('not_configured'));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    expect(screen.getByTestId('google-calendar-nao-configurado')).toBeTruthy();
    expect(screen.queryByTestId('google-calendar-connect')).toBeNull();
  });

  it('oferece conectar quando ha credencial no build e nenhuma conexao ainda', async () => {
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    expect(ctx.connect).toHaveBeenCalled();
  });

  it('depois de conectar, ja importa os agendamentos do calendario', async () => {
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
  });

  /* -------- conferência da credencial no servidor (auditoria de integrações, 02/10/2026) --------
   *
   * Antes: o Connect chamava `enviarCredencialAoServidor` e IGNORAVA o resultado — o cartão dizia
   * "Connected" com a importação automática desligada (o servidor sem a credencial). Agora o envio é
   * conferido com uma leitura de volta (`servidorTemCredencial`).
   */
  it('Connect confere no servidor: credencial que NÃO chegou avisa na tela', async () => {
    // Sem sync bem-sucedido: este teste isola a prova negativa/positiva do servidor.
    runCalendarImport.mockRejectedValue(new Error('Sem rede para sincronizar'));
    // Envio recusado E o servidor respondendo que não tem: é o caso legítimo do aviso.
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(false);
    (servidorTemCredencial as jest.Mock).mockResolvedValue(false);
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-aviso-servidor')).toBeTruthy());
    expect(screen.getByTestId('google-calendar-aviso-servidor')).toHaveTextContent(/did not receive the Google credential/);
    // A conta segue conectada no aparelho: a importação do primeiro plano continua funcionando.
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
  });

  /**
   * ⚠️ AJUSTE DE 06/10/2026 (aviso falso medido em produção): o envio que volta `ok` já é prova de
   * gravação — a leitura de volta só serve para o caso de o ENVIO ter falhado. Antes, uma leitura que
   * não respondia (`null`: sem rede / função fora do ar por um instante) acendia o aviso vermelho com a
   * importação automática funcionando (o robô do n8n importava a cada 15 min e a credencial estava no
   * servidor).
   */
  it('Connect: envio com "ok" NÃO alarma, mesmo com a leitura de volta negativa', async () => {
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(true);
    (servidorTemCredencial as jest.Mock).mockResolvedValue(false);
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));

    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('google-calendar-aviso-servidor')).toBeNull();
  });

  it('Connect: leitura de volta indisponível (null) também NÃO alarma quando o envio foi ok', async () => {
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(true);
    (servidorTemCredencial as jest.Mock).mockResolvedValue(null);
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));

    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('google-calendar-aviso-servidor')).toBeNull();
  });

  it('Connect: envio falhou mas o servidor JÁ tem a credencial → sem aviso (a importação está ligada)', async () => {
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(false);
    (servidorTemCredencial as jest.Mock).mockResolvedValue(true);
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));

    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('google-calendar-aviso-servidor')).toBeNull();
  });

  it('aviso velho some sozinho quando o cartão reabre e o servidor TEM a credencial', async () => {
    // Sem sync bem-sucedido: este teste isola a prova negativa/positiva do servidor.
    runCalendarImport.mockRejectedValue(new Error('Sem rede para sincronizar'));
    // 1) Connect com envio e leitura negativos: o aviso aparece (é o caso legítimo).
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(false);
    (servidorTemCredencial as jest.Mock).mockResolvedValue(false);
    useCalendarConnection.mockReturnValue(conexao('disconnected'));
    const screen = await render(<CalendarConnectionCard {...props()} autoImport />);
    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-aviso-servidor')).toBeTruthy());

    // 2) A conexão passa a valer e o servidor responde que TEM: o aviso não pode ficar na tela.
    (servidorTemCredencial as jest.Mock).mockResolvedValue(true);
    useCalendarConnection.mockReturnValue(conexao('connected'));
    screen.rerender(<CalendarConnectionCard {...props()} autoImport />);
    await waitFor(() => expect(screen.queryByTestId('google-calendar-aviso-servidor')).toBeNull());
  });

  it.each(['null', 'erro'])('envio falho e conferência %s não acendem faixa vermelha', async (resposta) => {
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(false);
    if (resposta === 'erro') (servidorTemCredencial as jest.Mock).mockRejectedValue(new Error('Sem rede'));
    else (servidorTemCredencial as jest.Mock).mockResolvedValue(null);
    // A importação também falha: não pode mascarar o falso aviso limpando-o por sucesso.
    runCalendarImport.mockRejectedValue(new Error('Sem rede para sincronizar'));
    useCalendarConnection.mockReturnValue(conexao('disconnected'));
    const screen = await render(<CalendarConnectionCard {...props()} />);
    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('google-calendar-aviso-servidor')).toBeNull();
  });

  it('sincronização bem-sucedida limpa a faixa antiga após prova negativa', async () => {
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(false);
    (servidorTemCredencial as jest.Mock).mockResolvedValue(false);
    let concluir!: (resumo: object) => void;
    runCalendarImport.mockReturnValue(new Promise((resolve) => { concluir = resolve; }));
    useCalendarConnection.mockReturnValue(conexao('disconnected'));
    const screen = await render(<CalendarConnectionCard {...props()} />);
    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-aviso-servidor')).toBeTruthy());
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    await act(async () => concluir({ created: 52, updated: 0, cancelled: 0, review: [], failures: [] }));
    await waitFor(() => expect(screen.queryByTestId('google-calendar-aviso-servidor')).toBeNull());
    useCalendarConnection.mockReturnValue(conexao('connected'));
    await screen.rerender(<CalendarConnectionCard {...props()} />);
    expect(screen.getByTestId('google-calendar-resumo')).toHaveTextContent(/52 from Google/);
  });

  it('importação automática bem-sucedida também limpa a faixa, mesmo sem conferência positiva', async () => {
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(false);
    (servidorTemCredencial as jest.Mock).mockResolvedValue(false);
    runCalendarImport.mockRejectedValueOnce(new Error('Falha no primeiro Sync'));
    useCalendarConnection.mockReturnValue(conexao('disconnected'));
    const screen = await render(<CalendarConnectionCard {...props()} autoImport />);
    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-aviso-servidor')).toBeTruthy());
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    useCalendarConnection.mockReturnValue(conexao('connected'));
    await screen.rerender(<CalendarConnectionCard {...props()} autoImport />);
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('google-calendar-aviso-servidor')).toBeNull());
  });

  it.each([
    ['Cooper/Dora 🏠', '3', ['Cooper', 'Dora'], false],
    ['Mav/Storm', '2', ['Mav', 'Storm'], true],
  ] as const)('revisão de %s identifica cada cão e conserva o botão conforme a cor', async (title, colorId, nomes, permiteEscolha) => {
    // Usa as decisões reais: antes as duas linhas tinham o mesmo título e a mesma chave React.
    const review = planCalendarImport([{
      id: 'dois-caes', summary: title, colorId, startDate: '2026-10-08', endDate: '2026-10-09', appKey: null,
    }], [], [], { from: '2026-10-07', to: '2026-10-10' }).filter((item) => item.kind === 'review');
    expect(review).toHaveLength(2);
    runCalendarImport.mockResolvedValue({ created: 0, updated: 0, cancelled: 0, review, failures: [] });
    useCalendarConnection.mockReturnValue(conexao('connected'));
    const screen = await render(<CalendarConnectionCard {...props()} />);
    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    for (const nome of nomes) {
      expect(screen.getByText(`${title} → ${nome}`)).toBeTruthy();
      expect(Boolean(screen.queryByLabelText(`Choose dog for ${title} → ${nome}`))).toBe(permiteEscolha);
    }
    expect(screen.getAllByText('2026-10-08 · No dog with this name in the app — register the dog and sync again')).toHaveLength(2);
    expect(screen.queryByText(title)).toBeNull();
  });

  it('Connect com credencial CONFIRMADA no servidor não mostra aviso', async () => {
    (enviarCredencialAoServidor as jest.Mock).mockResolvedValue(true);
    (servidorTemCredencial as jest.Mock).mockResolvedValue(true);
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));

    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('google-calendar-aviso-servidor')).toBeNull();
  });

  /* ---------------- sincronização automática (áudio do dono, 27/09/2026) ---------------- */

  it('com autoImport, importa SOZINHO ao abrir o cartão — sem tocar em Sync', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({ created: 0, updated: 0, cancelled: 1, review: [], failures: [] });
    const screen = await render(<CalendarConnectionCard {...props()} autoImport />);

    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Auto · 1 cancelled/)).toBeTruthy());
  });

  it('sem autoImport, o cartão NÃO sincroniza sozinho (comportamento antigo preservado)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    const tela = await render(<CalendarConnectionCard {...props()} />);
    await waitFor(() => expect(tela.getByTestId('google-calendar-sync')).toBeTruthy());
    expect(runCalendarImport).not.toHaveBeenCalled();
  });

  it('não repete o automático quando a última sincronização foi há pouco (trava de 10 min)', async () => {
    await marcarSincronizacao(Date.now());
    useCalendarConnection.mockReturnValue(conexao('connected'));
    const tela = await render(<CalendarConnectionCard {...props()} autoImport />);

    await waitFor(() => expect(tela.getByTestId('google-calendar-sync')).toBeTruthy());
    expect(runCalendarImport).not.toHaveBeenCalled();
  });

  it('com a conta conectada, importa o calendario e resume o resultado', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({ created: 2, updated: 0, cancelled: 0, review: [], failures: [] });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    expect(screen.getByText(/raphael@packandpawsclub\.com/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));

    const chamada = runCalendarImport.mock.calls[0][0];
    expect(chamada.accessToken).toBe('token-123');
    expect(chamada.calendarId).toBe('primary');
    await waitFor(() => expect(screen.getByTestId('google-calendar-resumo')).toBeTruthy());
    // Texto do resumo no idioma da interface (inglês) — o cliente viu a mistura de idiomas.
    expect(screen.getByText(/2 from Google/)).toBeTruthy();
  });

  it('desconecta quando o gestor pede (revoke no servidor deu certo)', async () => {
    // 🪤 Auditoria de 02/10/2026: o revoke no servidor vem PRIMEIRO — sem ele a tela diria
    // "desconectado" enquanto o robô continuaria lendo o calendário do cliente.
    (revogarCredencialDoServidor as jest.Mock).mockResolvedValueOnce(true);
    // A marca do robô está posta: desconectar tem de esquecê-la (item 16).
    await marcarSincronizacao(Date.now());
    const ctx = conexao('connected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-disconnect'));
    await waitFor(() => expect(ctx.disconnect).toHaveBeenCalled());
    // Item 16: o aparelho esquece a marca do robô — reconectar não pode achar que sincronizou há pouco.
    expect(await lerUltimaSincronizacao()).toBeNull();
  });

  it('revoke que FALHA não diz que desconectou (e explica o motivo)', async () => {
    (revogarCredencialDoServidor as jest.Mock).mockResolvedValueOnce(false);
    const ctx = conexao('connected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-disconnect'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-erro')).toBeTruthy());
    expect(ctx.disconnect).not.toHaveBeenCalled();
  });

  // ------------------------------- identidade da conta e credencial MORTA (auditoria, 02/10/2026)

  it('conta conectada sem e-mail: grava o primary e reenvia a credencial (identidade real)', async () => {
    const ctx = conexao('connected', { email: null });
    useCalendarConnection.mockReturnValue(ctx);
    await render(<CalendarConnectionCard {...props()} />);

    // O `id` do calendário PRINCIPAL é o e-mail da conta — é assim que o `connected_email` do servidor
    // é preenchido (item 15) e o cartão passa a mostrar o e-mail em vez do nome do calendário.
    await waitFor(() => expect(ctx.rememberEmail).toHaveBeenCalledWith(CAL_PRINCIPAL));
    await waitFor(() => expect(enviarCredencialAoServidor).toHaveBeenCalledWith('primary'));
  });

  it('token expirado/revogado: o cartão oferece RECONNECT (não continua dizendo "Connected")', async () => {
    const ctx = conexao('expired');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    expect(screen.getByTestId('google-calendar-reconnect')).toBeTruthy();
    expect(screen.queryByTestId('google-calendar-disconnect')).toBeNull();

    await fireEvent.press(screen.getByTestId('google-calendar-reconnect'));
    expect(ctx.connect).toHaveBeenCalled();
  });

  it('mostra o erro quando a sincronizacao falha de verdade', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected', { getAccessToken: jest.fn().mockRejectedValue(new Error('A conexão com o Google expirou. Conecte novamente.')) }));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-erro')).toBeTruthy());
  });

  // ------------------------------------------------------------------ importacao (Google -> app)

  it('mostra o que veio do Google e recarrega a agenda', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({ created: 2, updated: 1, cancelled: 0, review: [], failures: [] });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-resumo')).toBeTruthy());
    expect(screen.getByText(/2 from Google/)).toBeTruthy();
    // A agenda recarrega para o gestor ja ver as reservas que chegaram.
    expect(onImported).toHaveBeenCalled();
  });

  it('a importação consulta de HOJE para frente (nada do passado entra)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));

    // Nada do passado entra, e a janela é o que também impede cancelar uma reserva de ontem que veio
    // do Google.
    const esperada = janelaDeImportacao();
    const chamada = runCalendarImport.mock.calls[0][0];
    expect(chamada.range).toEqual({ timeMin: esperada.timeMin, timeMax: esperada.timeMax });
    expect(chamada.window).toEqual({ from: esperada.from, to: esperada.to });
    expect(chamada.window.from).toBe(hoje);
    expect(chamada.window.to).toBe(addDaysISO(hoje, 180));
  });

  it('lista o que veio do Google sem nome utilizável, com o motivo', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'e1',
          title: '',
          date: '2026-10-05',
          reason: 'unreadable',
          parsed: { serviceType: 'daycare', cancels: false, dogName: '(no title)', startDate: '2026-10-05', endDate: '2026-10-06', weekdays: [], skipDates: [], openEnded: false },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-revisao')).toBeTruthy());
    expect(screen.getByText('From Google — not registered in the app')).toBeTruthy();
    expect(screen.getByText('(no title)')).toBeTruthy();
    expect(screen.getByText(/This event has no title — pick the dog and we save it/)).toBeTruthy();
    expect(screen.getByLabelText('Choose dog for ')).toBeTruthy();
  });

  it('cão não cadastrado aparece na lista de "not registered" com o motivo', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'e-rex',
          title: 'Rex',
          date: '2026-10-05',
          reason: 'unknown dog',
          parsed: { serviceType: 'boarding', cancels: false, dogName: 'Rex', startDate: '2026-10-05', endDate: '2026-10-06', weekdays: [], skipDates: [], openEnded: false },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-revisao')).toBeTruthy());
    expect(screen.getByText(/No dog with this name in the app — register the dog and sync again/)).toBeTruthy();
    // O serviço veio da COR, então o gestor ainda pode ligar o evento a um cão daqui.
    expect(screen.getByLabelText('Choose dog for Rex')).toBeTruthy();
  });

  it('cor não reconhecida aparece na lista própria e NÃO oferece escolher cão (sem serviço não há reserva)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'e-sem-cor',
          title: 'Pietro',
          date: '2026-10-05',
          reason: 'unrecognized color',
          parsed: { serviceType: null, cancels: false, dogName: 'Pietro', startDate: '2026-10-05', endDate: '2026-10-06', weekdays: [], skipDates: [], openEnded: false },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-cor-desconhecida')).toBeTruthy());
    expect(screen.getByText('From Google — color not recognized')).toBeTruthy();
    expect(screen.getByText(/No service in this color — green is boarding, blue is daycare/)).toBeTruthy();
    // Sem cor o serviço é indefinido: nada de botão para gravar uma reserva sem `service_type`.
    expect(screen.queryByTestId('google-calendar-revisao')).toBeNull();
    expect(screen.queryByLabelText('Choose dog for Pietro')).toBeNull();
  });

  it('falha da importação mostra o MOTIVO da primeira falha, não só a contagem', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      review: [],
      failures: [
        {
          eventId: 'e-pietro',
          reservationId: undefined,
          error: 'new row for relation "reservations" violates check constraint "reservations_check"',
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    // Antes o gestor via só "1 item(s) from Google could not be saved" e o suporte ficava cego: agora
    // a tela diz QUAL foi o motivo da primeira falha (o erro cru do Postgres traduzido).
    await waitFor(() => expect(screen.getByTestId('google-calendar-erro')).toBeTruthy());
    expect(screen.getByTestId('google-calendar-erro')).toHaveTextContent(
      '1 item(s) from Google could not be saved. First: end_date before start_date',
    );
  });

  it('ao escolher o cão da revisão, cria a reserva com o evento gravado (anti-duplicata)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'e-rex',
          title: 'Boarding · Rex',
          date: '2026-10-05',
          reason: 'duplicate',
          parsed: { serviceType: 'boarding', cancels: false, dogName: 'Rex', startDate: '2026-10-05', endDate: '2026-10-07', weekdays: [], skipDates: [], openEnded: false },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);
    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-revisao')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Choose dog for Boarding · Rex'));
    await fireEvent.press(screen.getByLabelText('Select dog'));
    await fireEvent.press(screen.getByLabelText('Select Luna of Maria'));
    await fireEvent.press(screen.getByTestId('google-calendar-salvar-revisao'));

    await waitFor(() => expect(insercoes.length).toBe(1));
    expect(insercoes[0].tabela).toBe('reservations');
    expect(insercoes[0].valores).toMatchObject({
      organization_id: 'org-1',
      dog_id: 'dog-luna',
      service_type: 'boarding',
      start_date: '2026-10-05',
      end_date: '2026-10-07',
      google_event_id: 'e-rex',
      source: 'google',
    });
    // A pendencia sai da lista.
    expect(screen.queryByTestId('google-calendar-revisao')).toBeNull();
  });

  // ------------------------------------------------------- calendário escolhido pela organização

  it('mostra a conta conectada (mesmo sem e-mail no token) e o calendário escolhido', async () => {
    // O token do app não pede escopo de e-mail: `email` chega nulo (era o defeito do print).
    useCalendarConnection.mockReturnValue(conexao('connected', { email: null }));
    mockOrganizacao = { google_calendar_id: CAL_BOT_VENDA, google_calendar_summary: 'bot venda' };
    const screen = await render(<CalendarConnectionCard {...props()} />);

    // A conta aparece pelo nome do calendário PRINCIPAL da conta conectada...
    await waitFor(() => expect(screen.getByText(/Connected as raphael@packandpawsclub\.com/)).toBeTruthy());
    // ...e o calendário escolhido aparece no cartão.
    await esperandoEscolha(screen, 'bot venda');
    expect(screen.queryByTestId('google-calendar-padrao')).toBeNull();
  });

  it('sem escolha gravada, o padrão continua sendo o calendário principal', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await waitFor(() => expect(screen.getByTestId('google-calendar-padrao')).toBeTruthy());
    await esperandoEscolha(screen, 'Primary calendar');

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(runCalendarImport.mock.calls[0][0].calendarId).toBe('primary');
  });

  it('o Sync importa do calendário escolhido pela organização', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    mockOrganizacao = { google_calendar_id: CAL_BOT_VENDA, google_calendar_summary: 'bot venda' };
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await esperandoEscolha(screen, 'bot venda');
    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(runCalendarImport.mock.calls[0][0].calendarId).toBe(CAL_BOT_VENDA);
  });

  it('trocar de calendário grava na ORGANIZAÇÃO e avisa que os eventos ficam no calendário antigo', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    mockOrganizacao = { google_calendar_id: CAL_BOT_VENDA, google_calendar_summary: 'bot venda' };
    const screen = await render(<CalendarConnectionCard {...props()} />);
    await esperandoEscolha(screen, 'bot venda');

    await fireEvent.press(screen.getByTestId('google-calendar-trocar'));
    // O aviso é do calendário ATUAL: nada é movido nem apagado no calendário antigo.
    expect(screen.getByText(/does not move or delete anything there/)).toBeTruthy();
    expect(screen.getByText('Feriados')).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Use calendar Feriados'));
    await fireEvent.press(screen.getByTestId('google-calendar-salvar-calendario'));

    await waitFor(() => expect(atualizacoes.length).toBe(1));
    expect(atualizacoes[0].tabela).toBe('organizations');
    expect(atualizacoes[0].valores).toEqual({ google_calendar_id: CAL_FERIADOS, google_calendar_summary: 'Feriados' });

    // E o SERVIDOR passa a sincronizar o calendário NOVO (auditoria de integrações, 02/10/2026): antes
    // só a organização mudava e o robô seguia lendo o calendário antigo.
    expect(enviarCredencialAoServidor).toHaveBeenCalledWith(CAL_FERIADOS);

    // A escolha nova vale na hora e o aviso da troca fica na tela.
    await esperandoEscolha(screen, 'Feriados');
    // RegExp (e não string) porque `toHaveTextContent` compara o conteúdo inteiro quando recebe texto.
    expect(screen.getByTestId('google-calendar-aviso-troca')).toHaveTextContent(/bot venda/);
  });

  it('calendário de leitura: o app importa dele normalmente (só lê, não há o que bloquear)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    mockOrganizacao = { google_calendar_id: CAL_FERIADOS, google_calendar_summary: 'Feriados' };
    const screen = await render(<CalendarConnectionCard {...props()} />);
    await esperandoEscolha(screen, 'Feriados');

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(runCalendarImport.mock.calls[0][0].calendarId).toBe(CAL_FERIADOS);
    // Nada de aviso de "somente leitura" no topo: era o freio do espelho, que não existe mais.
    expect(screen.queryByTestId('google-calendar-escolhido-acesso')).toBeNull();
    expect(screen.queryByTestId('google-calendar-erro')).toBeNull();
  });

  it('token antigo (sem permissão de listar calendários) explica que é preciso reconectar', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    listCalendars.mockRejectedValue(new Error('listar calendários falhou (HTTP 403): Request had insufficient authentication scopes.'));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-trocar'));

    await waitFor(() =>
      expect(screen.getByTestId('google-calendar-erro-calendarios')).toHaveTextContent(TEXTO_FALTA_DE_ESCOPO),
    );
    expect(screen.getByTestId('google-calendar-recarregar-calendarios')).toBeTruthy();
  });

  // --------------------------------------------------------- cores do calendário (bug 56, labels)

  it('mostra QUAL cor foi lida no item da lista (Cobalto #4A86E8) — o suporte para de adivinhar', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'ev-zara',
          title: 'zara',
          date: '2026-09-26',
          reason: 'unrecognized color',
          // O evento veio pintado com a etiqueta da paleta nova e SEM `colorId`: era o defeito de
          // produção (build 55) que fazia o agendamento do cão cadastrado virar "cor não reconhecida".
          parsed: {
            serviceType: null,
            color: { source: 'label', labelId: 'lab-amarela', labelName: 'Amarelo', backgroundColor: '#ffd666', colorId: null, meaning: null },
            cancels: false,
            dogName: 'zara',
            startDate: '2026-09-26',
            endDate: '2026-09-27',
            weekdays: [],
            skipDates: [],
            openEnded: false,
          },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-cor-desconhecida')).toBeTruthy());

    expect(screen.getByTestId('google-calendar-cor-ev-zara')).toHaveTextContent('Amarelo (#ffd666)');
  });

  it('mostra a cor lida também na lista de cão não cadastrado (nome + hex + colorId legado)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'ev-rex',
          title: 'Rex',
          date: '2026-10-05',
          reason: 'unknown dog',
          parsed: {
            serviceType: 'daycare',
            color: { source: 'label', labelId: 'lab-azul', labelName: 'Cobalto', backgroundColor: '#4A86E8', colorId: '7', meaning: { kind: 'service', serviceType: 'daycare' } },
            cancels: false,
            dogName: 'Rex',
            startDate: '2026-10-05',
            endDate: '2026-10-06',
            weekdays: [],
            skipDates: [],
            openEnded: false,
          },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-revisao')).toBeTruthy());

    expect(screen.getByTestId('google-calendar-cor-ev-rex')).toHaveTextContent('Cobalto (#4A86E8) · colorId 7 (Peacock)');
  });

  it('token sem o escopo das cores: o cartão explica que é preciso reconectar, sem erro cru', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    getCalendarLabels.mockRejectedValue(
      new Error('ler as cores do calendário falhou (HTTP 403): Request had insufficient authentication scopes.'),
    );
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await waitFor(() =>
      expect(screen.getByTestId('google-calendar-erro-etiquetas')).toHaveTextContent(TEXTO_FALTA_DE_ESCOPO_CORES),
    );
    expect(screen.queryByText(/insufficient authentication scopes/)).toBeNull();

    // E o Sync continua funcionando (a importação cai no `colorId` legado).
    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(runCalendarImport.mock.calls[0][0].labels).toEqual([]);
  });

  it('as etiquetas do calendário são lidas uma vez e vão para a importação', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    getCalendarLabels.mockResolvedValue([{ id: 'lab-azul', name: 'Cobalto', backgroundColor: '#4A86E8' }]);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    // RegExp (e não string): `toHaveTextContent` compara o conteúdo INTEIRO quando recebe texto.
    await waitFor(() => expect(screen.getByTestId('google-calendar-etiquetas')).toHaveTextContent(/1 custom color/));
    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));

    expect(runCalendarImport.mock.calls[0][0].labels).toEqual([{ id: 'lab-azul', name: 'Cobalto', backgroundColor: '#4A86E8' }]);
  });
});
