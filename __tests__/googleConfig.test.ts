import {
  CALENDAR_SCOPES,
  googleIosClientId,
  googleMapsKey,
  googleRedirectScheme,
  isCalendarConfigured,
  isMapsConfigured,
} from '@/features/integrations/google/config';

/**
 * O modulo le `Constants.expoConfig` no momento do import — por isso cada caso
 * recarrega o modulo com o expo-constants mockado (jest.resetModules + doMock).
 */
function loadConfig(expoConfig: unknown) {
  jest.resetModules();
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig } }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/features/integrations/google/config') as typeof import('@/features/integrations/google/config');
}

describe('estado da configuracao do Google no app', () => {
  it('fica tudo desligado quando o build nao tem valores do Google', () => {
    const config = loadConfig(null);
    expect(config.googleIosClientId()).toBeNull();
    expect(config.googleMapsKey()).toBeNull();
    expect(config.googleRedirectScheme()).toBeNull();
    expect(config.isCalendarConfigured()).toBe(false);
    expect(config.isMapsConfigured()).toBe(false);
  });

  it('trata string vazia como nao configurado', () => {
    const config = loadConfig({ extra: { googleIosClientId: '' }, ios: { config: { googleMapsApiKey: '' } } });
    expect(config.googleIosClientId()).toBeNull();
    expect(config.googleMapsKey()).toBeNull();
    expect(config.isCalendarConfigured()).toBe(false);
    expect(config.isMapsConfigured()).toBe(false);
  });

  it('devolve o client id e o esquema invertido do OAuth', () => {
    const config = loadConfig({ extra: { googleIosClientId: '123-abc.apps.googleusercontent.com' } });
    expect(config.googleIosClientId()).toBe('123-abc.apps.googleusercontent.com');
    // O iOS volta para o app pelo client id invertido.
    expect(config.googleRedirectScheme()).toBe('com.googleusercontent.apps.123-abc');
    expect(config.isCalendarConfigured()).toBe(true);
  });

  it('devolve a chave do Maps SDK quando ela existe no build', () => {
    const config = loadConfig({ ios: { config: { googleMapsApiKey: 'AIza-teste' } } });
    expect(config.googleMapsKey()).toBe('AIza-teste');
    expect(config.isMapsConfigured()).toBe(true);
    expect(config.isCalendarConfigured()).toBe(false);
  });

  it('pede eventos E a lista de calendarios (o seletor precisa dela)', () => {
    // `calendar.calendarlist.readonly` entrou em 24/09/2026 com o seletor de calendário: a API
    // `users/me/calendarList` recusa `calendar.events` com HTTP 403 (insufficient scopes), e sem
    // listar calendários o gestor não escolhe o "bot venda" — onde os agendamentos estão.
    const esperado = [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    ];
    expect(loadConfig(null).CALENDAR_SCOPES).toEqual(esperado);
    expect(CALENDAR_SCOPES).toEqual(esperado);
  });
});
