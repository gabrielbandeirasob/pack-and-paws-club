import { useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import { dogPhotoKey, splitDogNames, type ExistingContactClient } from '@/features/clients/clientsService';
import { dogPhotoError, pickDogPhoto, type DogPhotoChoice } from '@/features/dogs/dogPhoto';
import type { NewClientInput } from '@/features/clients/types';

type Props = {
  initial: NewClientInput;
  /**
   * Preenchido quando esse contato JA e cliente no sistema: o cachorro digitado aqui entra
   * no cadastro existente (o banco nao permite dois clientes para o mesmo contato).
   */
  existingClient?: ExistingContactClient | null;
  /**
   * Dica de nome de cachorro ja lida do contato ("Leigh Ann(Mowgli)" -> "Mowgli").
   * Entra preenchida e o usuario pode editar antes de salvar.
   */
  initialDogNames?: string;
  /**
   * Aviso de possivel duplicado: outro cadastro com o mesmo nome de cliente ou o mesmo
   * nome de cao ja existe. Nao bloqueia (pode ser coincidencia), mas evita a familia
   * partida em dois cadastros — que e o pior caso para a rota.
   */
  duplicateHint?: string | null;
  /**
   * `dogPhotos` leva a foto escolhida por nome de cao (chave = dogPhotoKey). O cao ainda nao
   * existe no banco neste passo, entao a foto viaja pelo nome e sobe depois do insert.
   */
  onSave: (payload: { client: NewClientInput; dogs: string[]; dogPhotos: Record<string, string> }) => Promise<void>;
  onCancel: () => void;
};

export function AddClientReview({ initial, existingClient = null, initialDogNames = '', duplicateHint = null, onSave, onCancel }: Props) {
  const [dogNames, setDogNames] = useState(initialDogNames);
  const [dogPhotos, setDogPhotos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addressLine = [initial.address_line_1, initial.city].filter(Boolean).join(' · ');
  const nomes = splitDogNames(dogNames);

  const escolherFoto = (nome: string, atual: string | null) => {
    const escolher = async (choice: DogPhotoChoice) => {
      try {
        const uri = await pickDogPhoto(choice);
        if (uri) setDogPhotos((prev) => ({ ...prev, [dogPhotoKey(nome)]: uri }));
      } catch (reason) {
        Alert.alert('Photo not attached', dogPhotoError(reason));
      }
    };
    Alert.alert(
      atual ? `Change ${nome}'s photo` : `Add ${nome}'s photo`,
      'The photo is how the driver recognizes the dog at the door.',
      [
        { text: 'Take photo', onPress: () => void escolher('camera') },
        { text: 'Choose from library', onPress: () => void escolher('library') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const submit = async () => {
    // Cachorro e opcional: da para cadastrar o cliente agora e cadastrar os caes
    // depois na ficha do cliente.
    const dogs = nomes;
    setSaving(true);
    setError(null);
    try {
      await onSave({ client: initial, dogs, dogPhotos });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save the client.');
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>ADD FROM CONTACTS</Text>
        <Text style={styles.title}>Review client</Text>
        <View style={styles.card}>
          <Text style={styles.clientName}>{initial.name}</Text>
          <Text style={styles.muted}>{initial.phone || 'No phone number'}</Text>
          {addressLine ? <Text style={styles.muted}>{addressLine}</Text> : null}
          {initial.pickup_access_instructions ? (
            <View style={styles.instructions}>
              <Text style={styles.instructionsLabel}>PICKUP / ACCESS INSTRUCTIONS</Text>
              <Text style={styles.instructionsText}>{initial.pickup_access_instructions}</Text>
            </View>
          ) : null}
          {existingClient ? (
            <View style={styles.existing}>
              <Text style={styles.existingLabel}>ALREADY A CLIENT</Text>
              <Text style={styles.existingText}>
                {existingClient.name} is already registered
                {existingClient.dogs.length > 0 ? ` (dogs: ${existingClient.dogs.join(', ')})` : ''}. The name you type below is
                added to that existing record — no duplicate client is created.
              </Text>
            </View>
          ) : null}
          {duplicateHint && !existingClient ? (
            <View style={styles.duplicate}>
              <Text style={styles.duplicateLabel}>CHECK BEFORE ADDING</Text>
              <Text style={styles.duplicateText}>{duplicateHint}</Text>
            </View>
          ) : null}
          <Text style={styles.label}>Dog name</Text>
          <TextInput
            accessibilityLabel="Dog name"
            autoCapitalize="words"
            returnKeyType="done"
            value={dogNames}
            onChangeText={setDogNames}
            style={styles.input}
            placeholder="e.g. Bob"
          />
          <Text style={styles.hint}>
            Optional — you can add the dog later in the client card. Two dogs now? Separate the names with a comma — e.g. Mowgli, Kona.
          </Text>
          {nomes.length > 0 ? (
            <View style={styles.photos}>
              <Text style={styles.label}>Dog photo (the driver sees it on the route)</Text>
              {nomes.map((nome) => {
                const foto = dogPhotos[dogPhotoKey(nome)] ?? null;
                return (
                  <View key={nome} style={styles.dogRow}>
                    {foto ? (
                      <Image source={{ uri: foto }} style={styles.dogPhoto} accessibilityLabel={`Photo of ${nome}`} />
                    ) : (
                      <View style={[styles.dogPhoto, styles.dogPhotoEmpty]}>
                        <Text style={styles.dogPhotoIcon}>🐕</Text>
                      </View>
                    )}
                    <View style={styles.dogRowText}>
                      <Text style={styles.dogRowName}>{nome}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={foto ? `Change photo for ${nome}` : `Add photo for ${nome}`}
                        onPress={() => escolherFoto(nome, foto)}
                      >
                        <Text style={styles.dogPhotoAction}>{foto ? 'Change photo' : 'Add photo'}</Text>
                      </Pressable>
                      {foto ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove photo of ${nome}`}
                          onPress={() => setDogPhotos((prev) => {
                            const copia = { ...prev };
                            delete copia[dogPhotoKey(nome)];
                            return copia;
                          })}
                        >
                          <Text style={styles.dogPhotoRemove}>Remove photo</Text>
                        </Pressable>
                      ) : null}
                      {foto ? <Text style={styles.photoHint}>New photo — uploaded when you save the client.</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={existingClient ? 'Add to existing client' : 'Add as client'}
            disabled={saving}
            onPress={submit}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            {saving ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.primaryText}>{existingClient ? 'Add to existing client' : 'Add as client'}</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving} onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 22, backgroundColor: colors.cream, flexGrow: 1 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginTop: 12 },
  title: { fontFamily: 'serif', fontSize: 30, fontWeight: '800', color: colors.forest900, marginTop: 8, marginBottom: 18 },
  card: { backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, padding: 20 },
  clientName: { fontFamily: 'serif', fontSize: 22, fontWeight: '800', color: colors.forest900 },
  muted: { color: colors.muted, fontSize: 13, marginTop: 4 },
  instructions: { backgroundColor: '#FBF6E8', borderRadius: 12, borderWidth: 1, borderColor: '#EADFB8', padding: 12, marginTop: 14 },
  instructionsLabel: { color: '#8A6D1F', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  instructionsText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  existing: { backgroundColor: '#EDF3EC', borderRadius: 12, borderWidth: 1, borderColor: '#CFE0CC', padding: 12, marginTop: 14 },
  existingLabel: { color: colors.forest700, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  existingText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  duplicate: { backgroundColor: '#FBF6E8', borderRadius: 12, borderWidth: 1, borderColor: '#EADFB8', padding: 12, marginTop: 14 },
  duplicateLabel: { color: '#8A6D1F', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  duplicateText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  label: { color: colors.ink, fontWeight: '800', fontSize: 12, marginTop: 18, marginBottom: 7 },
  input: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink, fontSize: 15 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 7, lineHeight: 17 },
  photos: { marginTop: 4 },
  dogRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F4F2EA', borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 10, marginTop: 9 },
  dogPhoto: { width: 58, height: 58, borderRadius: 12, backgroundColor: colors.sage },
  dogPhotoEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  dogPhotoIcon: { fontSize: 22 },
  dogRowText: { flex: 1, gap: 4 },
  dogRowName: { color: colors.forest900, fontWeight: '800', fontSize: 14 },
  dogPhotoAction: { color: colors.forest700, fontWeight: '900', fontSize: 12 },
  dogPhotoRemove: { color: colors.urgency, fontWeight: '800', fontSize: 12 },
  photoHint: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  error: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 12 },
  primary: { backgroundColor: colors.gold, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  pressed: { opacity: 0.85 },
  primaryText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  cancel: { alignItems: 'center', padding: 12, marginTop: 6 },
  cancelText: { color: colors.muted, fontWeight: '800' },
});
