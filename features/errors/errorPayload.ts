/**
 * Monta o relatorio de erro que vai para a tabela `client_errors` — funcoes PURAS e testadas.
 *
 * REGRA DE PRIVACIDADE: nada de dado de cliente nem codigo de portao. Chaves com nome
 * sensivel (token, senha, secret, gate/access code) sao DESCARTADAS antes de gravar.
 */

export type ErrorReport = {
  organization_id: string | null
  user_id: string | null
  app_version: string | null
  platform: string
  message: string
  stack: string | null
  context: Record<string, unknown>
}

export const MAX_MESSAGE = 500
export const MAX_STACK = 4000

const CHAVES_PROIBIDAS = /token|senha|password|secret|gate|portao|access.?code|instrucao|instructions/i

export function normalizeErrorMessage(input: unknown): string {
  let texto = ''
  if (typeof input === 'string') texto = input
  else if (input instanceof Error) texto = input.message
  else if (input && typeof input === 'object' && 'message' in input) texto = String((input as { message: unknown }).message ?? '')
  else if (input != null) texto = String(input)

  const limpo = texto.trim() || 'erro sem mensagem'
  return limpo.length > MAX_MESSAGE ? `${limpo.slice(0, MAX_MESSAGE)}…` : limpo
}

export function normalizeErrorStack(input: unknown): string | null {
  const bruto = input instanceof Error ? input.stack : typeof input === 'string' ? input : null
  if (!bruto) return null
  return bruto.length > MAX_STACK ? `${bruto.slice(0, MAX_STACK)}\n…(truncado)` : bruto
}

/** Tira do contexto qualquer chave sensivel ou valor gigante. */
export function sanitizeContext(context: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!context) return {}
  const saida: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(context)) {
    if (CHAVES_PROIBIDAS.test(chave)) continue
    if (valor === undefined) continue
    if (typeof valor === 'string' && valor.length > 200) {
      saida[chave] = `${valor.slice(0, 200)}…`
      continue
    }
    saida[chave] = valor
  }
  return saida
}

export function buildErrorReport(input: {
  error: unknown
  context?: Record<string, unknown> | null
  userId?: string | null
  organizationId?: string | null
  appVersion?: string | null
  platform: string
}): ErrorReport {
  return {
    organization_id: input.organizationId ?? null,
    user_id: input.userId ?? null,
    app_version: input.appVersion ?? null,
    platform: input.platform,
    message: normalizeErrorMessage(input.error),
    stack: normalizeErrorStack(input.error),
    context: sanitizeContext(input.context),
  }
}
