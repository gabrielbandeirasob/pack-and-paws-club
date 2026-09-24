import { useCallback, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModalScreen } from '@/features/ui/ModalScreen';
import { router, useFocusEffect } from 'expo-router';

import { DriverInviteForm } from '@/features/drivers/DriverInviteForm';
import { driverRemovalPlan, fullNameOrFallback, isActiveStatus, memberRoleLabel, memberStatusFromActive, memberStatusLabel, type MemberRole } from '@/features/drivers/driversService';
import { normalizeForSearch } from '@/features/clients/clientsService';
import { showAlert } from '@/features/ui/alert';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type DriverRow = { user_id: string; status: string; role?: string | null; profiles: { full_name: string | null } | null };

/** Rotas atribuidas a este motorista: o que o aviso de remocao precisa dizer. */
type DriverImpact = { futureRoutes: number; pastRoutes: number };

/** Data de hoje no fuso do aparelho (route_date e date puro). */
function hojeLocal(): string {
  const agora = new Date();
  const mes = `${agora.getMonth() + 1}`.padStart(2, '0');
  const dia = `${agora.getDate()}`.padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

export default function DriversScreen() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async (opcoes?: { silent?: boolean }) => {
    if (!opcoes?.silent) setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserId(user.id);
    const { data: memberships } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).eq('role', 'manager').limit(1);
    const orgId = (memberships as { organization_id: string }[] | null)?.[0]?.organization_id ?? null;
    setOrganizationId(orgId);
    if (!orgId) { setDrivers([]); setLoading(false); return; }
    // A lista traz a EQUIPE (motoristas e gestores): o convite cria os dois papeis, e um
    // gestor novo precisa aparecer em algum lugar para poder ser editado ou removido.
    const { data } = await supabase.from('organization_members').select('user_id, status, role, profiles(full_name)').eq('organization_id', orgId).order('role');
    setDrivers((data as unknown as DriverRow[]) ?? []);
    setLoading(false);
  }, []);

  // Recarrega ao voltar para a tela: a aba fica montada, entao um motorista convidado/editado
  // em outro lugar nao apareceria (mesmo bug que a lista de clientes tinha).
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const puxarParaAtualizar = async () => {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  };

  const [editing, setEditing] = useState<DriverRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [impact, setImpact] = useState<DriverImpact>({ futureRoutes: 0, pastRoutes: 0 });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const openDriver = (driver: DriverRow) => {
    setEditing(driver);
    setEditName(driver.profiles?.full_name ?? '');
    setEditActive(isActiveStatus(driver.status));
    setImpact({ futureRoutes: 0, pastRoutes: 0 });
    void carregarImpacto(driver.user_id);
  };

  const carregarImpacto = async (driverUserId: string) => {
    const hoje = hojeLocal();
    const [futuras, passadas] = await Promise.all([
      supabase.from('routes').select('id', { count: 'exact', head: true }).eq('driver_id', driverUserId).gte('route_date', hoje),
      supabase.from('routes').select('id', { count: 'exact', head: true }).eq('driver_id', driverUserId).lt('route_date', hoje),
    ]);
    setImpact({ futureRoutes: futuras.count ?? 0, pastRoutes: passadas.count ?? 0 });
  };

  const saveDriver = async () => {
    if (!editing || !organizationId) return;
    const name = editName.trim();
    if (name.length === 0) { showAlert('Name required', 'Give the driver a name.'); return; }
    setSaving(true);
    const { error: profileError } = await supabase.from('profiles').update({ full_name: name }).eq('id', editing.user_id);
    const { error: memberError } = await supabase
      .from('organization_members')
      .update({ status: memberStatusFromActive(editActive) })
      .eq('organization_id', organizationId)
      .eq('user_id', editing.user_id);
    setSaving(false);
    if (profileError || memberError) { showAlert('Could not save', (profileError ?? memberError)?.message ?? 'Unknown error'); return; }
    setEditing(null);
    await load({ silent: true });
  };

  /**
   * Remover da equipe: apaga o VINCULO (organization_members) — o motorista perde acesso
   * e nao recebe mais rota. Nao apaga a conta do usuario (isso exige a chave de
   * administrador do Supabase) nem as rotas ja feitas: o historico fica.
   * Os tokens de push dele sao apagados em seguida para o aviso parar na hora.
   */
  const removerMotorista = async () => {
    if (!editing || !organizationId) return;
    const nome = fullNameOrFallback(editing.profiles?.full_name);
    const plan = driverRemovalPlan(nome, {
      futureRoutes: impact.futureRoutes,
      pastRoutes: impact.pastRoutes,
      isSelf: editing.user_id === userId,
    });
    if (!plan.allowed) { showAlert(plan.title, plan.message); return; }

    const desativar = async () => {
      setRemoving(true);
      const { error } = await supabase
        .from('organization_members')
        .update({ status: 'disabled' })
        .eq('organization_id', organizationId)
        .eq('user_id', editing.user_id);
      setRemoving(false);
      if (error) { showAlert('Could not disable', error.message); return; }
      setEditing(null);
      await load({ silent: true });
    };

    const apagarVinculo = async () => {
      setRemoving(true);
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('organization_id', organizationId)
        .eq('user_id', editing.user_id);
      if (error) { setRemoving(false); showAlert('Could not remove', error.message); return; }
      // Push para na hora (politica device_tokens_manager_delete, migration 022).
      // Se falhar, a remocao vale igual: sem vinculo ele nao recebe mais rota atribuida.
      await supabase.from('device_tokens').delete().eq('user_id', editing.user_id);
      setRemoving(false);
      setEditing(null);
      await load({ silent: true });
    };

    const botoes: Parameters<typeof showAlert>[2] = [{ text: 'Cancel', style: 'cancel' }];
    if (plan.offerDisable) botoes.push({ text: 'Disable instead', onPress: () => void desativar() });
    botoes.push({ text: plan.confirmLabel, style: 'destructive', onPress: () => void apagarVinculo() });

    showAlert(plan.title, plan.message, botoes);
  };

  const invite = async (name: string, email: string, role: MemberRole) => {
    const { data, error } = await supabase.functions.invoke('add-driver', { body: { name, email, role } });
    if (error) throw new Error(error.message);
    return { temporaryPassword: (data as { temporary_password: string }).temporary_password };
  };

  const finishInvite = async () => {
    setInviting(false);
    await load({ silent: true });
  };

  /**
   * Fechar de verdade, mesmo com o teclado aberto.
   * No iPhone, com um campo focado, o primeiro toque em um botao pode ser consumido para
   * dispensar o teclado — o usuario toca no ✕ e "nada acontece". Dispensando o teclado aqui,
   * a acao sempre executa.
   */
  const fecharEdicao = () => {
    Keyboard.dismiss();
    setEditing(null);
  };
  const fecharConvite = () => {
    Keyboard.dismiss();
    setInviting(false);
  };

  const termo = normalizeForSearch(query);
  const visiveis = termo.length > 0
    ? drivers.filter((driver) => normalizeForSearch(driver.profiles?.full_name ?? '').includes(termo))
    : drivers;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Team</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Invite driver" onPress={() => setInviting(true)} style={styles.plusButton}>
          <Text style={styles.plusText}>＋</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : (
        <ScrollView
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void puxarParaAtualizar()} tintColor={colors.gold} />}
        >
          {drivers.length > 1 ? (
            <TextInput
              accessibilityLabel="Search drivers"
              placeholder="Search team…"
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.search}
            />
          ) : null}
          {drivers.length === 0 ? <Text style={styles.empty}>No team members yet. Invite your first driver.</Text> : null}
          {visiveis.length === 0 && drivers.length > 0 ? <Text style={styles.empty}>No one matches “{query}”.</Text> : null}
          {visiveis.map((driver) => (
            <Pressable key={driver.user_id} accessibilityRole="button" accessibilityLabel={`Edit ${fullNameOrFallback(driver.profiles?.full_name)}`} onPress={() => openDriver(driver)} style={({ pressed }) => [styles.card, pressed && styles.pressedCard]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(driver.profiles?.full_name ?? 'D')[0]}</Text></View>
              <View style={styles.info}>
                <Text style={styles.name}>{fullNameOrFallback(driver.profiles?.full_name)}</Text>
                <Text style={[styles.role, driver.status !== 'active' && styles.roleOff]}>
                  {memberRoleLabel(driver.role)} · {memberStatusLabel(driver.status)}
                </Text>
              </View>
              <Text style={styles.chev}>Edit ›</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Modal visible={editing !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setEditing(null)}>
        <ModalScreen>
          <View style={styles.modalTop}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={fecharEdicao} hitSlop={12} style={styles.backButton}>
              <Text style={styles.closeText}>✕ Close</Text>
            </Pressable>
          </View>
          {/* O ✕ fica FORA do KeyboardAvoidingView: fica sempre alcançavel, mesmo com o teclado aberto */}
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled" automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never">
          <Text style={styles.modalTitle}>Edit team member</Text>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput accessibilityLabel="Driver name" value={editName} onChangeText={setEditName} autoCapitalize="words" placeholderTextColor={colors.muted} style={styles.input} />
          <View style={styles.switchRow}>
            <View style={styles.switchTextBlock}>
              <Text style={styles.switchLabel}>Active</Text>
              <Text style={styles.switchHint}>A disabled driver keeps the history but can no longer be assigned to routes.</Text>
            </View>
            <Switch value={editActive} onValueChange={setEditActive} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Save driver" disabled={saving || removing} onPress={() => void saveDriver()} style={({ pressed }) => [styles.saveButton, pressed && styles.pressedCard, (saving || removing) && styles.disabled]}>
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save driver'}</Text>
          </Pressable>

          <View style={styles.dangerZone}>
            <Text style={styles.dangerTitle}>Remove from team</Text>
            <Text style={styles.dangerHint}>
              {editing?.user_id === userId
                ? 'This is the account you are signed in with — another manager has to remove it.'
                : `Removes access and push notifications. Past routes stay in the history${impact.futureRoutes > 0 ? `. ${impact.futureRoutes} upcoming route(s) would be left without a driver.` : '.'}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove driver"
              disabled={removing || saving}
              onPress={() => void removerMotorista()}
              style={({ pressed }) => [styles.removeButton, pressed && styles.pressedCard, (removing || saving) && styles.disabled]}
            >
              <Text style={styles.removeText}>{removing ? 'Removing…' : 'Remove driver'}</Text>
            </Pressable>
          </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </ModalScreen>
      </Modal>

      <Modal visible={inviting} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setInviting(false)}>
        <ModalScreen>
          <View style={styles.modalTop}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={fecharConvite} hitSlop={12} style={styles.backButton}>
              <Text style={styles.closeText}>✕ Close</Text>
            </Pressable>
          </View>
          <DriverInviteForm onInvite={invite} onDone={finishInvite} />
        </ModalScreen>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  flex: { flex: 1 },
  modalBody: { paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.forest700, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 8 },
  backButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingVertical: 4, paddingRight: 6 },
  backText: { color: colors.gold, fontSize: 32, fontWeight: '700', lineHeight: 34 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 24, fontWeight: '800', flex: 1 },
  plusButton: { backgroundColor: colors.gold, width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: colors.forest900, fontSize: 20, fontWeight: '900', lineHeight: 22 },
  center: { marginTop: 70 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 40, paddingHorizontal: 30 },
  search: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, color: colors.ink, fontSize: 14, marginBottom: 10 },
  list: { padding: 16, paddingBottom: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 13, marginBottom: 9 },
  avatar: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.forest700, fontWeight: '900', fontSize: 18 },
  info: { flex: 1 },
  name: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  role: { color: colors.muted, fontSize: 12, marginTop: 2 },
  modalTop: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 6 },
  closeText: { color: colors.forest700, fontWeight: '800' },
  pressedCard: { opacity: 0.7 },
  roleOff: { color: colors.urgency, fontWeight: '700' },
  chev: { color: colors.gold, fontWeight: '800', fontSize: 12 },
  modalTitle: { fontFamily: 'serif', fontSize: 24, fontWeight: '800', color: colors.forest900, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, marginHorizontal: 20, marginBottom: 5 },
  input: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, marginHorizontal: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginHorizontal: 20, gap: 14 },
  switchTextBlock: { flex: 1 },
  switchLabel: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  switchHint: { color: colors.muted, fontSize: 12, marginTop: 3, lineHeight: 17 },
  saveButton: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 22, marginHorizontal: 20 },
  saveText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  disabled: { opacity: 0.6 },
  dangerZone: { marginTop: 26, marginHorizontal: 20, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 },
  dangerTitle: { color: colors.urgency, fontWeight: '900', fontSize: 14 },
  dangerHint: { color: colors.muted, fontSize: 12, marginTop: 5, lineHeight: 17 },
  removeButton: { borderWidth: 1.5, borderColor: colors.urgency, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 12 },
  removeText: { color: colors.urgency, fontWeight: '900', fontSize: 14 },
});
