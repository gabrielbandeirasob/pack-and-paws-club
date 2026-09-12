/**
 * Formulario de EDICAO do cliente (nome, telefone, endereco completo, notas,
 * instrucoes de acesso) e dos cachorros (nome, raca, comportamento, saude).
 *
 * O app so tinha "Add from Contacts": um endereco errado ficava errado para sempre,
 * e sem endereco certo a rota/navegacao nao funciona. Esta tela resolve isso.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { ClientFormValues, DogFormValues, EditableClient } from '@/features/clients/clientsService';
import { splitDogNames } from '@/features/clients/clientsService';
import { colors, radii } from '@/features/theme/tokens';

export type EditableDog = DogFormValues & { id: string };

export type ClientSavePayload = {
  client: ClientFormValues;
  instructions: string | null;
  dogs: EditableDog[];
  newDogs: string[];
  active: boolean;
};

type Props = {
  current: EditableClient;
  dogs: EditableDog[];
  instructions: string | null;
  active: boolean;
  saving?: boolean;
  error?: string | null;
  onSave: (payload: ClientSavePayload) => void;
  onCancel: () => void;
};

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

export function EditClientForm({ current, dogs, instructions, active, saving, error, onSave, onCancel }: Props) {
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
  const [newDogs, setNewDogs] = useState('');
  const [isActive, setIsActive] = useState(active);

  const set = (key: keyof ClientFormValues) => (text: string) => setForm((prev) => ({ ...prev, [key]: text }));
  const setDog = (id: string, key: keyof DogFormValues) => (text: string) =>
    setDogRows((prev) => prev.map((dog) => (dog.id === id ? { ...dog, [key]: text } : dog)));

  return (
    // Sem o KeyboardAvoidingView o teclado TAPA os campos de baixo (os dados do cao ficam no
    // fim do formulario). Padrao ja usado no AddClientReview/LoginForm/DriverInviteForm.
    <KeyboardAvoidingView testID="teclado-form" style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never">
      <Field label="Name" value={form.name as unknown as string} onChangeText={set('name')} autoCapitalize="words" />
      <Field label="Phone" value={form.phone as unknown as string} onChangeText={set('phone')} keyboardType="phone-pad" />
      <Text style={styles.section}>Address (used by the driver route)</Text>
      <Field label="Street" value={form.address_line_1 as unknown as string} onChangeText={set('address_line_1')} autoCapitalize="words" />
      <Field label="Apt / Suite" value={form.address_line_2 as unknown as string} onChangeText={set('address_line_2')} autoCapitalize="words" />
      <Field label="City" value={form.city as unknown as string} onChangeText={set('city')} autoCapitalize="words" />
      <View style={styles.row}>
        <View style={styles.half}><Field label="State" value={form.state as unknown as string} onChangeText={set('state')} autoCapitalize="characters" /></View>
        <View style={styles.half}><Field label="ZIP" value={form.postal_code as unknown as string} onChangeText={set('postal_code')} keyboardType="numbers-and-punctuation" /></View>
      </View>
      <Text style={styles.section}>Access & notes</Text>
      <Field label="Pickup access instructions" value={access} onChangeText={setAccess} multiline />
      <Field label="Scheduling notes" value={form.special_scheduling_instructions as unknown as string} onChangeText={set('special_scheduling_instructions')} multiline />
      <Field label="Internal notes" value={form.notes as unknown as string} onChangeText={set('notes')} multiline />

      <Text style={styles.section}>Dogs</Text>
      {dogRows.map((dog) => (
        <View key={dog.id} style={styles.dogCard}>
          <Field label="Dog name" value={dog.name} onChangeText={setDog(dog.id, 'name')} autoCapitalize="words" />
          <Field label="Breed" value={(dog.breed ?? '') as string} onChangeText={setDog(dog.id, 'breed')} autoCapitalize="words" />
          <Field label="Behavior notes" value={(dog.behavior_notes ?? '') as string} onChangeText={setDog(dog.id, 'behavior_notes')} multiline />
          <Field label="Medical notes" value={(dog.medical_notes ?? '') as string} onChangeText={setDog(dog.id, 'medical_notes')} multiline />
        </View>
      ))}
      <Field label="Add dogs (comma separated)" value={newDogs} onChangeText={setNewDogs} />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Active client</Text>
        <Switch value={isActive} onValueChange={setIsActive} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Save client" disabled={saving} onPress={() => onSave({ client: form, instructions: access, dogs: dogRows, newDogs: splitDogNames(newDogs), active: isActive })} style={({ pressed }) => [styles.save, pressed && styles.pressed, saving && styles.disabled]}>
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save client'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
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
  dogCard: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 12, marginTop: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 },
  switchLabel: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  error: { color: colors.urgency, fontSize: 13, fontWeight: '700', marginTop: 14, lineHeight: 19 },
  save: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  saveText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  cancel: { padding: 14, alignItems: 'center' },
  cancelText: { color: colors.muted, fontWeight: '800' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
});
