/**
 * AVISO DE ETA AO TUTOR (mensagem pronta no mensageiro do motorista).
 *
 * Pedido do cliente em áudio (16/09/2026): "você clica pra mandar mensagem pro cliente... sem ser
 * pelo Twilio, sem ser um disparo... abre seu messenger pra mandar o ETA".
 *
 * AJUSTE DA OPERAÇÃO (áudios de 25/09/2026): o texto deixou de dizer "about N minutes" e passou a
 * mostrar uma FAIXA de ~30 minutos — "você põe tipo 5 minutos antes de estar na casa do cliente e
 * 25 depois do horário, pra caso a gente tenha algum atraso". Os textos são os que o cliente mandou
 * por escrito (e é a forma exata que ele espera receber no tutor):
 *
 *   pick-up : "Good morning, {CLIENTE}! This is {MOTORISTA} from Pack & Paws Club. I'll be there
 *              between {H1} and {H2} AM to pick up {CAO}. Looking forward to another great day
 *              with them! 🐶🐾"
 *   drop-off: "Good afternoon, {CLIENTE}! This is {MOTORISTA} from Pack & Paws Club 😊 I'll be
 *              dropping off {CAO} between {H1} and {H2} PM. They had a great day with us! 🐶🐾"
 *
 * Regras que os testes travam:
 *  - NADA sai sozinho: o app monta o texto e abre o SMS do APARELHO do motorista, que aperta
 *    enviar. Sem custo, sem registro de operadora (10DLC/A2P) e mais pessoal.
 *  - A janela é [previsão − 5 min, previsão + 25 min], em HORÁRIO DE RELÓGIO ("2:05 and 2:35 PM").
 *    O ETA continua arredondado de 5 em 5: prometer minuto exato queima o motorista na porta.
 *  - O SUFIXO AM/PM sai do lado DOMINANTE da janela (o lado com mais minutos). Janela que cruza o
 *    meio-dia ou a madrugada ganha os dois sufixos ("11:55 AM and 12:25 PM") — nunca "AM/AM".
 *  - DROP-OFF nunca anuncia antes das 14:00 ("nunca antes de 2 nos drop-offs"): se o cálculo cair
 *    antes das 2 da tarde, a faixa começa às 14:00.
 *  - Parada atrasada mantém a frase do atraso ("I'm running about 10 minutes late.") E a faixa.
 *  - O texto é em INGLÊS: quem recebe é o tutor nos EUA.
 *
 * Puro de propósito: texto, faixa, arredondamento e estado do botão têm teste. O "agora" entra por
 * PARÂMETRO (default = relógio do aparelho) justamente para o teste não depender da hora real.
 */

import { digitsForPhone } from '@/features/clients/contactActions';

export type EtaPhase = 'pickup' | 'dropoff';
/**
 * Mensageiro: o app hoje só oferece SMS (o cliente pediu para tirar o WhatsApp da interface —
 * "a gente sempre usa Messenger aqui"), mas o tipo continua aceitando os dois para não quebrar
 * as chamadas que já existem.
 */
export type Messenger = 'sms' | 'whatsapp';

/** Quanto a faixa começa ANTES da previsão ("5 minutos antes de estar na casa do cliente"). */
export const AVISO_ANTES_MIN = 5;
/** Quanto a faixa vai DEPOIS da previsão ("e 25 depois do horário, pra caso a gente tenha algum atraso"). */
export const AVISO_DEPOIS_MIN = 25;
/** Piso do drop-off: 14:00. A janela de entrega nunca é anunciada antes das duas da tarde. */
export const DROPOFF_INICIO_MIN = 14 * 60;
/** Menor faixa aceitável depois da trava das 14:00 (senão sobraria "2:00 and 2:00 PM"). */
const JANELA_MINIMA_MIN = 5;

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

/** Minutos desde a meia-noite (a faixa é somada nessa régua; horaRelogio/sufixo normalizam depois). */
function minutosDoDia(data: Date): number {
  return data.getHours() * 60 + data.getMinutes();
}

/** "2:05" — hora de relógio de 12 horas, SEM sufixo. */
export function horaRelogio(minutos: number): string {
  const normalizado = ((minutos % 1440) + 1440) % 1440;
  const hora24 = Math.floor(normalizado / 60);
  const hora = hora24 % 12 === 0 ? 12 : hora24 % 12;
  return `${hora}:${`${normalizado % 60}`.padStart(2, '0')}`;
}

/** AM até o meio-dia, PM depois (normalizado: horas depois de 1440 já são o dia seguinte). */
export function sufixoDe(minutos: number): 'AM' | 'PM' {
  const normalizado = ((minutos % 1440) + 1440) % 1440;
  return normalizado < 720 ? 'AM' : 'PM';
}

