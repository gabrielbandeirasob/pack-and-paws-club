/**
 * Formulario de EDICAO do cliente (nome, telefone, endereco completo, notas,
 * instrucoes de acesso) e dos cachorros (nome, raca, comportamento, saude).
 *
 * O app so tinha "Add from Contacts": um endereco errado ficava errado para sempre,
 * e sem endereco certo a rota/navegacao nao funciona. Esta tela resolve isso.
 *
 * Agora tambem: acoes rapidas (ligar / mensagem / rota), tirar um cao do cadastro
 * e EXCLUIR o cliente — com o aviso do que vai junto (ver clientDeletePlan).
 */
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  clientDeletePlan,
  splitContactName,
  splitDogNames,
  type ClientFormValues,
  type ClientHistoryCounts,
  type DogFormValues,
  type EditableClient,
} from '@/features/clients/clientsService';
import {
  clientMessageTemplate,
  directionsTarget,
  phoneUrl,
  smsUrl,
} from '@/features/clients/contactActions';
import { navigationOptions } from '@/features/maps/links';
import { loadPreferredNavApp } from '@/features/maps/preferences';
import { navigationUrlFor } from '@/features/maps/navigation';
import { colors, radii } from '@/features/theme/tokens';

export type EditableDog = DogFormValues & { id: string };

export type ClientSavePayload = {
  client: ClientFormValues;
  instructions: string | null;
  dogs: EditableDog[];
  newDogs: string[];
  /** ids de cachorros tirados do cadastro nesta edicao (apagados ao salvar) */
  removedDogIds: string[];
  active: boolean;
};

type Props = {
  current: EditableClient;
  dogs: EditableDog[];
  instructions: string | null;
  active: boolean;
  /** o que existe ligado a este cliente (para o aviso de exclusao) */
  impact?: ClientHistoryCounts | null;
  saving?: boolean;
  deleting?: boolean;
  error?: string | null;
  onSave: (payload: ClientSavePayload) => void;
  onDelete?: () => void;
  onCancel: () => void;
};

