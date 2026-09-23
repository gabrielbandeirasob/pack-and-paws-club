/**
 * AVISO DE ETA AO TUTOR (mensagem pronta no mensageiro do motorista).
 *
 * Pedido do cliente em áudio (16/09/2026): "você clica pra mandar mensagem pro cliente... sem ser
 * pelo Twilio, sem ser um disparo... abre seu messenger pra mandar o ETA".
 *
 * Decisões (especificação 1.1 aprovada):
 *  - NADA sai sozinho: o app monta o texto e abre o SMS/WhatsApp do APARELHO do motorista, que
 *    aperta enviar. Sem custo, sem registro de operadora (10DLC/A2P) e mais pessoal.
 *  - O texto é em INGLÊS: quem recebe é o tutor nos EUA.
 *  - O ETA é arredondado de 5 em 5 minutos e dito como "about" — o cálculo não tem precisão de
 *    minuto, e prometer exatidão que não existe queima o motorista na porta do cliente.
 *  - Parada atrasada: a frase já menciona o atraso e o botão fica âmbar.
 *
 * Puro de propósito: texto, arredondamento e estado do botão têm teste.
 */

import { digitsForPhone } from '@/features/clients/contactActions';

export type EtaPhase = 'pickup' | 'dropoff';
export type Messenger = 'sms' | 'whatsapp';

/** Fase da parada pelo status: já embarcado → entrega; o resto → busca. */
export function phaseForStop(status: string): EtaPhase {
  return status === 'picked_up' || status === 'completed' ? 'dropoff' : 'pickup';
}

/** Arredonda de 5 em 5 minutos, nunca abaixo de 5 (nada de "about 0 minutes"). */
export function roundToFive(minutes: number): number {
  if (!Number.isFinite(minutes)) return 5;
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/** "about 15 minutes". */
export function aboutMinutes(minutes: number): string {
  return `about ${roundToFive(minutes)} minutes`;
}

export type EtaMessageInput = {
  clientName?: string | null;
  dogName: string;
  phase: EtaPhase;
  /** minutos até a parada (o mesmo que a tela mostra) */
  minutes: number;
  /** minutos de atraso em relação à janela (0 = no prazo) */
  lateMinutes?: number;
};

/**
 * Texto pronto. Três formas: busca, entrega e atraso (a frase muda, não é só um número).
 */
export function etaMessageText({ clientName, dogName, phase, minutes, lateMinutes = 0 }: EtaMessageInput): string {
  const nome = (clientName ?? '').trim();
  const saudacao = nome.length > 0 ? `Hi ${nome}!` : 'Hi!';
  const cao = dogName.trim() || 'your dog';
  const acao = phase === 'pickup' ? 'pick up' : 'drop off';

  if (lateMinutes > 0) {
    return `${saudacao} I'm running about ${roundToFive(lateMinutes)} minutes late to ${acao} ${cao}.`;
  }
  return `${saudacao} I'm on my way to ${acao} ${cao} — ${aboutMinutes(minutes)} away.`;
}

export type NotifyState = {
  /** false = não dá para avisar (cliente sem telefone utilizável) */
  enabled: boolean;
  label: string;
  /** late = parada atrasada (o botão fica âmbar na tela) */
  tone: 'normal' | 'late' | 'disabled';
  hint: string | null;
};

/** Estado do botão "Avisar tutor" para uma parada. */
export function notifyButtonState(input: { phone: string | null | undefined; lateMinutes?: number; done?: boolean }): NotifyState {
  const late = (input.lateMinutes ?? 0) > 0;
  if (!digitsForPhone(input.phone)) {
    return {
      enabled: false,
      label: 'Notify owner',
      tone: 'disabled',
      hint: 'No phone number on this client — add it in the client card to send the ETA.',
    };
  }
  if (input.done) {
    return { enabled: false, label: 'Notify owner', tone: 'disabled', hint: null };
  }
  return {
    enabled: true,
    label: late ? 'Notify owner · running late' : 'Notify owner',
    tone: late ? 'late' : 'normal',
    hint: null,
  };
}

/** Link do SMS com o texto pronto (o mesmo padrão do lado do gestor). */
export function smsLink(phone: string | null | undefined, text: string): string | null {
  const digits = digitsForPhone(phone);
  if (!digits) return null;
  return `sms:${digits}&body=${encodeURIComponent(text)}`;
}

/** Link do WhatsApp (wa.me) com o texto pronto. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const digits = digitsForPhone(phone);
  if (!digits) return null;
  return `https://wa.me/${digits.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

/** Link do mensageiro escolhido (null = número inválido). */
export function messengerLink(messenger: Messenger, phone: string | null | undefined, text: string): string | null {
  return messenger === 'whatsapp' ? whatsappLink(phone, text) : smsLink(phone, text);
}

/** O que gravar no histórico da parada (a fase do aviso). */
export function noticeKind(phase: EtaPhase): 'pickup' | 'dropoff' {
  return phase;
}

/** Frase que o motorista entende quando o registro do aviso falha. */
export function etaNoticeError(reason: unknown): string {
  const mensagem = reason instanceof Error ? reason.message : String(reason ?? '');
  if (/network|fetch|timeout|internet/i.test(mensagem)) return 'No connection: the notice will be recorded when you are back online.';
  if (/parada n|not found|P0002/i.test(mensagem)) return 'This stop is no longer available on the route.';
  return mensagem || 'Could not record the notice.';
}
