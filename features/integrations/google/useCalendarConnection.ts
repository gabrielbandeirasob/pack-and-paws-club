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
import { clearTokens, isExpired, loadTokens, saveTokens, type StoredTokens } from './tokenStore';

WebBrowser.maybeCompleteAuthSession();

export const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

export type ConnectionStatus = 'not_configured' | 'disconnected' | 'connected';

export type CalendarConnection = {
  status: ConnectionStatus;
  email: string | null;
  connect: () => Promise<'connected' | 'cancelled' | 'error'>;
  disconnect: () => Promise<void>;
  /** Access token válido (renova sozinho quando expira). Lança se não houver conexão. */
  getAccessToken: () => Promise<string>;
};

export function useCalendarConnection(): CalendarConnection {
  const clientId = useMemo(() => googleIosClientId(), []);
  const redirectUri = useMemo(() => {
    const scheme = googleRedirectScheme();
    return scheme ? `${scheme}:/oauthredirect` : AuthSession.makeRedirectUri({ scheme: 'packandpaws', path: 'oauthredirect' });
  }, []);

  const [tokens, setTokens] = useState<StoredTokens | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await loadTokens();
      if (alive) {
        setTokens(stored);
        setLoaded(true);
      }
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
    } catch {
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

  const status: ConnectionStatus = !clientId ? 'not_configured' : tokens ? 'connected' : loaded ? 'disconnected' : 'disconnected';

  return { status, email: tokens?.email ?? null, connect, disconnect, getAccessToken };
}
