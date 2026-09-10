/**
 * Mock do react-native-maps para os testes (módulo nativo não existe no ambiente de teste).
 * O jest usa este arquivo automaticamente para o pacote `react-native-maps`.
 */
import { View } from 'react-native';

export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = undefined;

export function MapView({ children, ...props }: { children?: React.ReactNode }) {
  return <View {...props}>{children}</View>;
}

export function Marker({ children }: { children?: React.ReactNode }) {
  return <View>{children}</View>;
}

export function Polyline() {
  return null;
}

export default MapView;
