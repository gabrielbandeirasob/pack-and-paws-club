/**
 * Tela de erro amigavel (substitui a ErrorBoundary padrao do expo-router).
 * Em vez de "Something went wrong" cru com pilha na cara do motorista, mostra uma tela da
 * marca, registra o erro automaticamente e oferece "Try again".
 */
import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { reportError } from '@/features/errors/errorReporter';
import { colors } from '@/features/theme/tokens';

type Props = { error: Error; retry: () => Promise<void> };

type State = { enviado: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { enviado: false };

  componentDidMount() {
    reportError(this.props.error, { origem: 'boundary' }).then((ok) => {
      if (ok) this.setState({ enviado: true });
    });
  }

  render(): ReactNode {
    return (
      <View style={styles.container}>
        <Text style={styles.brand}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>The app had a problem and it was reported automatically. Please try again.</Text>
        {this.state.enviado ? <Text style={styles.ok}>Report sent ✓</Text> : null}
        <Pressable accessibilityLabel="Try again" style={styles.button} onPress={() => void this.props.retry()}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.cream },
  brand: { fontSize: 12, letterSpacing: 2, color: colors.forest700, marginBottom: 10, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 8, textAlign: 'center' },
  body: { fontSize: 14, color: colors.ink, opacity: 0.75, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  ok: { fontSize: 13, color: colors.forest700, marginBottom: 14 },
  button: { backgroundColor: colors.forest700, paddingHorizontal: 26, paddingVertical: 12, borderRadius: 999 },
  buttonText: { color: colors.paper, fontWeight: '700' },
});
