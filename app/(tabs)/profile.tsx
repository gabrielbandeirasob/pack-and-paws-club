import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { useOrganizationRole } from '@/features/auth/useOrganizationRole';
import { DriveSwitchRow } from '@/features/auth/DriveSwitchRow';

export default function AccountProfileScreen() {
  const { session } = useAuth();
  const { role, view } = useOrganizationRole();
  const [fullName, setFullName] = useState<string | null>(null);
  /**
   * 🪤 ACHADO DA VISTORIA (02/10/2026): a tela usava `fullName === null` para dizer "carregando".
   * Só que `full_name` NULO no banco (conta recém-criada, perfil sem nome) também devolvia null — e
   * aí a rodinha girava PARA SEMPRE, sem o cartão, sem o campo de nome e sem o Sign out. Agora o
   * carregando é um estado próprio: `null` no nome é dado, não é espera.
   */
  const [loading, setLoading] = useState(true);
  /** Cópia editável do nome: o motorista corrige o nome que sai na mensagem ao cliente. */
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  /**
   * O papel é o do VÍNCULO ativo (`organization_members.role`), não um rótulo fixo: até 25/09/2026 a tela
   * escrevia "DRIVER" na mão e o GESTOR via "PACK & PAWS CLUB · DRIVER" no próprio perfil (achado da
   * revisão das contas). Enquanto o papel não chega, o cabeçalho não afirma nada.
   */
  const papel = role === 'manager' ? 'Manager' : role === 'driver' ? 'Driver' : 'Account';
  const [membroDesde, setMembroDesde] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) { setLoading(false); return; }
    try {
      const { data } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle();
      const nome = (data as { full_name: string | null } | null)?.full_name ?? null;
      setFullName(nome);
      setNameDraft(nome ?? '');

      // Desde quando a conta existe na organização (o vínculo, não o login): melhoria 4 da revisão das
      // contas — o perfil vira a "carteira de trabalho" da pessoa, não só nome e e-mail.
      const { data: vinculo } = await supabase
        .from('organization_members')
        .select('created_at')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      const desde = (vinculo as { created_at: string | null } | null)?.created_at ?? null;
      setMembroDesde(desde
        ? new Date(desde).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : null);
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Salvar o próprio nome. A policy de self-update permite; ainda assim conferimos as LINHAS
   * (`.select('id')`) porque o PostgREST devolve sucesso com 0 linhas quando a policy bloqueia — sem
   * isso o app diria "Name saved." com o nome de volta na recarga.
   */
  const saveName = async () => {
    if (!session?.user) return;
    const nome = nameDraft.trim();
    if (nome.length === 0) { setNameMessage('Enter your name.'); return; }
    setSavingName(true);
    setNameMessage(null);
    const { data, error } = await supabase
      .from('profiles')
      .update({ full_name: nome })
      .eq('id', session.user.id)
      .select('id');
    setSavingName(false);
    if (error) { setNameMessage(`Could not save — ${error.message}`); return; }
    if (!Array.isArray(data) || data.length === 0) {
      setNameMessage('Could not save — your account may not have permission to change this profile.');
      return;
    }
    await load();
    setNameMessage('Name saved.');
  };

  const signOut = async () => { await supabase.auth.signOut(); };

 return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · {(view ?? 'Account').toUpperCase()}</Text>
        <Text style={styles.title}>Profile</Text>
      </View>
      <View style={styles.body}>
        {loading ? <ActivityIndicator testID="profile-loading" style={styles.center} color={colors.gold} size="large" /> : (
          <View style={styles.list}>
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{(fullName ?? 'D')[0]}</Text></View>
                <View style={styles.info}><Text style={styles.name}>{fullName ?? 'Add your name'}</Text><Text style={styles.email}>{session?.user.email}</Text><Text style={styles.role}>{papel}</Text>{membroDesde ? <Text style={styles.desde}>Member since {membroDesde}</Text> : null}</View>
              </View>
              {/* Nome editável (dono, 01/10/2026): o motorista precisa corrigir o nome que sai na
                  mensagem ao cliente. Uma linha só, discreta — mesma linha do cartão do perfil. */}
              <View style={styles.nameRow}>
                <TextInput
                  accessibilityLabel="Your name"
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  autoCapitalize="words"
                  autoCorrect={false}
                  placeholder="Your name"
                  placeholderTextColor={colors.muted}
                  style={styles.nameInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save name"
                  disabled={savingName}
                  onPress={() => void saveName()}
                  style={({ pressed }) => [styles.saveName, pressed && styles.pressed, savingName && styles.disabled]}
                >
                  <Text style={styles.saveNameText}>{savingName ? 'Saving…' : 'Save name'}</Text>
                </Pressable>
              </View>
              {nameMessage ? <Text style={styles.nameMessage}>{nameMessage}</Text> : null}
            </View>
            {/* Interruptor gestor ↔ motorista (áudio do dono, 27/09/2026) — o mesmo componente usado no
                "More" do gestor, para não existirem duas versões do mesmo interruptor. */}
            <DriveSwitchRow />
            <Pressable accessibilityRole="button" accessibilityLabel="Change password" onPress={() => router.push('/password')} style={styles.changePassword}>
              <Text style={styles.changePasswordText}>Change password</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={signOut} style={styles.signOut}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
  body: { flex: 1, backgroundColor: colors.cream },
  center: { marginTop: 80 },
  list: { padding: 16 },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 54, height: 54, borderRadius: 16, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.forest700, fontWeight: '900', fontSize: 24 },
  info: { flex: 1 },
  name: { color: colors.ink, fontWeight: '900', fontSize: 17 },
  email: { color: colors.muted, fontSize: 13, marginTop: 3 },
  role: { color: colors.forest700, fontSize: 12, fontWeight: '800', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  desde: { color: colors.muted, fontSize: 12, marginTop: 4 },

  /** Campo de nome: compacto, uma linha (input + botão), dentro do próprio cartão do perfil. */
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  nameInput: { flex: 1, minHeight: 44, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: radii.small, paddingHorizontal: 12, paddingVertical: 9, color: colors.ink, fontSize: 14 },
  saveName: { minHeight: 44, justifyContent: 'center', backgroundColor: colors.gold, borderRadius: radii.small, paddingHorizontal: 14, paddingVertical: 10 },
  saveNameText: { color: colors.forest900, fontWeight: '900', fontSize: 13 },
  nameMessage: { color: colors.muted, fontSize: 12, marginTop: 8, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.6 },

  signOut: { backgroundColor: '#FBEAE6', borderRadius: radii.medium, padding: 15, alignItems: 'center', marginTop: 18 },
  changePassword: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 15, alignItems: 'center', marginTop: 18 },
  changePasswordText: { color: colors.forest700, fontWeight: '900', fontSize: 14 },
  signOutText: { color: colors.urgency, fontWeight: '900', fontSize: 14 },
});
