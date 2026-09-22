import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { colors } from '@/features/theme/tokens';

type Props = { email?: string | null; onRetry?: () => void };

/**
 * Tela para quem entrou mas ainda não tem vínculo ativo com a equipe.
 * Antes disso o app mostrava o indicador de carregamento para sempre — do lado do motorista
 * isso era "não consegui entrar na conta". Agora o motivo aparece e há saída.
 */
export function NoAccess({ email, onRetry }: Props) {
  const [saindo, setSaindo] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const sair = async () => {
    setSaindo(true);
    try {
      await supabase.auth.signOut();
    } finally {
      setSaindo(false);
    }
  };

  const tentarDeNovo = async () => {
    setConferindo(true);
    onRetry?.();
    timer.current = setTimeout(() => setConferindo(false), 1500);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>PACK &amp; PAWS CLUB</Text>
        <Text style={styles.title}>Your account isn&apos;t linked yet</Text>
        <Text style={styles.body}>
          The sign-in worked, but this account is not linked to a Pack &amp; Paws team. Ask your administrator to
          add you to the team, then try again.
        </Text>
        {email ? <Text style={styles.email}>{email}</Text> : null}

        <Pressable accessibilityRole="button" onPress={tentarDeNovo} style={styles.primary}>
          {conferindo ? (
            <ActivityIndicator color={colors.forest900} />
          ) : (
            <Text style={styles.primaryText}>Try again</Text>
          )}
        </Pressable>

        <Pressable accessibilityRole="button" onPress={sair} style={styles.ghost}>
          {saindo ? <ActivityIndicator color={colors.forest700} /> : <Text style={styles.ghostText}>Sign out</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.forest700,
    padding: 22,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.paper,
    borderRadius: 18,
    padding: 22,
  },
  eyebrow: { color: colors.forest700, fontWeight: '800', fontSize: 11, letterSpacing: 1.2 },
  title: { color: colors.ink, fontFamily: 'serif', fontWeight: '800', fontSize: 22, marginTop: 8 },
  body: { color: colors.muted, fontSize: 14, marginTop: 10, lineHeight: 20 },
  email: { color: colors.ink, fontWeight: '700', fontSize: 13, marginTop: 12 },
  primary: {
    marginTop: 18,
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  ghost: { marginTop: 10, paddingVertical: 12, alignItems: 'center' },
  ghostText: { color: colors.forest700, fontWeight: '800', fontSize: 14 },
});
