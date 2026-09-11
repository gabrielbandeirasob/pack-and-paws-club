/**
 * Versao WEB do mapa (Metro escolhe este arquivo quando a plataforma e web).
 *
 * react-native-maps nao existe no navegador: importar a biblioteca derrubava a tela
 * inteira do motorista ("codegenNativeComponent is not a function") — e o erro acontecia
 * no import, antes de qualquer verificacao dentro do componente. Por isso a web tem um
 * arquivo proprio, sem essa dependencia.
 *
 * No iPhone o mapa funciona normalmente (RouteMap.tsx).
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

import type { MapStop } from './mapStop';

export type { MapStop };

type Props = { stops: MapStop[]; height?: number };

export function RouteMap({ stops, height = 210 }: Props) {
  const points = stops.filter((stop) => typeof stop.latitude === 'number' && typeof stop.longitude === 'number');

  return (
    <View style={[styles.empty, { height }]}>
      <Text style={styles.emptyTitle}>
        {points.length > 0 ? `${points.length} stops on this route` : 'No stops yet'}
      </Text>
      <Text style={styles.emptyText}>
        The map is shown in the app on the phone. Use Navigate to open Google Maps or Apple Maps.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 18,
    borderRadius: radii.large,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  emptyTitle: { fontWeight: '800', color: colors.ink },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: 'center' },
});