/** Faixa de aviso em minutos desde a meia-noite (pode passar de 1440 quando vira o dia). */
export type AvisoWindow = { inicioMin: number; fimMin: number };

/**
 * A faixa de ~30 min: 5 antes e 25 depois da previsão.
 *
 * No drop-off a faixa nunca começa antes das 14:00 — se o cálculo cair antes, ela começa às 2 da
 * tarde (e termina pelo menos 5 min depois, para não anunciar "2:00 and 2:00 PM").
 */
export function avisoWindow(input: { now: Date; minutes: number; phase: EtaPhase }): AvisoWindow {
  const previsao = minutosDoDia(input.now) + roundToFive(input.minutes);
  let inicioMin = previsao - AVISO_ANTES_MIN;
  if (input.phase === 'dropoff') inicioMin = Math.max(inicioMin, DROPOFF_INICIO_MIN);
  const fimMin = Math.max(previsao + AVISO_DEPOIS_MIN, inicioMin + JANELA_MINIMA_MIN);
  return { inicioMin, fimMin };
}

/**
 * Sufixo do lado DOMINANTE da janela (o lado com mais minutos).
 * É o que decide a saudação e evita que uma janela 11:55–12:25 vire "AM/AM".
 */
export function dominantSuffix(window: AvisoWindow): 'AM' | 'PM' {
  const total = window.fimMin - window.inicioMin;
  let manha = 0;
  for (let i = 0; i <= total; i += 1) if (sufixoDe(window.inicioMin + i) === 'AM') manha += 1;
  const tarde = total + 1 - manha;
  if (manha !== tarde) return manha > tarde ? 'AM' : 'PM';
  // Empate (janela centrada no meio-dia): o lado que carrega o "+25" decide.
  return sufixoDe(window.fimMin);
}

/**
 * Rótulo da faixa como o cliente escreveu: "2:05 and 2:35 PM".
 * Quando a janela cruza o meio-dia/meia-noite cada ponta leva o seu sufixo ("11:55 AM and 12:25 PM").
 */
export function windowLabel(window: AvisoWindow): string {
  const inicio = horaRelogio(window.inicioMin);
  const fim = horaRelogio(window.fimMin);
  const sufixoInicio = sufixoDe(window.inicioMin);
  const sufixoFim = sufixoDe(window.fimMin);
  if (sufixoInicio === sufixoFim) return `${inicio} and ${fim} ${sufixoFim}`;
  return `${inicio} ${sufixoInicio} and ${fim} ${sufixoFim}`;
}

/** Saudação pela hora da janela: de manhã "Good morning", da tarde em diante "Good afternoon". */
export function greetingForWindow(window: AvisoWindow): 'Good morning' | 'Good afternoon' {
  return dominantSuffix(window) === 'AM' ? 'Good morning' : 'Good afternoon';
}

export type EtaMessageInput = {
  clientName?: string | null;
  /** nome do motorista que assina o aviso ("This is {MOTORISTA} from Pack & Paws Club") */
  driverName?: string | null;
  dogName: string;
  phase: EtaPhase;
  /** minutos até a parada (o mesmo que a tela mostra) */
  minutes: number;
  /** minutos de atraso em relação à janela (0 = no prazo) */
  lateMinutes?: number;
  /** hora de referência do cálculo (default = agora). Entra por parâmetro: o teste não usa relógio real. */
  now?: Date;
};

/**
 * Texto pronto (busca ou entrega), sempre com a FAIXA de horário e assinado pelo motorista.
 * Parada atrasada: mesma frase do cliente + "I'm running about N minutes late.".
 */
export function etaMessageText({
  clientName,
  driverName,
  dogName,
  phase,
  minutes,
  lateMinutes = 0,
  now = new Date(),
}: EtaMessageInput): string {
  const nome = (clientName ?? '').trim();
  const cao = dogName.trim() || 'your dog';
  const motorista = (driverName ?? '').trim();

  const faixa = avisoWindow({ now, minutes, phase });
  const horario = windowLabel(faixa);
  const saudacao = greetingForWindow(faixa);
  // Sem o nome do motorista a frase continua correta (nunca "This is  from ...").
  const assinatura = motorista
    ? `This is ${motorista} from Pack & Paws Club`
    : 'This is your driver from Pack & Paws Club';
  const abertura = `${saudacao}${nome.length > 0 ? `, ${nome}` : ''}!`;
  const atraso = lateMinutes > 0 ? ` I'm running ${aboutMinutes(lateMinutes)} late.` : '';

  if (phase === 'pickup') {
    return `${abertura} ${assinatura}.${atraso} I'll be there between ${horario} to pick up ${cao}. Looking forward to another great day with them! 🐶🐾`;
  }
  return `${abertura} ${assinatura} 😊${atraso} I'll be dropping off ${cao} between ${horario}. They had a great day with us! 🐶🐾`;
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
