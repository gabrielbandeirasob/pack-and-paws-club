import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { AddClientReview } from '@/features/clients/AddClientReview';
import { ClientsList } from '@/features/clients/ClientsList';
import { clientHasInstructions, planContactAdd, splitContactName, type ExistingContactClient } from '@/features/clients/clientsService';
import { createContactsService, type ContactsService } from '@/features/clients/contactsService';
import { mapContactToClientInput } from '@/features/clients/mapContact';
import type { ClientWithDogs, NewClientInput, PhoneContactCandidate } from '@/features/clients/types';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type ClientRow = { id: string; name: string; phone: string | null; address_line_1: string | null; city: string | null; state: string | null; active: boolean; dogs: { name: string }[] };
type MembershipRow = { organization_id: string };

export default function ClientsScreen() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientWithDogs[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<PhoneContactCandidate[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [selected, setSelected] = useState<{
    input: NewClientInput;
    contactId: string;
    existing: ExistingContactClient | null;
    /** Nome de cachorro lido do contato ("Leigh Ann(Mowgli)") para ja vir preenchido. */
    dogHint: string;
  } | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [service] = useState<ContactsService>(() => createContactsService());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: memberships, error: membershipError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1);
    if (membershipError) { setError(membershipError.message); setLoading(false); return; }
    const organization_id = (memberships as MembershipRow[] | null)?.[0]?.organization_id ?? null;
    setOrganizationId(organization_id);
    if (!organization_id) { setClients([]); setLoading(false); return; }
    const { data: rows, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, phone, address_line_1, city, state, active, dogs(name)')
      .eq('organization_id', organization_id)
      .order('name');
    if (clientsError) { setError(clientsError.message); setLoading(false); return; }
    setClients(((rows as ClientRow[]) ?? []).map((row) => ({ ...row, dogs: (row.dogs ?? []).map((dog) => dog.name) })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openPicker = async () => {
    setPickerVisible(true);
    setContactError(null);
    setNotice(null);
    setQuery('');
    try {
      const permission = await service.requestPermission();
      if (permission !== 'granted') {
        setContactError('Contacts access is required to add clients. Enable it in iPhone Settings.');
        return;
      }
      await runContactSearch('');
    } catch (reason) {
      setContactError(reason instanceof Error ? reason.message : 'Unable to access contacts.');
    }
  };

  const runContactSearch = async (text: string) => {
    setContactSearching(true);
    setContactError(null);
    try {
      setContacts(await service.search(text));
    } catch (reason) {
      setContactError(reason instanceof Error ? reason.message : 'Unable to search contacts.');
    } finally {
      setContactSearching(false);
    }
  };

  /**
   * Esse contato do telefone ja virou cliente? O banco tem UNIQUE
   * (organization_id, source_contact_identifier): nao pode existir dois cadastros do mesmo contato.
   */
  const findExistingClient = useCallback(async (contactIdentifier: string): Promise<ExistingContactClient | null> => {
    if (!organizationId || !contactIdentifier) return null;
    const { data, error: lookupError } = await supabase
      .from('clients')
      .select('id, name, dogs(name), client_instructions(id)')
      .eq('organization_id', organizationId)
      .eq('source_contact_identifier', contactIdentifier)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!data) return null;
    const row = data as unknown as {
      id: string;
      name: string;
      dogs: { name: string }[] | null;
      // a API devolve OBJETO (UNIQUE em client_id), nao lista
      client_instructions: { id: string } | { id: string }[] | null;
    };
    return {
      id: row.id,
      name: row.name,
      hasInstructions: clientHasInstructions(row.client_instructions),
      dogs: (row.dogs ?? []).map((dog) => dog.name),
    };
  }, [organizationId]);

  const chooseContact = async (contact: PhoneContactCandidate) => {
    const input = mapContactToClientInput(contact, contact.id);
    setContactError(null);
    setNotice(null);
    setContactSearching(true);
    try {
      const existing = await findExistingClient(contact.id);
      setSelected({ input, contactId: contact.id, existing, dogHint: splitContactName(contact.name).dogHint });
    } catch (reason) {
      setContactError(reason instanceof Error ? reason.message : 'Unable to check this contact.');
    } finally {
      setContactSearching(false);
    }
  };

  const addDogsToClient = async (clientId: string, dogNames: string[]) => {
    if (dogNames.length === 0) return;
    const { error: dogsError } = await supabase.from('dogs').insert(
      dogNames.map((name) => ({ organization_id: organizationId, client_id: clientId, name })),
    );
    if (dogsError) throw new Error(dogsError.message);
  };

  const saveClient = async (payload: { client: NewClientInput; dogs: string[] }) => {
    if (!organizationId) throw new Error('Organization not found for this account.');
    let plan = planContactAdd(selected?.existing ?? null, payload.client, payload.dogs);
    let clientId = plan.clientId;

    if (plan.mode === 'create') {
      const { data: inserted, error: clientError } = await supabase
        .from('clients')
        .insert({ ...payload.client, organization_id: organizationId })
        .select('id')
        .single();
      if (clientError && clientError.code !== '23505') throw new Error(clientError.message);
      if (clientError) {
        // Corrida: outro aparelho cadastrou o mesmo contato entre a busca e o insert.
        // Em vez de devolver o erro cru do banco (duplicate key), usa o cadastro que ja existe.
        const raced = await findExistingClient(payload.client.source_contact_identifier ?? '');
        if (!raced) throw new Error(clientError.message);
        plan = planContactAdd(raced, payload.client, payload.dogs);
        clientId = raced.id;
      } else {
        clientId = inserted.id as string;
      }
    }
    if (!clientId) throw new Error('Could not save the client.');

    await addDogsToClient(clientId, plan.dogsToAdd);
    if (plan.instructionsToAdd) {
      const { error: instructionError } = await supabase.from('client_instructions').insert({
        organization_id: organizationId,
        client_id: clientId,
        pickup_access_instructions: plan.instructionsToAdd,
      });
      if (instructionError) throw new Error(instructionError.message);
    }
    return { mode: plan.mode, name: selected?.existing?.name ?? payload.client.name, dogsAdded: plan.dogsToAdd };
  };

  const finishAdd = async (payload: { client: NewClientInput; dogs: string[] }) => {
    const result = await saveClient(payload);
    setPickerVisible(false);
    setSelected(null);
    setContacts([]);
    if (result.dogsAdded.length === 0) setNotice(`${result.name} is already a client — no new dog was added.`);
    else if (result.mode === 'reuse') setNotice(`Added ${result.dogsAdded.join(', ')} to ${result.name} (existing client).`);
    else setNotice(null);
    await load();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ClientsList
        clients={clients}
        loading={loading}
        onAddClient={openPicker}
        onOpenClient={(clientId) => router.push({ pathname: '/client-edit', params: { id: clientId } })}
      />
      {error ? <Text style={styles.banner}>{error}</Text> : null}
      {notice ? <Text style={styles.noticeBanner}>{notice}</Text> : null}
      <Modal visible={pickerVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setPickerVisible(false)}>
        <SafeAreaView style={styles.modal}>
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalHeader}>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPickerVisible(false)} style={styles.closeButton}>
                <Text style={styles.closeText}>✕ Close</Text>
              </Pressable>
              <Text style={styles.modalTitle}>{selected ? 'Review client' : 'Add from Contacts'}</Text>
            </View>
            {selected ? (
              <AddClientReview
                initial={selected.input}
                existingClient={selected.existing}
                initialDogNames={selected.dogHint}
                onSave={finishAdd}
                onCancel={() => { setSelected(null); setContactError(null); }}
              />
            ) : (
              <View style={styles.searchBody}>
                <TextInput
                  accessibilityLabel="Search contacts"
                  autoCapitalize="words"
                  placeholder="Search name or phone…"
                  placeholderTextColor={colors.muted}
                  value={query}
                  onChangeText={(text) => { setQuery(text); void runContactSearch(text); }}
                  style={styles.searchInput}
                />
                {contactError ? <Text style={styles.contactError}>{contactError}</Text> : null}
                {contactSearching ? <ActivityIndicator style={styles.marginTop} color={colors.gold} size="large" /> : null}
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
                  {contacts.map((contact) => (
                    <Pressable key={contact.id} accessibilityRole="button" onPress={() => { void chooseContact(contact); }} style={({ pressed }) => [styles.contactRow, pressed && styles.pressedRow]}>
                      <View style={styles.contactAvatar}><Text style={styles.contactInitial}>{(contact.name[0] ?? '?').toUpperCase()}</Text></View>
                      <View style={styles.contactInfo}>
                        <Text style={styles.contactName}>{contact.name}</Text>
                        <Text style={styles.contactMeta}>{contact.phone ?? ''}{contact.phone && contact.address ? ' · ' : ''}{contact.address ? [contact.address.street, contact.address.city].filter(Boolean).join(', ') : ''}</Text>
                      </View>
                    </Pressable>
                  ))}
                  {!contactSearching && contacts.length === 0 && !contactError ? <Text style={styles.emptyText}>No contacts found.</Text> : null}
                </ScrollView>
              </View>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  banner: { position: 'absolute', left: 16, right: 16, bottom: 24, backgroundColor: colors.urgency, color: 'white', borderRadius: 12, padding: 12, overflow: 'hidden', textAlign: 'center' },
  noticeBanner: { position: 'absolute', left: 16, right: 16, bottom: 24, backgroundColor: colors.sage, color: colors.forest900, fontWeight: '800', borderRadius: 12, padding: 12, overflow: 'hidden', textAlign: 'center' },
  flex: { flex: 1 },
  modal: { flex: 1, backgroundColor: colors.cream },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 14 },
  closeButton: { paddingVertical: 10, paddingRight: 8 },
  closeText: { color: colors.forest700, fontWeight: '800' },
  modalTitle: { fontFamily: 'serif', fontSize: 20, fontWeight: '800', color: colors.forest900, flex: 1 },
  searchBody: { flex: 1, padding: 16 },
  searchInput: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, fontSize: 15 },
  contactError: { color: colors.urgency, fontSize: 13, fontWeight: '700', marginTop: 14, lineHeight: 19 },
  marginTop: { marginTop: 30 },
  results: { paddingBottom: 40 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 12, marginTop: 10 },
  pressedRow: { opacity: 0.7 },
  contactAvatar: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  contactInitial: { color: colors.forest700, fontWeight: '900', fontSize: 17 },
  contactInfo: { flex: 1 },
  contactName: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  contactMeta: { color: colors.muted, fontSize: 12, marginTop: 3, lineHeight: 17 },
  emptyText: { color: colors.muted, textAlign: 'center', marginTop: 40, fontSize: 14 },
});
