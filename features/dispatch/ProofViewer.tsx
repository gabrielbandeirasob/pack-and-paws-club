import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

/**
 * Comprovante de entrega visto pelo escritório.
 *
 * O bucket é privado (migration 020), então a imagem não tem URL pública: pedimos um link
 * assinado e temporário na hora de abrir. Sem isso, a foto ficaria exposta a quem tivesse o
 * caminho - e caminho de arquivo não é controle de acesso.
 *
 * Cada parada cuida do próprio estado (o componente é renderizado dentro da lista), então
 * nenhum hook fica dentro de laço.
 */

const SIGNED_URL_SECONDS = 300;

type Props = {
  pickupPath?: string | null;
  dropoffPath?: string | null;
};

export function StopProofChips({ pickupPath, dropoffPath }: Props) {
  const [aberto, setAberto] = useState<{ path: string; titulo: string } | null>(null);

  const temAlgum = Boolean(pickupPath || dropoffPath);
  if (!temAlgum) return null;

  return (
    <>
      <View style={styles.chips}>
        {pickupPath ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View pickup proof photo"
            onPress={() => setAberto({ path: pickupPath, titulo: 'Pickup proof' })}
            style={[styles.chip, styles.chipGold]}
          >
            <Text style={styles.chipText}>📷 Pickup</Text>
          </Pressable>
        ) : null}
        {dropoffPath ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View drop-off proof photo"
            onPress={() => setAberto({ path: dropoffPath, titulo: 'Drop-off proof' })}
            style={[styles.chip, styles.chipForest]}
          >
            <Text style={styles.chipText}>📷 Drop-off</Text>
          </Pressable>
        ) : null}
      </View>
      <ProofViewer
        path={aberto?.path ?? null}
        titulo={aberto?.titulo ?? ''}
        onClose={() => setAberto(null)}
      />
    </>
  );
}

function ProofViewer({ path, titulo, onClose }: { path: string | null; titulo: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (alvo: string) => {
    setErro(null);
    setUrl(null);
    const { data, error } = await supabase.storage.from('stop-proofs').createSignedUrl(alvo, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      setErro(error?.message ?? 'Could not open the proof photo.');
      return;
    }
    setUrl(data.signedUrl);
  }, []);

  useEffect(() => {
    if (path) void carregar(path);
  }, [path, carregar]);

  return (
    <Modal visible={Boolean(path)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.titulo}>{titulo}</Text>
          <View style={styles.imagemBox}>
            {erro ? (
              <Text style={styles.erro}>{erro}</Text>
            ) : url ? (
              <Image source={{ uri: url }} style={styles.imagem} resizeMode="contain" />
            ) : (
              <ActivityIndicator color={colors.gold} />
            )}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close proof photo" onPress={onClose} style={styles.fechar}>
            <Text style={styles.fecharText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.small, borderWidth: 1 },
  chipGold: { borderColor: colors.gold },
  chipForest: { borderColor: colors.forest500 },
  chipText: { fontSize: 11, fontWeight: '700', color: colors.ink },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 420, backgroundColor: colors.cream, borderRadius: radii.large, padding: 14, gap: 10 },
  titulo: { fontWeight: '900', fontSize: 16, color: colors.ink },
  imagemBox: { minHeight: 260, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000010', borderRadius: radii.medium },
  imagem: { width: '100%', height: 320 },
  erro: { color: colors.urgency, padding: 16, textAlign: 'center' },
  fechar: { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.small, backgroundColor: colors.forest500 },
  fecharText: { color: colors.cream, fontWeight: '800' },
});
