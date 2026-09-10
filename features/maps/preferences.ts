/**
 * Preferência do motorista no aparelho: qual app de mapa abrir na navegação.
 * Guardada localmente (AsyncStorage) — escolheu uma vez, não pergunta de novo.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseNavApp, type NavApp } from './navigation';

const KEY = 'packpaws.nav.app.v1';

export async function loadPreferredNavApp(): Promise<NavApp | null> {
  try {
    return parseNavApp(await AsyncStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export async function savePreferredNavApp(app: NavApp): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, app);
  } catch {
    // Preferência é conveniência: se o storage falhar, só pergunta de novo na próxima vez.
  }
}

export async function clearPreferredNavApp(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // idem
  }
}
