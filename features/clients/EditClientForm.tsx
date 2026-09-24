/**
 * Formulario de EDICAO do cliente (nome, telefone, endereco completo, notas,
 * instrucoes de acesso) e dos cachorros (FOTO, nome, raca, comportamento, saude).
 *
 * O app so tinha "Add from Contacts": um endereco errado ficava errado para sempre,
 * e sem endereco certo a rota/navegacao nao funciona. Esta tela resolve isso.
 *
 * Agora tambem: acoes rapidas (ligar / mensagem / rota), tirar um cao do cadastro
 * e EXCLUIR o cliente — com o aviso do que vai junto (ver clientDeletePlan).
 *
 * FOTO DO CAO (23/09/2026): a creche identifica o cao pela foto na porta do cliente.
 * Cada cao tem foto (tirar agora ou escolher da galeria); "Add dogs" agora cria um
 * CARTAO por nome digitado, para o gestor poder anexar a foto antes mesmo de salvar.
 */
import { useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  clientDeletePlan,
  dogRemovalMessage,
  normalizeForSearch,
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
import { dogPhotoError, isLocalPhoto, pickDogPhoto, type DogPhotoChoice } from '@/features/dogs/dogPhoto';
import { showAlert } from '@/features/ui/alert';
import { navigationOptions } from '@/features/maps/links';
import { loadPreferredNavApp } from '@/features/maps/preferences';
import { navigationUrlFor } from '@/features/maps/navigation';
import { colors, radii } from '@/features/theme/tokens';

export type EditableDog = DogFormValues & { id: string };

/** Cao recem-adicionado na tela: ainda nao existe no banco (key = identidade local). */
type NovoDog = DogFormValues & { key: string };

export type ClientSavePayload = {
  client: ClientFormValues;
  instructions: string | null;
  dogs: EditableDog[];
  newDogs: DogFormValues[];
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
    showAlert('No address', 'Add the street and city first — the driver route needs them.');
    return;
  }
  const preferred = await loadPreferredNavApp();
  if (preferred) {
    await Linking.openURL(navigationUrlFor(preferred, target));
    return;
  }
  const options = navigationOptions(target);
  showAlert('Open route in', undefined, [
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

/** Erro de foto na tela: o gestor precisa saber o que fazer, nao o texto cru do sistema. */
async function escolherFotoDaGaleria(choice: DogPhotoChoice): Promise<string | null> {
  try {
    return await pickDogPhoto(choice);
  } catch (reason) {
    showAlert('Photo not attached', dogPhotoError(reason));
    return null;
  }
}

type DogCardProps = {
  name: string;
  photo: string | null;
  values: DogFormValues;
  /** cao marcado para sair do cadastro (mas ainda pode voltar antes de salvar) */
  removed?: boolean;
  /** cao novo, ainda nao salvo: sai da lista sem aviso */
  isNew?: boolean;
  editable?: boolean;
  onChange: (key: keyof DogFormValues, text: string) => void;
  onPhoto: (uri: string | null) => void;
  onRemove: () => void;
};

function DogCard({ name, photo, values, removed, isNew, editable = true, onChange, onPhoto, onRemove }: DogCardProps) {
  const apelido = name || 'dog';
  const podeEditar = editable && !removed;

  const escolher = () => {
    showAlert(
      photo ? `Change ${apelido}'s photo` : `Add ${apelido}'s photo`,
      'The photo is how the driver recognizes the dog at the door.',
      [
        { text: 'Take photo', onPress: () => void escolherFotoDaGaleria('camera').then((uri) => uri && onPhoto(uri)) },
        { text: 'Choose from library', onPress: () => void escolherFotoDaGaleria('library').then((uri) => uri && onPhoto(uri)) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  return (
    <View style={[styles.dogCard, removed && styles.dogCardRemoved]}>
      <View style={styles.dogHeader}>
        <Text style={styles.dogTitle}>
          {name || 'Dog'}
          {isNew ? '  · NEW' : ''}
          {removed ? ' — will be removed' : ''}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={removed ? `Keep ${name}` : `Remove ${name}`} onPress={onRemove} hitSlop={8} style={styles.dogAction}>
          <Text style={removed ? styles.dogUndo : styles.dogRemove}>{removed ? 'Keep' : isNew ? '✕ Discard' : '✕ Remove'}</Text>
        </Pressable>
      </View>

      {/* Foto: miniatura + botao. Sem foto, um espaco com o icone do cao (nao some a opcao). */}
      <View style={styles.photoRow}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} accessibilityLabel={`Photo of ${apelido}`} />
        ) : (
          <View style={[styles.photo, styles.photoEmpty]}>
            <Text style={styles.photoEmptyIcon}>🐕</Text>
          </View>
        )}
        <View style={styles.photoActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={photo ? `Change photo for ${name}` : `Add photo for ${name}`} onPress={escolher} style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}>
            <Text style={styles.photoButtonText}>{photo ? 'Change photo' : 'Add photo'}</Text>
          </Pressable>
          {photo ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove photo of ${name}`} onPress={() => onPhoto(null)} hitSlop={6}>
              <Text style={styles.photoRemoveText}>Remove photo</Text>
            </Pressable>
          ) : null}
          {photo && isLocalPhoto(photo) ? (
            <Text style={styles.photoHint}>New photo — uploaded when you save the client.</Text>
          ) : null}
        </View>
      </View>

      <Field label="Dog name" value={values.name} onChangeText={(t) => onChange('name', t)} autoCapitalize="words" editable={podeEditar} />
      <Field label="Breed" value={(values.breed ?? '') as string} onChangeText={(t) => onChange('breed', t)} autoCapitalize="words" editable={podeEditar} />
      <Field label="Behavior notes" value={(values.behavior_notes ?? '') as string} onChangeText={(t) => onChange('behavior_notes', t)} multiline editable={podeEditar} />
      <Field label="Medical notes" value={(values.medical_notes ?? '') as string} onChangeText={(t) => onChange('medical_notes', t)} multiline editable={podeEditar} />
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
  const [dogRows, setDogRows] = useState<EditableDog[]>(
    dogs.map((dog) => ({ ...dog, photo_url: dog.photo_url ?? null })),
  );
  const [novoRows, setNovoRows] = useState<NovoDog[]>([]);
  const [novoNome, setNovoNome] = useState('');
  const [removedDogIds, setRemovedDogIds] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(active);
  /** contador de identidade local dos cartoes novos (nao vai para o banco) */
  const proximoNovo = useRef(1);

  const set = (key: keyof ClientFormValues) => (text: string) => setForm((prev) => ({ ...prev, [key]: text }));

  const setDog = (id: string, key: keyof DogFormValues) => (text: string) =>
    setDogRows((prev) => prev.map((dog) => (dog.id === id ? { ...dog, [key]: text } : dog)));
  const setNovo = (key: string, campo: keyof DogFormValues) => (text: string) =>
    setNovoRows((prev) => prev.map((dog) => (dog.key === key ? { ...dog, [campo]: text } : dog)));

  const toggleDogRemoval = (dog: EditableDog) => {
    if (removedDogIds.includes(dog.id)) {
      setRemovedDogIds((prev) => prev.filter((id) => id !== dog.id));
      return;
    }
    showAlert(
      `Remove ${dog.name || 'this dog'}?`,
      dogRemovalMessage(dog.name),
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => setRemovedDogIds((prev) => [...prev, dog.id]) },
      ],
    );
  };

  /**
   * Nomes digitados num campo so ("Luna, Thor") viram CARTOES na lista — assim cada cao
   * novo ja pode receber foto, raca e notas ANTES de salvar (antes o nome ia direto para
   * o banco e a foto so seria possivel abrindo o cliente de novo).
   */
  const adicionarNovos = () => {
    const nomes = splitDogNames(novoNome);
    if (nomes.length === 0) return;
    const jaConhecidos = new Set(
      [...dogRows, ...novoRows].map((dog) => normalizeForSearch(dog.name)).filter((nome) => nome.length > 0),
    );
    const cartoes: NovoDog[] = [];
    for (const nome of nomes) {
      const chave = normalizeForSearch(nome);
      if (jaConhecidos.has(chave)) continue;
      jaConhecidos.add(chave);
      cartoes.push({ key: `novo-${proximoNovo.current++}`, name: nome, breed: '', behavior_notes: '', medical_notes: '', photo_url: null });
    }
    if (cartoes.length > 0) setNovoRows((prev) => [...prev, ...cartoes]);
    setNovoNome('');
  };

  // Nome que veio do contato com o cachorro colado: "Leigh Ann(Mowgli)".
  // O nome errado fica gravado, e a lista mistura pessoa e cao. Aqui o gestor
  // conserta em um toque — sem apagar nada (o nome do cao vira um cartao novo).
  const nameHint = typeof form.name === 'string' ? splitContactName(form.name as unknown as string) : { clientName: '', dogHint: '' };
  const canCleanName = nameHint.dogHint.length > 0 && nameHint.clientName !== (form.name as unknown as string);

  const applyNameHint = () => {
    setForm((prev) => ({ ...prev, name: nameHint.clientName }));
    setNovoNome((prev) => splitDogNames(`${prev}, ${nameHint.dogHint}`).join(', '));
  };

  const phone = form.phone as unknown as string;
  const callUrl = phoneUrl(phone);
  const textUrl = smsUrl(phone, clientMessageTemplate(form.name as unknown as string));
  const hasAddress = directionsTarget(current) !== null;
  const deletePlan = impact ? clientDeletePlan(impact) : null;

  const salvar = () => {
    // O cartao novo e "raso" (só o que o gestor digitou) e perde a identidade local do React.
    const newDogs: DogFormValues[] = novoRows.map((row) => ({
      name: row.name,
      breed: row.breed,
      behavior_notes: row.behavior_notes,
      medical_notes: row.medical_notes,
      photo_url: row.photo_url,
    }));
    onSave({ client: form, instructions: access, dogs: dogRows, newDogs, removedDogIds, active: isActive });
  };

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
          <DogCard
            key={dog.id}
            name={dog.name}
            photo={dog.photo_url}
            values={dog}
            removed={removed}
            editable
            onChange={(key, text) => setDog(dog.id, key)(text)}
            onPhoto={(uri) => setDog(dog.id, 'photo_url')(uri ?? '')}
            onRemove={() => toggleDogRemoval(dog)}
          />
        );
      })}

      {novoRows.map((dog) => (
        <DogCard
          key={dog.key}
          name={dog.name}
          photo={dog.photo_url}
          values={dog}
          isNew
          onChange={(key, text) => setNovo(dog.key, key)(text)}
          onPhoto={(uri) => setNovo(dog.key, 'photo_url')(uri ?? '')}
          onRemove={() => setNovoRows((prev) => prev.filter((item) => item.key !== dog.key))}
        />
      ))}

      <Field
        label="Add dogs (comma separated)"
        value={novoNome}
        onChangeText={setNovoNome}
        autoCapitalize="words"
        onSubmitEditing={adicionarNovos}
        returnKeyType="done"
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Add dogs to the list" onPress={adicionarNovos} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Text style={styles.secondaryText}>Add to the list (photo, breed and notes)</Text>
      </Pressable>
      <Text style={styles.photoHint}>Two dogs? Separate with a comma — then attach each photo above and save.</Text>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.switchLabel}>Active client</Text>
          <Text style={styles.switchHint}>Turn off to keep the history and take the client off the active list.</Text>
        </View>
        <Switch value={isActive} onValueChange={setIsActive} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Save client" disabled={saving || deleting} onPress={salvar} style={({ pressed }) => [styles.save, pressed && styles.pressed, (saving || deleting) && styles.disabled]}>
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
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  photo: { width: 68, height: 68, borderRadius: 14, backgroundColor: colors.sage },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream },
  photoEmptyIcon: { fontSize: 26 },
  photoActions: { flex: 1, gap: 6 },
  photoButton: { backgroundColor: colors.forest700, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, alignItems: 'center' },
  photoButtonText: { color: 'white', fontWeight: '900', fontSize: 12 },
  photoRemoveText: { color: colors.urgency, fontWeight: '800', fontSize: 12 },
  photoHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 6 },
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
