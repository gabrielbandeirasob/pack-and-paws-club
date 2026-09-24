/**
 * PROVA (camada 1, código real): roda o PARSER/PLANEJADOR de verdade do app — `parseEvent` (recurso
 * cru da API do Google) → `planCalendarImport` — para os eventos do bug 56 (etiquetas de cor da
 * paleta nova) e imprime, em JSON, o que ele decide. O script de banco
 * (`prova-etiquetas-de-cor.py`) consome este JSON: assim o `service_type` gravado no banco é o que o
 * MESMO código do app decidiu, e não uma cópia da regra escrita à mão no SQL.
 *
 * Uso: node --import ./scripts/alias-register.mjs scripts/prova-plano-etiquetas.mjs
 */
import { parseEvent } from '../features/integrations/google/calendarApi.ts';
import { planCalendarImport } from '../features/integrations/google/importPlan.ts';

const HOJE = '2026-09-25';
const JANELA = { from: HOJE, to: '2027-03-24' };

/** Etiquetas do calendário do escritório, como a API devolve (`labelProperties.eventLabels`). */
const ETIQUETAS = [
  { id: 'lab-azul', name: 'Cobalto', backgroundColor: '#4A86E8' },
  { id: 'lab-verde', name: 'Verde', backgroundColor: '#33b679' },
  { id: 'lab-vermelho', name: 'Vermelho', backgroundColor: '#e67c73' },
  { id: 'lab-amarelo', name: 'Amarelo', backgroundColor: '#ffd666' },
];

const CAES = [
  { id: 'aac0053c-16f9-4d53-93b0-b10f8ff258a7', name: 'Soko', clientName: 'Ana' },
  { id: '5ba7119a-d60a-46c1-8d33-6d4a4236619c', name: 'Mowgli', clientName: 'Maria' },
  { id: '33f0eb22-ad7e-4be8-b371-7c3a437cca5a', name: 'Kona', clientName: 'Joao' },
];

/** O evento `zara` do cliente: pintado com a etiqueta "Cobalto" (paleta nova, SEM `colorId`). */
const EVENTOS = [
  { id: 'ev-lab-azul', summary: 'Soko', eventLabelId: 'lab-azul', start: { date: '2026-09-26' }, end: { date: '2026-09-27' } },
  { id: 'ev-lab-verde', summary: 'Mowgli', eventLabelId: 'lab-verde', start: { date: '2026-09-26' }, end: { date: '2026-09-27' } },
  { id: 'ev-lab-vermelho', summary: 'Kona', eventLabelId: 'lab-vermelho', start: { date: '2026-09-30' }, end: { date: '2026-10-01' } },
  { id: 'ev-lab-amarelo', summary: 'Soko', eventLabelId: 'lab-amarelo', start: { date: '2026-09-26' }, end: { date: '2026-09-27' } },
];

/** Série da Kona (quarta): o evento vermelho pula o dia sem desativar a escala. */
const SERIE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const RESERVAS = [
  {
    id: 'res-kona-serie',
    kind: 'recurring',
    dogId: '33f0eb22-ad7e-4be8-b371-7c3a437cca5a',
    googleEventId: null,
    source: 'app',
    serviceType: 'daycare',
    startDate: '2026-09-01',
    endDate: null,
    weekdays: [0, 3],
    skipDates: [],
    status: 'active',
    dbId: SERIE_ID,
  },
];

const eventos = EVENTOS.map((recurso) => parseEvent(recurso));
const plano = planCalendarImport(eventos, CAES, RESERVAS, JANELA, { labels: ETIQUETAS });

const saida = plano.map((item) => {
  const cao = CAES.find((dog) => dog.id === (item.dogId ?? ''))?.name ?? null;
  const leitura = item.parsed?.color ?? null;
  return {
    acao: item.kind,
    evento: item.eventId,
    cao,
    service_type: item.parsed?.serviceType ?? null,
    cancela: item.parsed?.cancels ?? item.kind === 'cancel',
    cor_lida: leitura
      ? {
          etiqueta: leitura.labelName,
          hex: leitura.backgroundColor,
          colorId: leitura.colorId,
        }
      : null,
    motivo: item.reason ?? null,
    serie: item.kind === 'skip' ? item.scheduleId : null,
    dia: item.kind === 'skip' ? item.date : null,
  };
});

console.log(JSON.stringify({ hoje: HOJE, plano: saida }, null, 2));
