/**
 * Tela do GESTOR: SEDES/VANS da organização (onde a rota começa e termina) — pedidos 1 e 2 da
 * operação do cliente em áudio (25/09/2026):
 *
 *   "a posição de cada driver começar vai ser definida pela administradora";
 *   "ele tem que ser apto a botar (...) onde cada driver vai terminar";
 *   "só quando eu chegar na van que eu sou apto a dar o clock in (...) no raio lá".
 *
 * O que a tela faz: cadastra a sede (nome + endereço ou coordenada + raio de tolerância), escolhe
 * qual é a PADRÃO da organização e permite mais de uma ("futuramente vai ter uma van em cada pedaço
 * da área"). A coordenada sai do mesmo geocoding que o cadastro de cliente usa; se o endereço não
 * for encontrado, o gestor digita latitude/longitude na mão.
 *
 * Nada aqui muda o comportamento de quem não usar: organização SEM sede cadastrada continua com o
 * clock in liberado de qualquer lugar (a trava é opt-in — ver features/organization/locations.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { fetchCoordinates } from '@/features/maps/geocodeService';
import {
  EMPTY_LOCATION_DRAFT,
  VAN_RADIUS_DEFAULT_METERS,
  VAN_RADIUS_MAX_METERS,
  VAN_RADIUS_MIN_METERS,
  draftCoordinates,
  loadOrganizationLocations,
  locationDraftError,
  removeOrganizationLocation,
  saveOrganizationLocation,
  setDefaultOrganizationLocation,
  type LocationDraft,
  type LocationKind,
  type OrganizationLocation,
} from '@/features/organization/locations';
import { colors, radii } from '@/features/theme/tokens';
import { showAlert } from '@/features/ui/alert';
import { supabase } from '@/lib/supabase';

const KIND_LABEL: Record<LocationKind, string> = { van: 'Van', yard: 'Yard', other: 'Other' };

/** Texto do que a sede significa para o motorista (o gestor decide com o que acontece na rua). */
function kindHint(kind: LocationKind): string {
  if (kind === 'yard') return 'Where the pick up run ends.';
  if (kind === 'other') return 'Any other fixed point of the operation.';
  return 'Where the clock in opens and where the run ends.';
}

