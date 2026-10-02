/**
 * AVISO DE ETA AO TUTOR (mensagem pronta no mensageiro do motorista).
 *
 * Pedido do cliente em áudio (16/09/2026): "você clica pra mandar mensagem pro cliente... sem ser
 * pelo Twilio, sem ser um disparo... abre seu messenger pra mandar o ETA".
 *
 * AJUSTE DA OPERAÇÃO (áudios de 25/09/2026): o texto deixou de dizer "about N minutes" e passou a
 * mostrar uma FAIXA de ~30 minutos — "você põe tipo 5 minutos antes de estar na casa do cliente e
 * 25 depois do horário, pra caso a gente tenha algum atraso".
 *
 * MODELO EXATO DO DONO (02/10/2026) — é a forma que o tutor recebe, copiada palavra por palavra
 * (a saudação numa linha, o resto na linha de baixo; a janela com "–"):
 *
 *   pick-up : "Good morning, {CLIENTE}! This is {MOTORISTA} from Pack & Paws Club." + <nova linha> +
 *              "I'll be there between {H1} –{H2} AM to pick up {CAO}. Looking forward to another"
 *              " great day with them! 🐶🐾"
 *   drop-off: "Good afternoon, {CLIENTE}! This is {MOTORISTA} from Pack & Paws Club 😊" + <nova linha> +
 *              "I'll be dropping off {CAO} between {H1} –{H2} PM. They had a great day with us! 🐶🐾"
 *
 * Regras que os testes travam:
 *  - NADA sai sozinho: o app monta o texto e abre o SMS do APARELHO do motorista, que aperta
 *    enviar. Sem custo, sem registro de operadora (10DLC/A2P) e mais pessoal.
 *  - A janela é [previsão − 5 min, previsão + 25 min], em HORÁRIO DE RELÓGIO ("2:05 –2:35 PM").
 *    O ETA continua arredondado de 5 em 5: prometer minuto exato queima o motorista na porta.
 *  - O SUFIXO AM/PM sai do lado DOMINANTE da janela (o lado com mais minutos). Janela que cruza o
 *    meio-dia ou a madrugada ganha os dois sufixos ("11:55 AM –12:25 PM") — nunca "AM/AM".
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


/** Quanto a faixa começa ANTES da previsão ("5 minutos antes de estar na casa do cliente"). */
export const AVISO_ANTES_MIN = 5;
/** Quanto a faixa vai DEPOIS da previsão ("e 25 depois do horário, pra caso a gente tenha algum atraso"). */
export const AVISO_DEPOIS_MIN = 25;
/** Piso do drop-off: 14:00. A janela de entrega nunca é anunciada antes das duas da tarde. */
export const DROPOFF_INICIO_MIN = 14 * 60;
/** Menor faixa aceitável depois da trava das 14:00 (senão sobraria "2:00 –2:00 PM"). */
const JANELA_MINIMA_MIN = 5;

/** Fase da parada pelo status: já embarcado → entrega; o resto → busca. */
export function phaseForStop(status: string): EtaPhase {
  return status === 'picked_up' || status === 'completed' ? 'dropoff' : 'pickup';
}

/**
 * Todos os números que recebem o aviso, na ordem: o do cadastro primeiro, o do segundo dono depois.
 * Vazio/inválido é descartado (o cadastro pode ter só um dos dois) e repetido não entra duas vezes.
 */
export function recipientsFor(...phones: Array<string | null | undefined>): string[] {
  const unicos = new Set<string>();
  for (const bruto of phones) {
    const digits = digitsForPhone(bruto);
    if (digits) unicos.add(digits);
  }
  return [...unicos];
}

/**
 * Nomes que entram na saudação. Com dois tutores, "Sarah and Mike": a mensagem sai numa conversa só
 * (pedido do dono, 27/09/2026), então a saudação cumprimenta os dois.
 */
