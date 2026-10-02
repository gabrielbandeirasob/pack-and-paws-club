/**
 * Conexão do Google Calendar (uma via: app → Google).
 *
 * Escopo de produto: só o MANAGER conecta, e a conta conectada é a do negócio
 * (a do Raphael). O motorista nunca vê essa tela.
 *
 * Fluxo: expo-auth-session (PKCE, sem client secret) → tokens no Keychain → refresh automático.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { CALENDAR_SCOPES, googleIosClientId, googleRedirectScheme } from './config';
import { ehFalhaDeCredencial } from './credentialFailure';
import { clearTokens, isExpired, loadTokens, saveTokens, type StoredTokens } from './tokenStore';

WebBrowser.maybeCompleteAuthSession();

export const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

export type ConnectionStatus = 'not_configured' | 'disconnected' | 'expired' | 'connected';

export type CalendarConnection = {
  status: ConnectionStatus;
  email: string | null;
  connect: () => Promise<'connected' | 'cancelled' | 'error'>;
  disconnect: () => Promise<void>;
  /** Access token válido (renova sozinho quando expira). Lança se não houver conexão. */
  getAccessToken: () => Promise<string>;
  /**
   * Grava no cofre o e-mail da conta conectada (o `id` do calendário `primary`, que é o e-mail) e
   * devolve `true` se mudou. O token OAuth do app não pede escopo de e-mail, então esta é a única
   * forma de a identidade real chegar ao cartão e ao `connected_email` do servidor.
   */
  rememberEmail: (email: string) => Promise<boolean>;
};

export function useCalendarConnection(): CalendarConnection {
  const clientId = useMemo(() => googleIosClientId(), []);
  const redirectUri = useMemo(() => {
    const scheme = googleRedirectScheme();
    if (scheme) return `${scheme}:/oauthredirect`;
    // Sem manifest (ambiente de teste) `makeRedirectUri` LANÇA erro — e isso derrubaria a tela
    // inteira que renderiza o card. Aqui cai no esquema do app em vez de explodir.
    try {
      return AuthSession.makeRedirectUri({ scheme: 'packandpaws', path: 'oauthredirect' });
    } catch {
      return 'packandpaws://oauthredirect';
    }
  }, []);

  const [tokens, setTokens] = useState<StoredTokens | null>(null);
  /**
   * A credencial MORREU (o Google recusou o refresh com `invalid_grant`): o token do cofre é apagado e
   * o estado tem de pedir RECONEXÃO em vez de continuar dizendo "Connected". É diferente de
   * 'disconnected' (nunca conectou) só para o cartão poder rotular o botão de "Reconnect".
   */
  const [expirado, setExpirado] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await loadTokens();
      if (alive) setTokens(stored);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: clientId ?? 'not-configured',
      scopes: CALENDAR_SCOPES,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      // access_type=offline + prompt=consent garante o refresh token (o Google só manda uma vez).
      extraParams: { access_type: 'offline' },
      prompt: AuthSession.Prompt.Consent,
    },
    GOOGLE_DISCOVERY,
  );

  useEffect(() => {
    (async () => {
      if (response?.type !== 'success' || !clientId || !request?.codeVerifier) return;
      try {
        const exchanged = await AuthSession.exchangeCodeAsync(
          {
            clientId,
            code: response.params.code,
            redirectUri,
            extraParams: { code_verifier: request.codeVerifier },
          },
          GOOGLE_DISCOVERY,
        );
        const stored: StoredTokens = {
          accessToken: exchanged.accessToken,
          refreshToken: exchanged.refreshToken ?? null,
          expiresAt: Date.now() + (exchanged.expiresIn ?? 3500) * 1000,
        };
        await saveTokens(stored);
        setTokens(stored);
        setExpirado(false);
      } catch {
        setTokens(null);
      }
    })();
  }, [response, clientId, request?.codeVerifier, redirectUri]);

  const connect = useCallback<CalendarConnection['connect']>(async () => {
    if (!clientId) return 'error';
    const result = await promptAsync();
    if (result?.type === 'success') return 'connected';
    if (result?.type === 'dismiss' || result?.type === 'cancel') return 'cancelled';
    return 'error';
  }, [clientId, promptAsync]);

  const disconnect = useCallback(async () => {
    await clearTokens();
    setTokens(null);
    setExpirado(false);
  }, []);

  const refresh = useCallback(async (current: StoredTokens): Promise<StoredTokens | null> => {
    if (!clientId || !current.refreshToken) return null;
    try {
      const refreshed = await AuthSession.refreshAsync(
        { clientId, refreshToken: current.refreshToken, scopes: CALENDAR_SCOPES },
        GOOGLE_DISCOVERY,
      );
      const next: StoredTokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? current.refreshToken,
        expiresAt: Date.now() + (refreshed.expiresIn ?? 3500) * 1000,
        email: current.email ?? null,
      };
      await saveTokens(next);
      setTokens(next);
      return next;
    } catch (error) {
      /**
       * SEPARAR "a credencial morreu" de "a rede caiu" (auditoria de integrações, 02/10/2026).
       *
       * Antes QUALQUER erro devolvia `null` e o app continuava dizendo "Connected" — o gestor só
       * descobria que tinha de reconectar quando o Sync falhava. Agora:
       *  * `invalid_grant`/401 = a credencial não vale mais: apaga o token e marca `expirado`, para o
       *    cartão oferecer "Reconnect" sem ninguém precisar tocar em Disconnect antes;
       *  * erro de rede = a credencial continua boa: devolve `null` SEM apagar nada e o estado segue
       *    (a próxima tentativa renova de novo).
       */
      if (ehFalhaDeCredencial(error instanceof Error ? error.message : String(error))) {
        await clearTokens();
        setTokens(null);
        setExpirado(true);
      }
      return null;
    }
  }, [clientId]);

  const getAccessToken = useCallback(async () => {
    const current = tokens ?? (await loadTokens());
    if (!current) throw new Error('Google Calendar não está conectado.');
    if (!isExpired(current)) return current.accessToken;
    const renewed = await refresh(current);
    if (!renewed) throw new Error('A conexão com o Google expirou. Conecte novamente.');
    return renewed.accessToken;
  }, [tokens, refresh]);

  /**
   * Guarda o e-mail da conta conectada (o `id` do calendário principal). É o que faz o cartão dizer
   * "Connected as raphael@…" em vez do nome do calendário e o que preenche `connected_email` no
   * servidor (achado da auditoria de integrações, 02/10/2026 — a coluna vivia `null`).
   */
  const rememberEmail = useCallback(async (novo: string): Promise<boolean> => {
    const limpo = (novo ?? '').trim();
    if (!limpo) return false;
    const atual = tokens ?? (await loadTokens());
    if (!atual) return false;
    if (atual.email === limpo) return false;
    const next: StoredTokens = { ...atual, email: limpo };
    await saveTokens(next);
    setTokens(next);
    return true;
  }, [tokens]);

  const status: ConnectionStatus = !clientId
    ? 'not_configured'
    : tokens
      ? 'connected'
      : expirado
        ? 'expired'
        : 'disconnected';

  return { status, email: tokens?.email ?? null, connect, disconnect, getAccessToken, rememberEmail };
}
