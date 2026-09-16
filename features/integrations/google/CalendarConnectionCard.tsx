/**
 * Card do gestor para ligar o Google Calendar (espelhamento de uma via: app → Google).
 *
 * Só o gestor chega a esta aba (a lista de abas por papel está em `app/(tabs)/_layout.tsx`).
 * Quando o build não traz o Client ID do Google, o card EXPLICA a situação em vez de mostrar
 * um botão que não funciona — a credencial entra pelo `app.json` (build/set_google_config.py).
 */
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { colors, radii } from '@/features/theme/tokens';

import type { CalendarFetch } from './calendarApi';
import type { LocalReservation } from './calendarSync';
import { describeSummary, runCalendarSync } from './sync';
import { useCalendarConnection } from './useCalendarConnection';

/**
 * Janela espelhada: de 30 dias atrás a 180 à frente. O recuo evita que o evento desapareça do
 * Google no dia seguinte ao do serviço; o limite à frente impede lista que cresce sem fim
 * (escala recorrente sem data de término é expandida até aqui).
 */
export function janelaDeEspelho(hoje = todayLocalISO()): { timeMin: string; timeMax: string } {
  return { timeMin: `${addDaysISO(hoje, -30)}T00:00:00Z`, timeMax: `${addDaysISO(hoje, 180)}T00:00:00Z` };
}

/** Só o que cai na janela é espelhado (o passado distante e o futuro longe ficam fora). */
export function dentroDaJanela(reservas: LocalReservation[], janela: { timeMin: string; timeMax: string }): LocalReservation[] {
  const inicio = janela.timeMin.slice(0, 10);
  const fim = janela.timeMax.slice(0, 10);
  return reservas.filter((reserva) => (reserva.endDate ?? reserva.startDate) >= inicio && reserva.startDate <= fim);
}

const fetchReal: CalendarFetch = (url, init) => fetch(url, init);

export function CalendarConnectionCard({ reservations }: { reservations: LocalReservation[] }) {
  const { status, email, connect, disconnect, getAccessToken } = useCalendarConnection();
  const [ocupado, setOcupado] = useState<'conectando' | 'sincronizando' | 'desconectando' | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ultimoEnvio, setUltimoEnvio] = useState<string | null>(null);

  const janela = useMemo(() => janelaDeEspelho(), []);
  const paraEspelhar = useMemo(() => dentroDaJanela(reservations, janela), [reservations, janela]);

  const sincronizar = useCallback(async () => {
    setOcupado('sincronizando');
    setErro(null);
    setResumo(null);
    try {
      const accessToken = await getAccessToken();
      const summary = await runCalendarSync({ accessToken, reservations: paraEspelhar, range: janela, doFetch: fetchReal });
      setResumo(describeSummary(summary));
      if (summary.failures.length) setErro(`${summary.failures.length} event(s) could not be sent.`);
      setUltimoEnvio(new Date().toLocaleTimeString());
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error));
    } finally {
      setOcupado(null);
    }
  }, [getAccessToken, janela, paraEspelhar]);

  const conectar = useCallback(async () => {
    setOcupado('conectando');
    setErro(null);
    const resultado = await connect();
    setOcupado(null);
    if (resultado === 'connected') {
      void sincronizar();
    } else if (resultado === 'error') {
      setErro('Could not connect to Google. Try again.');
    }
  }, [connect, sincronizar]);

  const desconectar = useCallback(async () => {
    setOcupado('desconectando');
    await disconnect();
    setOcupado(null);
    setResumo(null);
    setUltimoEnvio(null);
    setErro(null);
  }, [disconnect]);

  if (status === 'not_configured') {
    return (
      <View style={styles.card} testID="google-calendar-card">
        <Text style={styles.title}>Google Calendar</Text>
        <Text style={styles.body} testID="google-calendar-nao-configurado">
          Google Calendar is not enabled in this build yet, so bookings cannot be mirrored here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="google-calendar-card">
      <Text style={styles.title}>Google Calendar</Text>

      {status === 'connected' ? (
        <>
          <Text style={styles.body} testID="google-calendar-status">
            Connected{email ? ` as ${email}` : ''} — bookings are mirrored one way (app → Google).
          </Text>
          <Text style={styles.hint}>
            Mirrors {paraEspelhar.length} booking(s) from the last 30 days to the next 180. Events created by the
            app carry a private key, so your own calendar entries are never touched.
          </Text>

          <View style={styles.row}>
            <Pressable
              accessibilityLabel="Sync now"
              accessibilityRole="button"
              disabled={ocupado !== null}
              onPress={() => void sincronizar()}
              style={[styles.primary, ocupado !== null && styles.disabled]}
              testID="google-calendar-sync"
            >
              {ocupado === 'sincronizando' ? <ActivityIndicator color={colors.cream} /> : <Text style={styles.primaryText}>Sync now</Text>}
            </Pressable>
            <Pressable
              accessibilityLabel="Disconnect Google Calendar"
              accessibilityRole="button"
              disabled={ocupado !== null}
              onPress={() => void desconectar()}
              style={[styles.secondary, ocupado !== null && styles.disabled]}
              testID="google-calendar-disconnect"
            >
              <Text style={styles.secondaryText}>Disconnect</Text>
            </Pressable>
          </View>

          {resumo ? (
            <Text style={styles.result} testID="google-calendar-resumo">
              {resumo}
              {ultimoEnvio ? ` · ${ultimoEnvio}` : ''}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.body} testID="google-calendar-status">
            Connect the business Google account to see every booking in Google Calendar.
          </Text>
          <Pressable
            accessibilityLabel="Connect Google Calendar"
            accessibilityRole="button"
            disabled={ocupado !== null}
            onPress={() => void conectar()}
            style={[styles.primary, ocupado !== null && styles.disabled]}
            testID="google-calendar-connect"
          >
            {ocupado === 'conectando' ? <ActivityIndicator color={colors.cream} /> : <Text style={styles.primaryText}>Connect Google Calendar</Text>}
          </Pressable>
        </>
      )}

      {erro ? (
        <Text style={styles.error} testID="google-calendar-erro">
          {erro}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radii.medium,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
  },
  title: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  body: { color: colors.ink, fontSize: 13, marginTop: 6 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  primary: {
    alignItems: 'center',
    backgroundColor: colors.forest500,
    borderRadius: radii.small,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
  },
  primaryText: { color: colors.cream, fontSize: 14, fontWeight: '600' },
  secondary: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: radii.small,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
  },
  secondaryText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  result: { color: colors.success, fontSize: 12, marginTop: 10 },
  error: { color: colors.urgency, fontSize: 12, marginTop: 10 },
});