export function nomesDoAviso(clientName?: string | null, secondOwnerName?: string | null): string {
  const primeiro = (clientName ?? '').trim();
  const segundo = (secondOwnerName ?? '').trim();
  if (primeiro && segundo) return `${primeiro} and ${segundo}`;
  return primeiro || segundo;
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
 * tarde (e termina pelo menos 5 min depois, para não anunciar "2:00 –2:00 PM").
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
 * Rótulo da faixa como o dono escreveu (02/10/2026): "2:05 –2:35 PM" (espaço, travessão, sem espaço).
 * Quando a janela cruza o meio-dia/meia-noite cada ponta leva o seu sufixo ("11:55 AM –12:25 PM").
 */
export function windowLabel(window: AvisoWindow): string {
  const inicio = horaRelogio(window.inicioMin);
  const fim = horaRelogio(window.fimMin);
  const sufixoInicio = sufixoDe(window.inicioMin);
  const sufixoFim = sufixoDe(window.fimMin);
  if (sufixoInicio === sufixoFim) return `${inicio} –${fim} ${sufixoFim}`;
  return `${inicio} ${sufixoInicio} –${fim} ${sufixoFim}`;
}

/** Saudação pela hora da janela: de manhã "Good morning", da tarde em diante "Good afternoon". */
export function greetingForWindow(window: AvisoWindow): 'Good morning' | 'Good afternoon' {
  return dominantSuffix(window) === 'AM' ? 'Good morning' : 'Good afternoon';
}

export type EtaMessageInput = {
  clientName?: string | null;
  /**
   * Segundo tutor (pai/mãe do mesmo cão) — áudio de 27/09/2026: "existe cachorro que tem pai e mãe…
   * os pais têm a exigência de receber mensagem nos dois números". Com os dois nomes, a saudação
   * cumprimenta os dois ("Good morning, Sarah and Mike!") porque a mensagem vai em UMA conversa.
   */
  secondOwnerName?: string | null;
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
  secondOwnerName,
  driverName,
  dogName,
  phase,
  minutes,
  lateMinutes = 0,
  now = new Date(),
}: EtaMessageInput): string {
  const nome = nomesDoAviso(clientName, secondOwnerName);
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
  // A 1ª linha é EXATAMENTE a do dono (saudação + assinatura); o atraso, quando existe, abre a 2ª
  // linha. Sem atraso o `atraso` é vazio e a 2ª linha sai literal ao modelo.
  const atraso = lateMinutes > 0 ? `I'm running ${aboutMinutes(lateMinutes)} late. ` : '';

  if (phase === 'pickup') {
    return `${abertura} ${assinatura}.\n${atraso}I'll be there between ${horario} to pick up ${cao}. Looking forward to another great day with them! 🐶🐾`;
  }
  return `${abertura} ${assinatura} 😊\n${atraso}I'll be dropping off ${cao} between ${horario}. They had a great day with us! 🐶🐾`;
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
export function smsLink(
  phones: Array<string | null | undefined> | string | null | undefined,
  text: string,
): string | null {
  const lista = Array.isArray(phones) ? recipientsFor(...phones) : recipientsFor(phones);
  if (lista.length === 0) return null;
  // Vários números SEPARADOS POR VÍRGULA abrem UMA conversa em grupo no iOS (é o pedido do dono:
  // "não de forma separada, mas num grupo"). Com um número só, o link é o de sempre.
  return `sms:${lista.join(',')}&body=${encodeURIComponent(text)}`;
}

/**
 * Link do aviso: SEMPRE SMS — o dono mandou tirar o outro mensageiro 100% do projeto (28/09/2026).
 * Fica uma função só aqui para as telas não precisarem saber do esquema de URL.
 */
export function linkForChoice(phones: Array<string | null | undefined> | string | null | undefined, text: string): string | null {
  return smsLink(phones, text);
}

/** Nome antigo da mesma função (as telas chamavam assim). */
export const messengerLink = linkForChoice;

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