/** Abre o app de mapa preferido do gestor (mesma regra do app do motorista). */
async function openDirections(client: EditableClient) {
  const target = directionsTarget(client);
  if (!target) {
    Alert.alert('No address', 'Add the street and city first — the driver route needs them.');
    return;
  }
  const preferred = await loadPreferredNavApp();
  if (preferred) {
    await Linking.openURL(navigationUrlFor(preferred, target));
    return;
  }
  const options = navigationOptions(target);
  Alert.alert('Open route in', undefined, [
    { text: options[0].label, onPress: () => void Linking.openURL(options[0].url) },
    { text: options[1].label, onPress: () => void Linking.openURL(options[1].url) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

function Field({ label, value, onChangeText, ...rest }: { label: string; value: string; onChangeText: (t: string) => void } & Partial<React.ComponentProps<typeof TextInput>>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...rest}
      />
    </View>
  );
}

export function EditClientForm({ current, dogs, instructions, active, impact, saving, deleting, error, onSave, onDelete, onCancel }: Props) {
  const [form, setForm] = useState<ClientFormValues>({
    name: current.name ?? '',
    phone: current.phone ?? '',
    address_line_1: current.address_line_1 ?? '',
    address_line_2: current.address_line_2 ?? '',
    city: current.city ?? '',
    state: current.state ?? '',
    postal_code: current.postal_code ?? '',
    notes: current.notes ?? '',
    special_scheduling_instructions: current.special_scheduling_instructions ?? '',
  } as unknown as ClientFormValues);
  const [access, setAccess] = useState(instructions ?? '');
  const [dogRows, setDogRows] = useState<EditableDog[]>(dogs);
  const [removedDogIds, setRemovedDogIds] = useState<string[]>([]);
  const [newDogs, setNewDogs] = useState('');
  const [isActive, setIsActive] = useState(active);

  const set = (key: keyof ClientFormValues) => (text: string) => setForm((prev) => ({ ...prev, [key]: text }));
  const setDog = (id: string, key: keyof DogFormValues) => (text: string) =>
    setDogRows((prev) => prev.map((dog) => (dog.id === id ? { ...dog, [key]: text } : dog)));

  const toggleDogRemoval = (dog: EditableDog) => {
    if (removedDogIds.includes(dog.id)) {
      setRemovedDogIds((prev) => prev.filter((id) => id !== dog.id));
      return;
    }
    Alert.alert(
      `Remove ${dog.name || 'this dog'}?`,
      'The dog is taken out of this client when you save. Bookings already made stay in the calendar until you delete them there.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => setRemovedDogIds((prev) => [...prev, dog.id]) },
      ],
    );
  };

  // Nome que veio do contato com o cachorro colado: "Leigh Ann(Mowgli)".
  // O nome errado fica gravado, e a lista mistura pessoa e cao. Aqui o gestor
  // conserta em um toque — sem apagar nada (o nome do cao vai para a lista de novos).
  const nameHint = typeof form.name === 'string' ? splitContactName(form.name as unknown as string) : { clientName: '', dogHint: '' };
  const canCleanName = nameHint.dogHint.length > 0 && nameHint.clientName !== (form.name as unknown as string);

  const applyNameHint = () => {
    setForm((prev) => ({ ...prev, name: nameHint.clientName }));
    const merged = splitDogNames(`${newDogs}, ${nameHint.dogHint}`);
    setNewDogs(merged.join(', '));
  };

  const phone = form.phone as unknown as string;
  const callUrl = phoneUrl(phone);
  const textUrl = smsUrl(phone, clientMessageTemplate(form.name as unknown as string));
  const hasAddress = directionsTarget(current) !== null;
  const deletePlan = impact ? clientDeletePlan(impact) : null;

  return (
    // Sem o KeyboardAvoidingView o teclado TAPA os campos de baixo (os dados do cao ficam no
    // fim do formulario). Padrao ja usado no AddClientReview/LoginForm/DriverInviteForm.
    <KeyboardAvoidingView testID="teclado-form" style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never">
      <Field label="Name" value={form.name as unknown as string} onChangeText={set('name')} autoCapitalize="words" />
      {canCleanName ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Move dog name out of client name" onPress={applyNameHint} style={({ pressed }) => [styles.hintButton, pressed && styles.pressed]}>
          <Text style={styles.hintText}>Dog name inside the client name — move “{nameHint.dogHint}” to the dog list</Text>
        </Pressable>
      ) : null}
      <Field label="Phone" value={phone} onChangeText={set('phone')} keyboardType="phone-pad" />
      {callUrl || textUrl ? (
        <View style={styles.quickRow}>
          {callUrl ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Call client" onPress={() => void Linking.openURL(callUrl)} style={({ pressed }) => [styles.quickButton, pressed && styles.pressed]}>
              <Text style={styles.quickText}>Call</Text>
            </Pressable>
          ) : null}
          {textUrl ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Text client" onPress={() => void Linking.openURL(textUrl)} style={({ pressed }) => [styles.quickButton, pressed && styles.pressed]}>
              <Text style={styles.quickText}>Text</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Text style={styles.section}>Address (used by the driver route)</Text>
      <Field label="Street" value={form.address_line_1 as unknown as string} onChangeText={set('address_line_1')} autoCapitalize="words" />
      <Field label="Apt / Suite" value={form.address_line_2 as unknown as string} onChangeText={set('address_line_2')} autoCapitalize="words" />
      <Field label="City" value={form.city as unknown as string} onChangeText={set('city')} autoCapitalize="words" />
      <View style={styles.row}>
        <View style={styles.half}><Field label="State" value={form.state as unknown as string} onChangeText={set('state')} autoCapitalize="characters" /></View>
        <View style={styles.half}><Field label="ZIP" value={form.postal_code as unknown as string} onChangeText={set('postal_code')} keyboardType="numbers-and-punctuation" /></View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open route to this address" onPress={() => void openDirections(current)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Text style={styles.secondaryText}>{hasAddress ? 'Directions to this address' : 'Directions (needs an address)'}</Text>
      </Pressable>
      <Text style={styles.section}>Access & notes</Text>
      <Field label="Pickup access instructions" value={access} onChangeText={setAccess} multiline />
      <Field label="Scheduling notes" value={form.special_scheduling_instructions as unknown as string} onChangeText={set('special_scheduling_instructions')} multiline />
      <Field label="Internal notes" value={form.notes as unknown as string} onChangeText={set('notes')} multiline />

      <Text style={styles.section}>Dogs</Text>
      {dogRows.map((dog) => {
        const removed = removedDogIds.includes(dog.id);
        return (
          <View key={dog.id} style={[styles.dogCard, removed && styles.dogCardRemoved]}>
            <View style={styles.dogHeader}>
              <Text style={styles.dogTitle}>{dog.name || 'Dog'}{removed ? ' — will be removed' : ''}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={removed ? `Keep ${dog.name}` : `Remove ${dog.name}`} onPress={() => toggleDogRemoval(dog)} hitSlop={8} style={styles.dogAction}>
                <Text style={removed ? styles.dogUndo : styles.dogRemove}>{removed ? 'Keep' : '✕ Remove'}</Text>
              </Pressable>
            </View>
            <Field label="Dog name" value={dog.name} onChangeText={setDog(dog.id, 'name')} autoCapitalize="words" editable={!removed} />
            <Field label="Breed" value={(dog.breed ?? '') as string} onChangeText={setDog(dog.id, 'breed')} autoCapitalize="words" editable={!removed} />
            <Field label="Behavior notes" value={(dog.behavior_notes ?? '') as string} onChangeText={setDog(dog.id, 'behavior_notes')} multiline editable={!removed} />
            <Field label="Medical notes" value={(dog.medical_notes ?? '') as string} onChangeText={setDog(dog.id, 'medical_notes')} multiline editable={!removed} />
          </View>
        );
      })}
      <Field label="Add dogs (comma separated)" value={newDogs} onChangeText={setNewDogs} />

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.switchLabel}>Active client</Text>
          <Text style={styles.switchHint}>Turn off to keep the history and take the client off the active list.</Text>
        </View>
        <Switch value={isActive} onValueChange={setIsActive} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Save client" disabled={saving || deleting} onPress={() => onSave({ client: form, instructions: access, dogs: dogRows, newDogs: splitDogNames(newDogs), removedDogIds, active: isActive })} style={({ pressed }) => [styles.save, pressed && styles.pressed, (saving || deleting) && styles.disabled]}>
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save client'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>

      {onDelete ? (
        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>Delete client</Text>
          <Text style={styles.dangerHint}>
            {deletePlan?.hasHistory
              ? `This client has ${impact?.dogs ?? 0} dog(s) and ${impact?.reservations ?? 0} booking(s) on record. Deleting removes that history for good.`
              : 'There is no booking history for this client yet.'}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Delete client" disabled={deleting || saving} onPress={onDelete} style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed, (deleting || saving) && styles.disabled]}>
            <Text style={styles.deleteText}>{deleting ? 'Deleting…' : 'Delete permanently'}</Text>
          </Pressable>
        </View>
      ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.cream },
  body: { padding: 18, paddingBottom: 60 },
  section: { fontFamily: 'serif', fontSize: 15, fontWeight: '800', color: colors.forest900, marginTop: 18, marginBottom: 4 },
  field: { marginTop: 10 },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, marginBottom: 5 },
  input: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  quickButton: { flex: 1, backgroundColor: colors.sage, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  quickText: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  hintButton: { backgroundColor: colors.sage, borderRadius: 12, padding: 11, marginTop: 10 },
  hintText: { color: colors.forest700, fontWeight: '800', fontSize: 12, lineHeight: 17 },
  secondaryButton: { borderWidth: 1, borderColor: colors.forest700, borderRadius: 12, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  secondaryText: { color: colors.forest700, fontWeight: '800', fontSize: 13 },
  dogCard: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 12, marginTop: 10 },
  dogCardRemoved: { opacity: 0.55, borderStyle: 'dashed' },
  dogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dogTitle: { color: colors.forest900, fontWeight: '800', fontSize: 14, flex: 1 },
  dogAction: { paddingVertical: 2, paddingHorizontal: 2 },
  dogRemove: { color: colors.urgency, fontWeight: '900', fontSize: 12 },
  dogUndo: { color: colors.gold, fontWeight: '900', fontSize: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, gap: 14 },
  switchText: { flex: 1 },
  switchLabel: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  switchHint: { color: colors.muted, fontSize: 12, marginTop: 3, lineHeight: 17 },
  error: { color: colors.urgency, fontSize: 13, fontWeight: '700', marginTop: 14, lineHeight: 19 },
  save: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  saveText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  cancel: { padding: 14, alignItems: 'center' },
  cancelText: { color: colors.muted, fontWeight: '800' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
  dangerZone: { marginTop: 26, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 },
  dangerTitle: { color: colors.urgency, fontWeight: '900', fontSize: 14 },
  dangerHint: { color: colors.muted, fontSize: 12, marginTop: 5, lineHeight: 17 },
  deleteButton: { borderWidth: 1.5, borderColor: colors.urgency, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 12 },
  deleteText: { color: colors.urgency, fontWeight: '900', fontSize: 14 },
});
