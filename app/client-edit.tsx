/**
 * Tela de edicao do cliente (aberta ao tocar no card da lista).
 * Salva: dados do cliente, endereco, notas, instrucoes de acesso e cachorros.
 * Exclui: cachorro individual (nesta edicao) e o cliente inteiro (com aviso do
 * que vai junto — reservas e passagem pelas rotas somem em cascata no banco).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { EditClientForm, type ClientSavePayload, type EditableDog } from '@/features/clients/EditClientForm';
import {
  canUndoClientDelete,
  clientDeletePlan,
  clientRestoreRows,
  clientUpdatePayload,
  dogSavePlan,
  firstInstruction,
  instructionWritePlan,
  normalizeText,
  type ClientHistoryCounts,
  type ClientSnapshot,
  type EditableClient,
} from '@/features/clients/clientsService';
import {
  deleteDogPhoto,
  storeDogPhoto,
} from '@/features/dogs/dogPhoto';
import { showAlert } from '@/features/ui/alert';
import { colors } from '@/features/theme/tokens';
import { fillClientCoordinates } from '@/features/maps/geocodeService';
import { supabase } from '@/lib/supabase';

type Loaded = {
  current: EditableClient;
  dogs: EditableDog[];
  instructions: string | null;
  instructionId: string | null;
  active: boolean;
  impact: ClientHistoryCounts;
  /** guardado para o desfazer: reinserir precisa da organizacao e dos ids originais */
  snapshot: ClientSnapshot;
};

