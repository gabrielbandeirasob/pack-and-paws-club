/**
 * Seletor de cao com BUSCA e agrupamento por cliente.
 *
 * Motivo: com muitos caes a lista de botoes virava uma parede sem busca. Aqui o campo abre um
 * painel com busca (acha pelo nome do cao OU do dono, ignorando acento) e os caes agrupados
 * por cliente, mostrando quantos estao cadastrados.
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { agruparPorCliente, filtrarCaes, resumoDaBusca } from '@/features/calendar/dogPickerSearch';
import type { DogRef } from '@/features/calendar/dayMath';
import { colors, radii } from '@/features/theme/tokens';

type Props = {
  dogs: DogRef[];
  selected: DogRef | null;
  onSelect: (dog: DogRef) => void;
  /** Texto de apoio quando ha muita coisa (ex.: "8 dogs registered"). */
  hint?: string;
};

export function DogPicker({ dogs, selected, onSelect, hint }: Props) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');

  const encontrados = useMemo(() => filtrarCaes(dogs, termo), [dogs, termo]);
  const grupos = useMemo(() => agruparPorCliente(encontrados), [encontrados]);
  const resumo = useMemo(() => resumoDaBusca(dogs.length, encontrados.length, termo), [dogs.length, encontrados.length, termo]);

  const fechar = () => {
    setAberto(false);
    setTermo('');
  };

  const escolher = (cao: DogRef) => {
    onSelect(cao);
    fechar();
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Select dog"
        onPress={() => setAberto(true)}
        style={[styles.campo, aberto && styles.campoAberto]}
      >
        <Text style={[styles.valor, !selected && styles.placeholder]} numberOfLines={1}>
          {selected ? `${selected.clientName} · ${selected.dogName}` : 'Select dog…'}
        </Text>
        <Text style={styles.seta}>▾</Text>
      </Pressable>
      {hint ? <Text style={styles.dica}>{hint}</Text> : null}

      <Modal visible={aberto} transparent animationType="slide" onRequestClose={fechar}>
        <Pressable accessibilityLabel="Close dog picker" style={styles.fundo} onPress={fechar} />
        <View style={styles.painel}>
          <View style={styles.cabecalho}>
            <Text style={styles.titulo}>Select dog</Text>
            <Text style={styles.resumo}>{resumo}</Text>
          </View>

          <TextInput
            accessibilityLabel="Search dog or client"
            style={styles.busca}
            placeholder="Search dog or client…"
            placeholderTextColor={colors.muted}
            value={termo}
            onChangeText={setTermo}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />

          <ScrollView style={styles.lista} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listaConteudo}>
            {grupos.length === 0 ? (
              <Text style={styles.vazio}>No dogs found for “{termo}”.</Text>
            ) : (
              grupos.map((grupo) => (
                <View key={grupo.cliente}>
                  <Text style={styles.grupo}>{grupo.cliente}</Text>
                  {grupo.caes.map((cao) => {
                    const ativo = selected?.id === cao.id;
                    return (
                      <Pressable
                        key={cao.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Select ${cao.dogName} of ${cao.clientName}`}
                        onPress={() => escolher(cao)}
                        style={[styles.item, ativo && styles.itemAtivo]}
                      >
                        <View style={styles.itemTexto}>
                          <Text style={[styles.itemNome, ativo && styles.itemNomeAtivo]}>{cao.dogName}</Text>
                        </View>
                        {ativo ? <Text style={styles.check}>✓</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>

          <Pressable accessibilityRole="button" accessibilityLabel="Cancel dog selection" onPress={fechar} style={styles.cancelar}>
            <Text style={styles.cancelarTexto}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  campo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, paddingHorizontal: 14, paddingVertical: 13 },
  campoAberto: { borderColor: colors.forest700 },
  valor: { color: colors.ink, fontSize: 14, flexShrink: 1 },
  placeholder: { color: colors.muted },
  seta: { color: colors.muted, fontSize: 14, marginLeft: 8 },
  dica: { color: colors.muted, fontSize: 11, marginTop: 5 },
  fundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  painel: { backgroundColor: colors.cream, borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, paddingTop: 16, paddingHorizontal: 16, maxHeight: '78%' },
  cabecalho: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  titulo: { color: colors.ink, fontFamily: 'serif', fontSize: 20, fontWeight: '800' },
  resumo: { color: colors.muted, fontSize: 12 },
  busca: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, paddingHorizontal: 14, paddingVertical: 11, color: colors.ink, fontSize: 14 },
  lista: { marginTop: 10 },
  listaConteudo: { paddingBottom: 12 },
  vazio: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 26 },
  grupo: { color: colors.forest700, fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', marginTop: 14, marginBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6 },
  itemAtivo: { borderColor: colors.forest700, backgroundColor: '#EEF3EE' },
  itemTexto: { flexShrink: 1 },
  itemNome: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  itemNomeAtivo: { color: colors.forest700 },
  itemCliente: { color: colors.muted, fontSize: 12, marginTop: 2 },
  check: { color: colors.forest700, fontWeight: '900', fontSize: 16, marginLeft: 10 },
  cancelar: { paddingVertical: 14, alignItems: 'center' },
  cancelarTexto: { color: colors.muted, fontWeight: '700' },
});
