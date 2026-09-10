/**
 * Mapa de VISÃO GERAL das paradas (sem turn-by-turn — a navegação é redirecionada
 * para o Google/Apple Maps). Usa o Google Maps quando a chave do Maps SDK está no
 * build; senão cai no mapa nativo do iOS, para nunca aparecer mapa quebrado.
 */
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';

import { isMapsConfigured } from '@/features/integrations/google/config';
import { colors, radii } from '@/features/theme/tokens';
import { regionForPoints } from './region';

export type MapStop = {
  id: string;
  sequence: number;
  dogName: string;
  address?: string | null;
  status?: string;
  latitude?: number | null;
  longitude?: number | null;
};

type Props = { stops: MapStop[]; height?: number };

export function RouteMap({ stops, height = 210 }: Props) {
  const points = stops
    .filter((stop) => typeof stop.latitude === 'number' && typeof stop.longitude === 'number')
    .sort((a, b) => a.sequence - b.sequence)
    .map((stop) => ({ latitude: stop.latitude as number, longitude: stop.longitude as number, stop }));

  const region = regionForPoints(points.map(({ latitude, longitude }) => ({ latitude, longitude })));

  if (!region) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyTitle}>Mapa indisponível</Text>
        <Text style={styles.emptyText}>
          As paradas ainda não têm coordenadas. Adicione o endereço do cliente (com latitude/longitude) para ver a
          rota no mapa.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <MapView
        provider={isMapsConfigured() ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {points.length > 1 ? (
          <Polyline
            coordinates={points.map(({ latitude, longitude }) => ({ latitude, longitude }))}
            strokeColor={colors.forest700}
            strokeWidth={3}
          />
        ) : null}
        {points.map(({ latitude, longitude, stop }) => (
          <Marker
            key={stop.id}
            coordinate={{ latitude, longitude }}
            title={`${stop.sequence}. ${stop.dogName}`}
            description={stop.address ?? undefined}
            pinColor={stop.status === 'completed' ? colors.muted : colors.forest700}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: radii.large, overflow: 'hidden', backgroundColor: colors.paper },
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
