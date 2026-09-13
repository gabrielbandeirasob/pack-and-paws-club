/**
 * Acoes rapidas do cliente: ligar, mandar mensagem e abrir o endereco no mapa.
 *
 * Regra do telefone: o numero vem do contato do iPhone em formatos sujos
 * ("+1 (415) 555-1234", "415.555.1234"), e o iOS so disca direito com o numero limpo.
 * Numero curto demais (ramal, campo vazio, "1234") NAO vira link: e melhor nao mostrar
 * o botao do que abrir o discador em numero errado na frente do cliente.
 *
 * Regra do endereco: o motorista pode navegar com endereco em texto OU com coordenada
 * (mesma regra do features/maps/links.ts). Cliente sem endereco nenhum nao gera botao.
 */
import type { NavTarget } from '@/features/maps/links';

/** Abaixo disso nao e telefone: e ramal, codigo ou lixo de cadastro. */
export const MIN_PHONE_DIGITS = 7;

/** Numero limpo, preservando o "+" quando existe (discagem internacional). */
export function digitsForPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (trimmed.length === 0) return null;
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return plus ? `+${digits}` : digits;
}

/** Link de ligacao (null = nao mostrar o botao). */
export function phoneUrl(phone: string | null | undefined): string | null {
  const digits = digitsForPhone(phone);
  return digits ? `tel:${digits}` : null;
}

/**
 * Link de mensagem. No iOS o "&body=" e aceito pela URL do sms; sem corpo, sai so o numero.
 */
export function smsUrl(phone: string | null | undefined, body?: string): string | null {
  const digits = digitsForPhone(phone);
  if (!digits) return null;
  const text = (body ?? '').trim();
  return text.length > 0 ? `sms:${digits}&body=${encodeURIComponent(text)}` : `sms:${digits}`;
}

export type ClientAddressFields = {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

/** Endereco em uma linha, sem virgulas sobrando ("100 Market St, Apt 3, San Francisco, CA 94103"). */
export function addressLine(client: ClientAddressFields): string | null {
  const street = [client.address_line_1, client.address_line_2]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(', ');
  const cityState = [[client.city, client.state].map((p) => (p ?? '').trim()).filter(Boolean).join(', '), (client.postal_code ?? '').trim()]
    .filter((part) => part.length > 0)
    .join(' ');
  const line = [street, cityState].filter((part) => part.length > 0).join(', ');
  return line.length > 0 ? line : null;
}

/**
 * Alvo de navegacao do cliente: coordenada quando existe, senao o endereco em texto.
 * Sem coordenada e sem endereco nao ha alvo (null) — o botao de rota nao aparece.
 */
export function directionsTarget(client: ClientAddressFields): NavTarget | null {
  const hasCoords = typeof client.latitude === 'number' && typeof client.longitude === 'number';
  const address = addressLine(client);
  if (!hasCoords && !address) return null;
  return { address, latitude: client.latitude ?? null, longitude: client.longitude ?? null };
}

/** Texto padrao da mensagem para o cliente (usado no botao de SMS). */
export function clientMessageTemplate(clientName: string): string {
  const name = clientName.trim();
  return name.length > 0 ? `Hi ${name}! ` : '';
}
