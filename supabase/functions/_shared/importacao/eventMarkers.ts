// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.
// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha
// se esta cópia ficar desatualizada.
/**
 * MARCAS DOS EVENTOS DO APP no Google Calendar.
 *
 * Por que este módulo existe (05/10/2026): as marcas nasceram junto com o ESPELHO (reserva do app
 * virava evento no calendário do cliente) e viviam em `calendarSync.ts`. O dono pediu para remover a
 * capacidade de escrever no calendário — o espelho foi embora, mas a leitura da marca continua
 * necessária: eventos criados pelo espelho ANTES desta mudança seguem no calendário do escritório e a
 * importação precisa reconhecê-los para não transformá-los em pendência ("not registered in the app")
 * nem em reserva duplicada. Por isso a marca virou este módulo pequeno e neutro, importado pelas duas
 * pontas (`calendarApi`, que lê o evento, e `importPlan`, que decide o que fazer com ele).
 *
 * Nada aqui ESCREVE: são só os nomes das propriedades privadas do evento.
 */

/**
 * Propriedade privada do evento com o id do dono no app.
 *
 * Valor = `<prefixo><uuid>`: `res:<id da reserva>` ou `rec:<id da escala recorrente>` — o prefixo
 * evita que o id de uma reserva colida com o id de uma escala (as duas tabelas geram uuid próprio).
 * `importPlan` usa a presença desta chave para dizer "evento nosso" (`if (evento.appKey) continue`).
 */
export const APP_KEY_PROPERTY = 'appKey';

/**
 * Marca fixa que TODO evento do espelho carregava, além do `appKey`.
 *
 * Existe porque `events.list` só filtra propriedade no formato `nome=valor` — mandar a chave sozinha
 * devolve HTTP 400 "A key or value missing in the extended_properties_match". Como o `appKey` muda a
 * cada reserva, ele não serve para filtrar a listagem: era esta marca constante que separava os nossos
 * eventos dos eventos do dono do calendário.
 *
 * MANTIDA como constante (e não apagada) porque identifica os eventos legados no calendário do
 * cliente: o app não os cria mais, mas reconhece o que já existe.
 */
export const MIRROR_MARKER_PROPERTY = 'packpawsMirror';
export const MIRROR_MARKER_VALUE = 'v1';

/**
 * Evento do Google já lido e normalizado — o que a importação consome.
 *
 * Nasceu em `calendarSync.ts` (o planejador do espelho, removido em 05/10/2026) e mudou de casa junto
 * com as marcas: a importação continua precisando do formato.
 */
export type RemoteEvent = {
  id: string;
  /** Valor de `extendedProperties.private.appKey`, quando existir (= evento que o app criou). */
  appKey?: string | null;
  summary: string;
  startDate: string;
  /**
   * Fim do evento em forma EXCLUSIVA (o primeiro dia FORA do evento), igual ao que o Google usa no
   * evento de dia inteiro — quem monta isto (`parseEvent`, em `calendarApi`) já normaliza o evento com
   * hora para esse formato. A importação recua um dia para virar o fim INCLUSIVO da reserva.
   */
  endDate: string;
  /**
   * `colorId` do evento na paleta fixa do Google (1..11) — é ele que diz o SERVIÇO na importação
   * (verde boarding, azul daycare, vermelho cancelamento: `features/calendar/googleColors`). `null`
   * quando o evento não tem cor marcada.
   */
  colorId?: string | null;
  /**
   * Etiqueta de cor do evento (`eventLabelId`, paleta NOVA do Google). Um evento pintado com a paleta
   * nova NÃO traz `colorId` — a cor (e portanto o serviço) sai do TOM do hex da etiqueta.
   */
  eventLabelId?: string | null;
  recurrence?: string[] | null;
  /**
   * E-mail do ORGANIZADOR do evento (`organizer.email`).
   *
   * Existe por um motivo só (08/10/2026): quando a importação não consegue identificar a agenda
   * escolhida (`calendarIdDaOrigem` falha — token sem o escopo de calendário, rede), a reserva que
   * nascia ficava SEM origem e continuava protegida contra cancelamento automático para sempre (linha
   * "presa", que o vermelho não conseguia tirar). O organizador dos eventos lidos é o último recurso
   * para saber de QUE agenda veio — a regra está em `importService.organizadorDoLote`.
   */
  organizerEmail?: string | null;
};