/** Data de hoje no fuso do aparelho (o servidor compara com start_date, que e date puro). */
function hojeLocal(): string {
  const agora = new Date();
  const mes = `${agora.getMonth() + 1}`.padStart(2, '0');
  const dia = `${agora.getDate()}`.padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

export default function ClientEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { setError('Client not found.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('clients')
      .select('id, organization_id, source_contact_identifier, name, phone, address_line_1, address_line_2, city, state, postal_code, notes, special_scheduling_instructions, latitude, longitude, active, dogs(id, name, breed, behavior_notes, medical_notes, photo_url), client_instructions(id, pickup_access_instructions)')
      .eq('id', id)
      .single();
    if (loadError || !data) {
      setError(loadError?.message ?? 'Client not found.');
      setLoading(false);
      return;
    }
    const row = data as unknown as EditableClient & {
      id: string;
      organization_id: string;
      source_contact_identifier: string | null;
      active: boolean;
      dogs: { id: string; name: string; breed: string | null; behavior_notes: string | null; medical_notes: string | null; photo_url: string | null }[] | null;
      // a API devolve OBJETO (UNIQUE em client_id), nao lista
      client_instructions:
        | { id: string; pickup_access_instructions: string | null }
        | { id: string; pickup_access_instructions: string | null }[]
        | null;
    };
    const instruction = firstInstruction(row.client_instructions);
    const dogs = (row.dogs ?? []).map((dog) => ({ id: dog.id, name: dog.name, breed: dog.breed, behavior_notes: dog.behavior_notes, medical_notes: dog.medical_notes, photo_url: dog.photo_url ?? null }));

    // Quanto existe ligado a este cliente: e o que o aviso de exclusao mostra.
    // Reservas e paradas de rota sao contadas pelo vinculo do cao (dogs!inner) — filtrar
    // por cliente dentro do embed e o que garante que so conta o que e dele.
    const [reservas, proximas, paradas] = await Promise.all([
      supabase.from('reservations').select('id, dogs!inner(client_id)', { count: 'exact', head: true }).eq('dogs.client_id', id),
      supabase.from('reservations').select('id, dogs!inner(client_id)', { count: 'exact', head: true }).eq('dogs.client_id', id).gte('start_date', hojeLocal()),
      supabase.from('route_stops').select('id, dogs!inner(client_id)', { count: 'exact', head: true }).eq('dogs.client_id', id),
    ]);

    setLoaded({
      current: row,
      dogs,
      instructions: instruction?.pickup_access_instructions ?? null,
      instructionId: instruction?.id ?? null,
      active: row.active,
      impact: {
        dogs: dogs.length,
        reservations: reservas.count ?? 0,
        upcomingReservations: proximas.count ?? 0,
        routeStops: paradas.count ?? 0,
      },
      // Snapshot tirado ANTES de qualquer exclusao: e o que permite desfazer (com os
      // mesmos ids) quando o cliente nao tinha reserva nem historico de rota.
      snapshot: {
        organizationId: row.organization_id,
        client: row,
        dogs,
        instructions: instruction ? { id: instruction.id, text: instruction.pickup_access_instructions } : null,
      },
    });
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const save = async (payload: ClientSavePayload) => {
    if (!loaded) return;
    setSaving(true);
    setError(null);
    try {
      const { address_changed: enderecoMudou, ...clientColumns } = clientUpdatePayload(loaded.current, payload.client);
      const { error: clientError } = await supabase.from('clients').update({ ...clientColumns, active: payload.active }).eq('id', id);
      if (clientError) throw new Error(clientError.message);

      // Endereco mudou => as coordenadas antigas foram DESCARTADAS (regra do clientUpdatePayload).
      // Aqui o pino e refeito pelo servidor (Google Geocoding), em segundo plano: nao segura a
      // tela, e se nao houver chave/servidor/internet o cliente salva igual — so fica sem pino.
      if (enderecoMudou && id) {
        void fillClientCoordinates(id, { ...payload.client, latitude: null, longitude: null });
      }

      // Foto do cão: o caminho do arquivo carrega o id da ORGANIZAÇÃO (é o que a política do
      // storage lê) — a organização vem do snapshot, sem consulta extra ao banco.
      const organizationId = loaded.snapshot.organizationId;
      const plano = dogSavePlan(loaded.dogs, payload.dogs, payload.removedDogIds, payload.newDogs);

      for (const { id: dogId, values } of plano.updates) {
        const fotoAnterior = loaded.dogs.find((dog) => dog.id === dogId)?.photo_url ?? null;
        const foto = await storeDogPhoto(supabase, organizationId, dogId, values.photo_url);
        const { error: dogError } = await supabase.from('dogs').update({ ...values, photo_url: foto }).eq('id', dogId);
        if (dogError) throw new Error(dogError.message);
        // Trocou ou tirou a foto: o arquivo antigo sai do bucket (senão vira lixo para sempre).
        if (foto !== fotoAnterior) await deleteDogPhoto(supabase, fotoAnterior);
      }

      // Cão novo: insere PRIMEIRO (o id do banco é que nomeia o arquivo da foto) e sobe a foto
      // depois. Nome repetido não entra de novo — quem decide é o dogSavePlan.
      for (const novo of plano.inserts) {
        const { data: criado, error: novoError } = await supabase
          .from('dogs')
          .insert({ organization_id: organizationId, client_id: id, ...novo, photo_url: null })
          .select('id')
          .single();
        if (novoError) throw new Error(novoError.message);
        const novoId = (criado as { id: string } | null)?.id;
        if (!novoId) continue;
        const foto = await storeDogPhoto(supabase, organizationId, novoId, novo.photo_url);
        if (foto) {
          const { error: fotoError } = await supabase.from('dogs').update({ photo_url: foto }).eq('id', novoId);
          if (fotoError) throw new Error(fotoError.message);
        }
      }

      if (plano.idsToDelete.length > 0) {
        const fotos = plano.idsToDelete.map((dogId) => loaded.dogs.find((dog) => dog.id === dogId)?.photo_url ?? null);
        const { error: removeError } = await supabase.from('dogs').delete().eq('client_id', id).in('id', plano.idsToDelete);
        if (removeError) throw new Error(removeError.message);
        for (const foto of fotos) await deleteDogPhoto(supabase, foto);
      }

      const instructions = normalizeText(payload.instructions);
      const plan = instructionWritePlan(loaded.instructionId, instructions);
      if (plan.mode === 'update') {
        const { error: instructionError } = await supabase.from('client_instructions').update({ pickup_access_instructions: instructions }).eq('id', plan.id);
        if (instructionError) throw new Error(instructionError.message);
      } else if (plan.mode === 'upsert') {
        const { data: client } = await supabase.from('clients').select('organization_id').eq('id', id).single();
        const organizationId = (client as { organization_id: string } | null)?.organization_id ?? null;
        const { error: instructionError } = await supabase
          .from('client_instructions')
          .upsert({ organization_id: organizationId, client_id: id, pickup_access_instructions: instructions }, { onConflict: 'client_id' });
        if (instructionError) throw new Error(instructionError.message);
      }

      router.back();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the client.');
    } finally {
      setSaving(false);
    }
  };

  /** Desliga o cliente (mantem historico) — a saida recomendada quando ha reservas/rotas. */
  const arquivarCliente = async () => {
    setDeleting(true);
    setError(null);
    const { error: archiveError } = await supabase.from('clients').update({ active: false }).eq('id', id);
    setDeleting(false);
    if (archiveError) { setError(archiveError.message); return; }
    router.back();
  };

  /**
   * Exclusao de verdade. Duas etapas quando existe historico: o primeiro alerta explica
   * o que vai junto e o segundo confirma, para nao apagar meses de reservas num toque.
   * Sem historico, oferece DESFAZER logo depois — porque nesse caso nada foi perdido de
   * verdade e reinserir o cliente com os mesmos ids devolve tudo como estava.
   */
  const excluirCliente = async () => {
    if (!loaded || !id) return;
    const plan = clientDeletePlan(loaded.impact);
    const snapshot = loaded.snapshot;
    const podeDesfazer = canUndoClientDelete(loaded.impact);

    const apagarDeVerdade = async () => {
      setDeleting(true);
      setError(null);
      const { error: deleteError } = await supabase.from('clients').delete().eq('id', id);
      setDeleting(false);
      if (deleteError) { setError(deleteError.message); return; }
      if (!podeDesfazer) { router.back(); return; }
      showAlert(
        'Client deleted',
        `${loaded.current.name} was removed. Nothing else was linked to this client, so it can still be put back exactly as it was.`,
        [
          { text: 'Done', onPress: () => router.back() },
          { text: 'Undo', onPress: () => void desfazerExclusao(snapshot) },
        ],
      );
    };

    const botoes: Parameters<typeof showAlert>[2] = [{ text: 'Cancel', style: 'cancel' }];
    if (plan.offerArchive) {
      botoes.push({ text: 'Keep history (inactive)', onPress: () => void arquivarCliente() });
    }
    botoes.push({
      text: 'Delete',
      style: 'destructive',
      onPress: () => {
        if (!plan.hasHistory) { void apagarDeVerdade(); return; }
        showAlert(
          'Last check',
          `Permanently delete “${loaded.current.name}” and the history of ${loaded.impact.reservations} booking(s) and ${loaded.impact.routeStops} route stop(s)?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Keep history (inactive)', onPress: () => void arquivarCliente() },
            { text: 'Delete for good', style: 'destructive', onPress: () => void apagarDeVerdade() },
          ],
        );
      },
    });

    showAlert(plan.title, plan.message, botoes);
  };

  /** Reinsere cliente, caes e instrucoes com os MESMOS ids. */
  const desfazerExclusao = async (snapshot: ClientSnapshot) => {
    setDeleting(true);
    setError(null);
    const rows = clientRestoreRows(snapshot);
    const { error: clientError } = await supabase.from('clients').insert(rows.client);
    let falha = clientError;
    if (!falha && rows.dogs.length > 0) {
      const { error: dogError } = await supabase.from('dogs').insert(rows.dogs);
      falha = dogError;
    }
    if (!falha && rows.instruction) {
      const { error: instructionError } = await supabase.from('client_instructions').insert(rows.instruction);
      falha = instructionError;
    }
    setDeleting(false);
    if (falha) { setError(`Could not undo the deletion: ${falha.message}`); return; }
    router.back();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>Edit client</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
      ) : loaded ? (
        <EditClientForm
          current={loaded.current}
          dogs={loaded.dogs}
          instructions={loaded.instructions}
          active={loaded.active}
          impact={loaded.impact}
          saving={saving}
          deleting={deleting}
          error={error}
          onSave={(payload) => { void save(payload); }}
          onDelete={() => { void excluirCliente(); }}
          onCancel={() => router.back()}
        />
      ) : (
        <Text style={styles.error}>{error ?? 'Client not found.'}</Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 26, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
  center: { marginTop: 60 },
  error: { color: colors.urgency, fontSize: 14, fontWeight: '700', padding: 20, lineHeight: 20 },
});
