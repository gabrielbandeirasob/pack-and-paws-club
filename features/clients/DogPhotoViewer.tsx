/**
 * FOTO DO CÃO AMPLIADA — toque na foto do cartão da lista de clientes e ela abre grande.
 *
 * Pedido do Gabriel (06/10/2026): *"gostaria que o foco fosse o nome do cachorro e que a foto seja maior
 * também e que ao clicar nela ela aumente"*. O gestor reconhece a família pela foto do cão, e no meio da
 * correria a miniatura do cartão não bastava.
 *
 * É só apresentação: nenhuma leitura de rede aqui além da própria imagem (a URL vem do cadastro, a mesma
 * que o cartão já carrega). Fecha tocando em qualquer lugar — não há botão escondido para descobrir.
 */
import { Image, Modal, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

type Props = {
  /** `null` = fechado. A URL é a mesma do cartão (nunca inventamos caminho de foto). */
  photo: { url: string; name: string } | null;
  onClose: () => void;
};

export function DogPhotoViewer({ photo, onClose }: Props) {
  return (
    <Modal visible={photo !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close photo"
        testID="visualizador-de-foto"
        onPress={onClose}
        style={styles.backdrop}
      >
        {photo ? (
          <>
            <Image
              source={{ uri: photo.url }}
              style={styles.photo}
              resizeMode="contain"
              testID="visualizador-de-foto-imagem"
              accessibilityLabel={`Photo of ${photo.name}`}
            />
            <Text style={styles.caption} testID="visualizador-de-foto-nome">
              {photo.name}
            </Text>
            <Text style={styles.hint}>Tap anywhere to close</Text>
          </>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.88)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  photo: { width: '100%', height: '64%', borderRadius: radii.medium, backgroundColor: colors.forest900 },
  caption: { color: 'white', fontFamily: 'serif', fontSize: 22, fontWeight: '800', marginTop: 16 },
  hint: { color: '#D7E1D4', fontSize: 12, marginTop: 6 },
});
