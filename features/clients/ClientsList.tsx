import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import { filterClients, inactiveCount, sortClientsForList } from '@/features/clients/clientsService';
import { clientMessageTemplate, phoneUrl, smsUrl } from '@/features/clients/contactActions';
import { DogPhotoViewer } from '@/features/clients/DogPhotoViewer';
import type { ClientWithDogs } from '@/features/clients/types';

type Props = {
  clients: ClientWithDogs[];
  loading: boolean;
  onAddClient: () => void;
  onOpenClient: (clientId: string) => void;
  /** puxar para atualizar (opcional: a lista funciona sem isso) */
  refreshing?: boolean;
  onRefresh?: () => void;
};

export function ClientsList({ clients, loading, onAddClient, onOpenClient, refreshing, onRefresh }: Props) {
  const [query, setQuery] = useState('');
  /**
   * Inativos ficam escondidos so quando o gestor pede: cliente arquivado continua sendo
   * dado do negocio (historico, contato), e sumir da tela sem aviso faria parecer que
   * o cadastro foi perdido. Ativos vem primeiro de qualquer forma.
   */
  const [showInactive, setShowInactive] = useState(true);
  /**
   * FOTO AMPLIADA (pedido do Gabriel, 06/10/2026): tocar na foto do cão abre ela grande. Guarda qual
   * foto está aberta (`null` = fechado) — a mesma URL que o cartão já carrega, sem nova leitura de rede.
   */
  const [fotoAmpliada, setFotoAmpliada] = useState<{ url: string; name: string } | null>(null);
  /**
   * MEMOIZAÇÃO (achado da vistoria, 02/10/2026): filtrar e ordenar a lista a CADA render deixava a
   * busca lenta com muitas famílias — cada toque no campo de busca (e cada re-render do pai) refazia
   * a ordenação do array inteiro. Agora só refaz quando o dado de entrada muda.
   */
  const inativos = useMemo(() => inactiveCount(clients), [clients]);
  const ordenados = useMemo(() => sortClientsForList(clients, { showInactive }), [clients, showInactive]);
  const visible = useMemo(() => filterClients(ordenados, query), [ordenados, query]);
  const filtroEscondeTudo = visible.length === 0 && inativos > 0 && !showInactive && query.trim().length === 0;
  /** O cartão de um cliente (o mesmo de antes, agora reaproveitado pela lista virtualizada). */
  const cartaoDoCliente = (client: ClientWithDogs) => {
    // Acoes rapidas do dia a dia: ligar e mandar mensagem direto do card, sem abrir o cadastro.
    // Sem numero valido (ou numero curto demais), o botao nem aparece.
    const callUrl = phoneUrl(client.phone);
    const textUrl = smsUrl(client.phone, clientMessageTemplate(client.name));
    /**
     * O FOCO DO CARTÃO É O CÃO (pedido do Gabriel, 06/10/2026): *"na aba cliente o nome grande que fica
     * em destaque é o nome do dono do cachorro, gostaria que o foco fosse o nome do cachorro e que a foto
     * seja maior também e que ao clicar nela ela aumente, o nome do dono pode aparecer mas de forma menos
     * destacada"*. Então: a foto (maior, tocável) e o nome do cão vêm primeiro; o tutor fica abaixo, menor
     * e em tom discreto. Cliente sem cão cadastrado não inventa destaque: o nome dele mesmo é o título.
     */
    const comFoto = client.dogs.filter((dog) => Boolean(dog.photo_url));
    return (
              <Pressable key={client.id} accessibilityRole="button" accessibilityLabel={`Edit ${client.name}`} onPress={() => onOpenClient(client.id)} style={({ pressed }) => [styles.card, pressed && styles.pressedCard]}>
                  <View style={styles.heroRow}>
                    {comFoto.length > 0 ? (
                      <View style={styles.photoWrap}>
                        {comFoto.map((dog) => (
                          <Pressable
                            key={dog.name}
                            accessibilityRole="imagebutton"
                            accessibilityLabel={`Enlarge photo of ${dog.name}`}
                            testID={`foto-do-cao-${dog.name}`}
                            onPress={() => setFotoAmpliada({ url: dog.photo_url as string, name: dog.name })}
                            style={({ pressed }) => [styles.photoButton, pressed && styles.pressedCard]}
                          >
                            {/* Foto do cao JÁ NA LISTA: e o que o gestor usa para reconhecer a familia
                                sem abrir o cadastro (pedido do Gabriel, 23/09/2026). Sem foto, nada de
                                espaco vazio — o cartão segue só com o nome. */}
                            <Image source={{ uri: dog.photo_url as string }} style={styles.dogPhoto} accessibilityLabel={`Photo of ${dog.name}`} />
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.heroText}>
                      <View style={styles.cardTop}>
                        <View style={styles.dogNamesRow}>
                          {client.dogs.length > 0 ? (
                            client.dogs.map((dog, indice) => (
                              <View key={dog.name} style={styles.dogNameItem}>
                                {indice > 0 ? <Text style={styles.dogNameDot}>·</Text> : null}
                                <Text style={styles.dogName} testID="nome-do-cao">{dog.name}</Text>
                              </View>
                            ))
                          ) : (
                            <Text style={styles.dogName} testID="nome-do-cao">{client.name}</Text>
                          )}
                        </View>
                        {client.active ? <Text style={styles.editHint}>Edit ›</Text> : <Text style={styles.inactiveChip}>INACTIVE</Text>}
                      </View>
                      {/* Tutor: aparece, mas abaixo do cão e em tom discreto. Cliente sem cão já usa o
                          próprio nome como título — aqui não se repete o mesmo nome duas vezes. */}
                      {client.dogs.length > 0 ? (
                        <Text style={styles.ownerName} testID="nome-do-dono">{client.name}</Text>
                      ) : null}
                      <Text style={styles.muted}>{client.phone || 'No phone number'}</Text>
                      <Text style={styles.muted}>{client.address_line_1 ?? ''}{client.address_line_1 && client.city ? ' · ' : ''}{client.city ?? ''}</Text>
                    </View>
                  </View>
                  {callUrl || textUrl ? (
                    <View style={styles.quickRow}>
                      {callUrl ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Call ${client.name}`} onPress={() => void Linking.openURL(callUrl)} style={({ pressed }) => [styles.quickButton, pressed && styles.pressedCard]}>
                          <Text style={styles.quickText}>Call</Text>
                        </Pressable>
                      ) : null}
                      {textUrl ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Text ${client.name}`} onPress={() => void Linking.openURL(textUrl)} style={({ pressed }) => [styles.quickButton, pressed && styles.pressedCard]}>
                          <Text style={styles.quickText}>Text</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>Clients</Text>
        <Text style={styles.subtitle}>Families and dogs under Pack & Paws care.</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Add from Contacts" onPress={onAddClient} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <Text style={styles.addButtonText}>＋ Add from Contacts</Text>
          </Pressable>
          {clients.length > 0 ? (
            <TextInput
              accessibilityLabel="Search clients"
              placeholder="Search name, phone, address or dog…"
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.search}
            />
          ) : null}
          {inativos > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showInactive ? 'Hide inactive clients' : 'Show inactive clients'}
              onPress={() => setShowInactive((atual) => !atual)}
              style={({ pressed }) => [styles.filterChip, pressed && styles.pressedCard]}
            >
              <Text style={styles.filterChipText}>
                {showInactive ? `Hide ${inativos} inactive` : `Show ${inativos} inactive`}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {loading ? (
          <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
        ) : clients.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🐶</Text>
            <Text style={styles.emptyTitle}>No clients yet</Text>
            <Text style={styles.emptyText}>Add your first client from the iPhone contacts.</Text>
          </View>
        ) : (
          /**
           * 🪤 ACHADO DA VISTORIA (02/10/2026): a lista era um `ScrollView` com TODOS os clientes
           * montados de uma vez (cada cartão com foto de cão) — com centenas de famílias a tela fica
           * pesada ao rolar e ao buscar. Agora é `FlatList` (virtualizada: monta só o que aparece).
           */
          <FlatList
            data={visible}
            keyExtractor={(client) => client.id}
            renderItem={({ item: client }) => cartaoDoCliente(client)}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
            refreshControl={
              onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.gold} /> : undefined
            }
            ListEmptyComponent={
              <>
                {visible.length === 0 && !filtroEscondeTudo ? <Text style={styles.noResults}>No clients match “{query}”.</Text> : null}
                {filtroEscondeTudo ? <Text style={styles.noResults}>All clients are inactive — tap “Show {inativos} inactive” to see them.</Text> : null}
              </>
            }
          />
        )}
      </View>
      {/* Fora da lista: o visualizador não pertence a nenhum cartão (sobrevive ao re-render/rolagem). */}
      <DogPhotoViewer photo={fotoAmpliada} onClose={() => setFotoAmpliada(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 34, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  // M5 da auditoria (02/10/2026): legendas do gestor com pelo menos 12 pt.
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 30, fontWeight: '800', marginTop: 6 },
  subtitle: { color: '#D7E1D4', fontSize: 13, marginTop: 6 },
  body: { flex: 1, marginTop: -16, backgroundColor: colors.cream },
  actions: { paddingHorizontal: 18, marginBottom: 6 },
  search: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, color: colors.ink, fontSize: 14, marginTop: 10 },
  noResults: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 24 },
  addButton: { backgroundColor: colors.gold, borderRadius: 14, padding: 14, alignItems: 'center' },
  pressed: { opacity: 0.85 },
  addButtonText: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
  center: { marginTop: 60 },
  empty: { alignItems: 'center', paddingHorizontal: 30, marginTop: 70 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontFamily: 'serif', fontSize: 20, fontWeight: '800', color: colors.forest900, marginTop: 10 },
  emptyText: { color: colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 19, marginTop: 6 },
  list: { padding: 18, paddingTop: 8, paddingBottom: 90 },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 10 },
  pressedCard: { opacity: 0.7 },
  /** Foto (maior, 06/10/2026) e nome do cão na frente; tutor abaixo e discreto. */
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  photoWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: 134 },
  photoButton: { borderRadius: radii.medium },
  dogPhoto: { width: 64, height: 64, borderRadius: radii.medium, backgroundColor: colors.cream },
  heroText: { flex: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  dogNamesRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 5 },
  dogNameItem: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  dogNameDot: { color: colors.muted, fontWeight: '900', fontSize: 15 },
  dogName: { fontFamily: 'serif', fontSize: 19, fontWeight: '800', color: colors.forest900 },
  /** Tutor: mesmo texto de antes, agora secundário (menor e sem o preto forte do título). */
  ownerName: { color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 3 },
  /**
   * 🪤 M4 DA AUDITORIA (02/10/2026): o "Edit ›" era `colors.gold` (C7A75C) sobre o cartão claro —
   * 2,27:1 no papel, abaixo do mínimo de 4,5:1. Passa a `forest700`; o gold fica só como fundo/borda.
   */
  editHint: { color: colors.forest700, fontWeight: '800', fontSize: 12 },
  inactiveChip: { color: colors.muted, fontWeight: '900', fontSize: 12, letterSpacing: 0.8, backgroundColor: colors.sage, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden' },
  muted: { color: colors.muted, fontSize: 12, marginTop: 3 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  // M5 da auditoria (02/10/2026): "Call"/"Text" e o chip de inativos tinham ~29-40 pt; sobem a 44 pt.
  quickButton: { flex: 1, backgroundColor: colors.sage, borderRadius: 11, paddingVertical: 12, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  quickText: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  filterChip: { alignSelf: 'flex-start', backgroundColor: colors.sage, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7, minHeight: 44, justifyContent: 'center', marginTop: 10 },
  filterChipText: { color: colors.forest700, fontWeight: '800', fontSize: 12 },
});