export default function VanLocationsScreen() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [locais, setLocais] = useState<OrganizationLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocationDraft>(EMPTY_LOCATION_DRAFT);
  /** id em edição (null = cadastro novo) */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sign in again to manage the vans.');
      // Mesma resolução de organização das outras telas do gestor (o vínculo ativo é o que vale).
      const { data: vinculos, error: erroVinculo } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('role', 'manager')
        .limit(1);
      if (erroVinculo) throw new Error(erroVinculo.message);
      const orgId = (vinculos as { organization_id: string }[] | null)?.[0]?.organization_id ?? null;
      setOrganizationId(orgId);
      setLocais(orgId ? await loadOrganizationLocations(supabase, orgId) : []);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'Could not load the vans.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const abrirNovo = () => {
    setEditingId(null);
    setDraft({ ...EMPTY_LOCATION_DRAFT, isDefault: locais.length === 0 });
    setFormAberto(true);
  };

  const abrirEdicao = (local: OrganizationLocation) => {
    setEditingId(local.id);
    setDraft({
      name: local.name,
      kind: local.kind,
      addressLine1: local.addressLine1 ?? '',
      city: local.city ?? '',
      latitude: `${local.latitude}`,
      longitude: `${local.longitude}`,
      radiusMeters: `${local.radiusMeters}`,
      isDefault: local.isDefault,
    });
    setFormAberto(true);
  };

  const salvar = async () => {
    if (!organizationId) {
      showAlert('Could not save', 'No organization found for this account.');
      return;
    }
    const problema = locationDraftError(draft);
    if (problema) {
      showAlert('Could not save', problema);
      return;
    }

    setSaving(true);
    try {
      // Coordenada digitada tem prioridade; sem ela, o endereço vai para o geocoding (o mesmo
      // caminho do cadastro de cliente). Endereço não encontrado não vira pino "chutado".
      let pontos = draftCoordinates(draft);
      if (!pontos) {
        const { points, source } = await fetchCoordinates([
          { id: 'sede', addressLine1: draft.addressLine1.trim(), city: draft.city.trim() || null, country: 'US' },
        ]);
        const achado = source === 'live' ? points[0] : undefined;
        if (!achado) {
          showAlert(
            'Could not find that address',
            'Check the address, or type the latitude and longitude yourself.',
          );
          setSaving(false);
          return;
        }
        pontos = { latitude: achado.latitude, longitude: achado.longitude };
      }

      await saveOrganizationLocation(supabase, {
        organizationId,
        id: editingId,
        name: draft.name,
        kind: draft.kind,
        addressLine1: draft.addressLine1,
        city: draft.city,
        latitude: pontos.latitude,
        longitude: pontos.longitude,
        radiusMeters: Number(draft.radiusMeters.trim() || VAN_RADIUS_DEFAULT_METERS),
        isDefault: draft.isDefault,
      });
      setFormAberto(false);
      setDraft(EMPTY_LOCATION_DRAFT);
      setEditingId(null);
      await load();
    } catch (causa) {
      showAlert('Could not save', causa instanceof Error ? causa.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const tornarPadrao = async (local: OrganizationLocation) => {
    setBusyId(local.id);
    try {
      await setDefaultOrganizationLocation(supabase, local.id);
      await load();
    } catch (causa) {
      showAlert('Could not change the default van', causa instanceof Error ? causa.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  };

  const remover = (local: OrganizationLocation) => {
    showAlert(
      'Remove this van?',
      `${local.name} stops being the clock in point. Routes that pointed here go back to the default van.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyId(local.id);
              try {
                await removeOrganizationLocation(supabase, local.id);
                await load();
              } catch (causa) {
                showAlert('Could not remove', causa instanceof Error ? causa.message : 'Unknown error');
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>Van &amp; yard</Text>
        <Text style={styles.subtitle}>
          Where each driver starts and ends. With a van saved, the clock in only opens near it — leave this empty
          and drivers keep clocking in from anywhere.
        </Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
        ) : (
          <ScrollView contentContainerStyle={styles.lista} showsVerticalScrollIndicator={false}>
            {error ? <Text style={styles.erro}>{error}</Text> : null}

            {locais.length === 0 && !error ? (
              <View style={styles.vazio}>
                <Text style={styles.vazioEmoji}>🚚</Text>
                <Text style={styles.vazioTitulo}>No van saved yet</Text>
                <Text style={styles.vazioTexto}>
                  Nothing changes for the drivers until you save the first van. Add it when the team decides where the
                  day starts.
                </Text>
              </View>
            ) : null}

            {locais.map((local) => (
              <View key={local.id} style={styles.card} testID={`sede-${local.id}`}>
                <View style={styles.cardTopo}>
                  <Text style={styles.nome}>{local.name}</Text>
                  {local.isDefault ? <Text style={styles.seloPadrao}>DEFAULT</Text> : null}
                </View>
                <Text style={styles.tipo}>{KIND_LABEL[local.kind]} · {kindHint(local.kind)}</Text>
                <Text style={styles.endereco}>
                  {[local.addressLine1, local.city].filter((parte) => (parte ?? '').length > 0).join(', ') || 'No address'}
                </Text>
                <Text style={styles.coordenada}>
                  {local.latitude.toFixed(5)}, {local.longitude.toFixed(5)} · radius {local.radiusMeters} m
                </Text>
                <View style={styles.acoes}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${local.name}`}
                    onPress={() => abrirEdicao(local)}
                    style={({ pressed }) => [styles.acao, pressed && styles.pressed]}
                  >
                    <Text style={styles.acaoTexto}>Edit</Text>
                  </Pressable>
                  {!local.isDefault ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Make ${local.name} the default van`}
                      disabled={busyId === local.id}
                      onPress={() => void tornarPadrao(local)}
                      style={({ pressed }) => [styles.acao, pressed && styles.pressed, busyId === local.id && styles.desabilitado]}
                    >
                      <Text style={styles.acaoTexto}>Make default</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${local.name}`}
                    disabled={busyId === local.id}
                    onPress={() => remover(local)}
                    style={({ pressed }) => [styles.acao, styles.acaoPerigo, pressed && styles.pressed]}
                  >
                    <Text style={styles.acaoPerigoTexto}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            {!formAberto ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a van"
                onPress={abrirNovo}
                style={({ pressed }) => [styles.botao, pressed && styles.pressed]}
              >
                <Text style={styles.botaoTexto}>Add a van</Text>
              </Pressable>
            ) : (
              <View style={styles.form} testID="formulario-sede">
                <Text style={styles.formTitulo}>{editingId ? 'Edit van' : 'New van'}</Text>

                <Text style={styles.rotulo}>Name</Text>
                <TextInput
                  accessibilityLabel="Van name"
                  placeholder="Van — Palo Alto"
                  placeholderTextColor={colors.muted}
                  value={draft.name}
                  onChangeText={(name) => setDraft((atual) => ({ ...atual, name }))}
                  style={styles.campo}
                />

                <Text style={styles.rotulo}>What it is</Text>
                <View style={styles.tipos}>
                  {(['van', 'yard', 'other'] as LocationKind[]).map((kind) => (
                    <Pressable
                      key={kind}
                      accessibilityRole="button"
                      accessibilityLabel={`Type ${kind}`}
                      onPress={() => setDraft((atual) => ({ ...atual, kind }))}
                      style={[styles.tipoOpcao, draft.kind === kind && styles.tipoAtivo]}
                    >
                      <Text style={[styles.tipoTexto, draft.kind === kind && styles.tipoTextoAtivo]}>
                        {KIND_LABEL[kind]}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.rotulo}>Address</Text>
                <TextInput
                  accessibilityLabel="Van address"
                  placeholder="2523 Holland St"
                  placeholderTextColor={colors.muted}
                  value={draft.addressLine1}
                  onChangeText={(addressLine1) => setDraft((atual) => ({ ...atual, addressLine1 }))}
                  style={styles.campo}
                />
                <TextInput
                  accessibilityLabel="Van city"
                  placeholder="City"
                  placeholderTextColor={colors.muted}
                  value={draft.city}
                  onChangeText={(city) => setDraft((atual) => ({ ...atual, city }))}
                  style={styles.campo}
                />

                <Text style={styles.rotulo}>Coordinates (optional — filled in from the address)</Text>
                <View style={styles.linha}>
                  <TextInput
                    accessibilityLabel="Van latitude"
                    placeholder="Latitude"
                    placeholderTextColor={colors.muted}
                    value={draft.latitude}
                    onChangeText={(latitude) => setDraft((atual) => ({ ...atual, latitude }))}
                    keyboardType="numbers-and-punctuation"
                    style={[styles.campo, styles.meia]}
                  />
                  <TextInput
                    accessibilityLabel="Van longitude"
                    placeholder="Longitude"
                    placeholderTextColor={colors.muted}
                    value={draft.longitude}
                    onChangeText={(longitude) => setDraft((atual) => ({ ...atual, longitude }))}
                    keyboardType="numbers-and-punctuation"
                    style={[styles.campo, styles.meia]}
                  />
                </View>

                <Text style={styles.rotulo}>Clock in radius (meters)</Text>
                <TextInput
                  accessibilityLabel="Clock in radius in meters"
                  placeholder={`${VAN_RADIUS_DEFAULT_METERS}`}
                  placeholderTextColor={colors.muted}
                  value={draft.radiusMeters}
                  onChangeText={(radiusMeters) => setDraft((atual) => ({ ...atual, radiusMeters }))}
                  keyboardType="number-pad"
                  style={styles.campo}
                />
                <Text style={styles.dica}>
                  Between {VAN_RADIUS_MIN_METERS} and {VAN_RADIUS_MAX_METERS} m. {VAN_RADIUS_DEFAULT_METERS} m is what the
                  operation asked for.
                </Text>

                <View style={styles.linhaPadrao}>
                  <Text style={styles.rotulo}>Use as the default van</Text>
                  <Switch
                    accessibilityLabel="Use as the default van"
                    value={draft.isDefault}
                    onValueChange={(isDefault) => setDraft((atual) => ({ ...atual, isDefault }))}
                    trackColor={{ true: colors.forest700, false: colors.line }}
                  />
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save van"
                  disabled={saving}
                  onPress={() => void salvar()}
                  style={({ pressed }) => [styles.botao, saving && styles.desabilitado, pressed && styles.pressed]}
                >
                  {saving ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.botaoTexto}>Save van</Text>}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel van"
                  onPress={() => {
                    setFormAberto(false);
                    setEditingId(null);
                  }}
                  style={styles.voltar}
                >
                  <Text style={styles.voltarTexto}>Cancel</Text>
                </Pressable>
              </View>
            )}

            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.voltar}>
              <Text style={styles.voltarTexto}>Back</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 26, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
  subtitle: { color: '#D7E1D4', fontSize: 12, marginTop: 6, lineHeight: 17 },
  body: { flex: 1, backgroundColor: colors.cream },
  center: { marginTop: 60 },
  lista: { padding: 16, paddingBottom: 40 },
  erro: { color: colors.urgency, fontWeight: '700', marginBottom: 12 },
  card: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 14, marginBottom: 10 },
  cardTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nome: { fontFamily: 'serif', fontSize: 17, fontWeight: '800', color: colors.forest900, flexShrink: 1 },
  seloPadrao: { color: '#7A5B12', backgroundColor: '#F3D9A4', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '900', overflow: 'hidden' },
  tipo: { color: colors.muted, fontSize: 12, marginTop: 3 },
  endereco: { color: colors.ink, fontSize: 13, marginTop: 7 },
  coordenada: { color: colors.muted, fontSize: 12, marginTop: 3 },
  acoes: { flexDirection: 'row', gap: 8, marginTop: 11, flexWrap: 'wrap' },
  acao: { borderWidth: 1.5, borderColor: colors.forest700, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  acaoTexto: { color: colors.forest700, fontWeight: '900', fontSize: 12 },
  acaoPerigo: { borderColor: colors.urgency },
  acaoPerigoTexto: { color: colors.urgency, fontWeight: '900', fontSize: 12 },
  vazio: { alignItems: 'center', marginTop: 40, paddingHorizontal: 26 },
  vazioEmoji: { fontSize: 40 },
  vazioTitulo: { fontFamily: 'serif', fontSize: 18, fontWeight: '800', color: colors.forest900, marginTop: 10 },
  vazioTexto: { color: colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 19, marginTop: 6 },
  form: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 14, marginBottom: 10 },
  formTitulo: { fontFamily: 'serif', fontSize: 17, fontWeight: '800', color: colors.forest900, marginBottom: 8 },
  rotulo: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.6, marginTop: 10, textTransform: 'uppercase' },
  campo: { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, marginTop: 6 },
  linha: { flexDirection: 'row', gap: 8 },
  /*
   * Meia largura na linha dos dois campos (latitude/longitude).
   *
   * DEFEITO do build 69 (achado na verificação de 26/09/2026, medindo a tela no navegador com a
   * largura do iPhone): `flex: 1` sozinho NÃO encolhe um <input> do react-native-web abaixo do
   * tamanho intrínseco dele (~227 px, os 20 caracteres padrão do input) — o `min-width` do item
   * flex é `auto`. Resultado: o campo de longitude começava em 266 px e terminava em 493 px numa
   * tela de 393 px, ou seja, FORA da tela (o gestor não via o campo). `minWidth: 0` devolve o
   * encolhimento e cada campo fica com metade da linha.
   */
  meia: { flex: 1, minWidth: 0 },
  tipos: { flexDirection: 'row', gap: 8, marginTop: 6 },
  tipoOpcao: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingVertical: 9, alignItems: 'center', backgroundColor: colors.cream },
  tipoAtivo: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  tipoTexto: { color: colors.forest700, fontWeight: '800', fontSize: 13 },
  tipoTextoAtivo: { color: 'white' },
  dica: { color: colors.muted, fontSize: 11, marginTop: 6, lineHeight: 16 },
  linhaPadrao: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  botao: { backgroundColor: colors.gold, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 8 },
  botaoTexto: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
  voltar: { alignItems: 'center', padding: 14, marginTop: 4 },
  voltarTexto: { color: colors.muted, fontWeight: '800' },
  pressed: { opacity: 0.85 },
  desabilitado: { opacity: 0.5 },
});
