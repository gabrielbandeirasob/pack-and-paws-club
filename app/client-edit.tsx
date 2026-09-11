/**
 * Tela de edicao do cliente (aberta ao tocar no card da lista).
 * Salva: dados do cliente, endereco, notas, instrucoes de acesso e cachorros.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { EditClientForm, type ClientSavePayload, type EditableDog } from '@/features/clients/EditClientForm';
import {
  clientUpdatePayload,
  dogUpdatePayload,
  firstInstruction,
  instructionWritePlan,
  normalizeText,
  type EditableClient,
} from '@/features/clients/clientsService';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type Loaded = {
  current: EditableClient;
  dogs: EditableDog[];
  instructions: string | null;
  instructionId: string | null;
  active: boolean;
};

export default function ClientEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { setError('Client not found.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('clients')
      .select('id, name, phone, address_line_1, address_line_2, city, state, postal_code, notes, special_scheduling_instructions, latitude, longitude, active, dogs(id, name, breed, behavior_notes, medical_notes), client_instructions(id, pickup_access_instructions)')
      .eq('id', id)
      .single();
    if (loadError || !data) {
      setError(loadError?.message ?? 'Client not found.');
      setLoading(false);
      return;
    }
    const row = data as unknown as EditableClient & {
      active: boolean;
      dogs: { id: string; name: string; breed: string | null; behavior_notes: string | null; medical_notes: string | null }[] | null;
      // a API devolve OBJETO (UNIQUE em client_id), nao lista
      client_instructions:
        | { id: string; pickup_access_instructions: string | null }
        | { id: string; pickup_access_instructions: string | null }[]
        | null;
    };
    const instruction = firstInstruction(row.client_instructions);
    setLoaded({
      current: row,
      dogs: (row.dogs ?? []).map((dog) => ({ id: dog.id, name: dog.name, breed: dog.breed, behavior_notes: dog.behavior_notes, medical_notes: dog.medical_notes })),
      instructions: instruction?.pickup_access_instructions ?? null,
      instructionId: instruction?.id ?? null,
      active: row.active,
    });
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const save = async (payload: ClientSavePayload) => {
    if (!loaded) return;
    setSaving(true);
    setError(null);
    try {
      const { address_changed: _ignored, ...clientColumns } = clientUpdatePayload(loaded.current, payload.client);
      const { error: clientError } = await supabase.from('clients').update({ ...clientColumns, active: payload.active }).eq('id', id);
      if (clientError) throw new Error(clientError.message);

      for (const dog of payload.dogs) {
        const { error: dogError } = await supabase.from('dogs').update(dogUpdatePayload(dog)).eq('id', dog.id);
        if (dogError) throw new Error(dogError.message);
      }

      if (payload.newDogs.length > 0) {
        const { data: client } = await supabase.from('clients').select('organization_id').eq('id', id).single();
        const organizationId = (client as { organization_id: string } | null)?.organization_id ?? null;
        if (!organizationId) throw new Error('Organization not found for this client.');
        const { error: newDogError } = await supabase.from('dogs').insert(
          payload.newDogs.map((name) => ({ organization_id: organizationId, client_id: id, name })),
        );
        if (newDogError) throw new Error(newDogError.message);
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
          saving={saving}
          error={error}
          onSave={(payload) => { void save(payload); }}
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
