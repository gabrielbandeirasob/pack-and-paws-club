/**
 * Payload e roteamento das notificacoes — funcoes PURAS (sem importar o expo-notifications),
 * para poderem ser testadas no jest e reaproveitadas pelas versoes nativa e web.
 *
 * O TEXTO da notificacao e montado no banco (trigger `routes_notify_status`), nao aqui:
 * assim o push sai mesmo que o app do gestor seja fechado logo depois de publicar.
 */

export type PushPlatform = 'ios' | 'android' | 'web'

export type DeviceTokenRow = {
  organization_id: string
  user_id: string
  token: string
  platform: PushPlatform
}

export function pushPlatformFor(os: string): PushPlatform {
  if (os === 'ios') return 'ios'
  if (os === 'android') return 'android'
  return 'web'
}

/** Linha pronta para gravar em `device_tokens`. */
export function buildDeviceTokenRow(input: {
  userId: string
  organizationId: string
  token: string
  os: string
}): DeviceTokenRow {
  return {
    organization_id: input.organizationId,
    user_id: input.userId,
    token: input.token,
    platform: pushPlatformFor(input.os),
  }
}

/**
 * Para onde o app deve ir quando o usuario toca na notificacao.
 * Rota desconhecida -> null (o app apenas abre).
 */
export function routeForNotificationData(data: unknown): string | null {
  const tipo = (data as { type?: unknown } | null | undefined)?.type
  if (tipo === 'route_published' || tipo === 'route_cancelled') return '/(tabs)/driver'
  return null
}

/** O aviso que o motorista recebe (usado para conferir o texto do banco no app). */
export function routeNotificationText(paradas: number): string {
  if (paradas === 1) return '1 parada hoje. Toque para abrir.'
  if (paradas > 1) return `${paradas} paradas hoje. Toque para abrir.`
  return 'Toque para abrir sua rota.'
}
