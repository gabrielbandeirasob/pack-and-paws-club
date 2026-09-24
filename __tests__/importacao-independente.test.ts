/**
 * VETORES INDEPENDENTES DO AGENTE DE TESTES (perfil agente2) — build 55, 24/09/2026.
 *
 * A REGRA NOVA do dono INVERTE o cadastro automático dos builds 52-54, então estes vetores também
 * foram invertidos (o arquivo antigo travava "cão desconhecido -> cria cliente + cão"; agora trava
 * "cão desconhecido -> NÃO importa e aparece na lista"). O que continua valendo de antes fica: janela
 * começando HOJE, vínculo por EVENTO (idempotência) e o espelho ignorado pela importação.
 *
 * Escrito por mim, do pedido do dono:
 *  - o título traz SÓ o nome do cão;
 *  - o app só importa cão JÁ cadastrado (nome normalizado);
 *  - o SERVIÇO vem da COR (verde boarding, azul daycare, vermelho cancelamento);
 *  - sem cor / cor fora do mapa -> lista "color not recognized";
 *  - cão não cadastrado -> lista "not registered in the app".
 */
import {
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const HOJE = '2026-09-24';
const JANELA = { from: HOJE, to: '2027-03-23' };

const VERDE = '2';
const AZUL = '7';
const VERMELHO = '11';

function evento(id: string, summary: string, startDate: string, extra: Partial<RemoteEvent> = {}): RemoteEvent {
  return { id, summary, startDate, endDate: startDate, appKey: null, colorId: AZUL, ...extra };
}

const SEM_CAES: DogForImport[] = [];
const SEM_RESERVAS: BookingForImport[] = [];
const PIETRO: DogForImport = { id: 'dog-pietro', name: 'Pietro', clientName: 'Carlos' };

function reservaLigada(over: Partial<BookingForImport> = {}): BookingForImport {
  return {
    id: 'res-1',
    kind: 'reservation',
    dogId: 'dog-pietro',
    googleEventId: 'ev-pietro',
    source: 'google',
    serviceType: 'daycare',
    startDate: '2026-09-30',
    endDate: '2026-09-30',
    weekdays: null,
    skipDates: null,
    // Regra de cancelamento exige reserva viva: 'confirmed' — o planejador compara como texto.
    status: 'confirmed',
    ...over,
  };
}

describe('REGRA NOVA: o serviço vem da COR e o cão tem de estar cadastrado', () => {
  it('título "Pietro" com cor VERDE e cão cadastrado -> reserva de BOARDING', () => {
    const plano = planCalendarImport([evento('ev-pietro', 'Pietro', '2026-09-30', { colorId: VERDE })], [PIETRO], SEM_RESERVAS, JANELA);

    expect(plano).toHaveLength(1);
    expect(plano[0]).toMatchObject({ kind: 'create', eventId: 'ev-pietro', dogId: 'dog-pietro' });
    if (plano[0].kind !== 'create') throw new Error('esperava create');
    expect(plano[0].parsed.serviceType).toBe('boarding');
  });

  it('o MESMO evento com cor AZUL -> reserva de DAYCARE (o título não decide nada)', () => {
    const plano = planCalendarImport([evento('ev-pietro', 'Pietro', '2026-09-30', { colorId: AZUL })], [PIETRO], SEM_RESERVAS, JANELA);

    if (plano[0].kind !== 'create') throw new Error('esperava create');
    expect(plano[0].parsed.serviceType).toBe('daycare');
  });

  it('cor VERMELHA -> cancela a reserva daquele cão NAQUELE dia', () => {
    const existentes = [reservaLigada({ id: 'res-cancelar', googleEventId: null, source: 'app', startDate: '2026-09-30', endDate: '2026-09-30' })];
    const plano = planCalendarImport([evento('ev-red', 'Pietro', '2026-09-30', { colorId: VERMELHO })], [PIETRO], existentes, JANELA);

    expect(plano).toEqual([{ kind: 'cancel', eventId: 'ev-red', bookingKind: 'reservation', bookingId: 'res-cancelar' }]);
  });

  it('cão DESCONHECIDO não é importado e aparece na lista (a regra 52-54 foi REVOGADA)', () => {
    const plano = planCalendarImport([evento('ev-zeus', 'Zeus', '2026-09-30', { colorId: VERDE })], [PIETRO], SEM_RESERVAS, JANELA);

    expect(plano).toHaveLength(1);
    expect(plano[0].kind).toBe('review');
    if (plano[0].kind !== 'review') throw new Error('esperava review');
    expect(plano[0].reason).toBe('unknown dog');
    // Nada de cadastro automático — o que o dono revogou.
    expect(JSON.stringify(plano)).not.toContain('newDog');
  });

  it('evento SEM cor não é importado: "color not recognized" (não se chuta serviço)', () => {
    const plano = planCalendarImport([evento('ev-sem-cor', 'Pietro', '2026-09-30', { colorId: null })], [PIETRO], SEM_RESERVAS, JANELA);

    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unrecognized color' });
  });

  it('mantém o comportamento antigo que NÃO foi revogado: evento futuro apagado no Google cancela a reserva', () => {
    const reservaFutura = reservaLigada({ id: 'res-futura', googleEventId: 'ev-sumiu', startDate: '2026-10-05', endDate: '2026-10-05' });
    const plano = planCalendarImport([], [PIETRO], [reservaFutura], JANELA);

    expect(plano).toHaveLength(1);
    expect(plano[0].kind).toBe('cancel');
  });

  it('NADA DO PASSADO: evento de ontem não gera reserva nem pendência', () => {
    const plano = planCalendarImport([evento('ev-ontem', 'Pietro', '2026-09-23', { colorId: VERDE })], [PIETRO], SEM_RESERVAS, JANELA);
    expect(plano).toHaveLength(0);
  });

  it('evento que é o NOSSO espelho (appKey) é ignorado pela importação', () => {
    const plano = planCalendarImport([evento('ev-mirror', 'Pietro', '2026-09-30', { appKey: 'res-abc', colorId: VERDE })], [PIETRO], SEM_RESERVAS, JANELA);
    expect(plano).toHaveLength(0);
  });

  it('idempotência: o segundo Sync do mesmo evento não cria nada', () => {
    const eventos = [evento('ev-pietro', 'Pietro', '2026-09-30', { colorId: AZUL })];
    const plano = planCalendarImport(eventos, [PIETRO], [reservaLigada()], JANELA);
    expect(plano.filter((item) => item.kind === 'create')).toHaveLength(0);
  });

  it('sem cor E cão desconhecido: a cor vem primeiro (pintar o evento é o primeiro passo)', () => {
    const plano = planCalendarImport([evento('ev-nada', 'Zeus', '2026-09-30', { colorId: null })], SEM_CAES, SEM_RESERVAS, JANELA);
    expect(plano[0]).toMatchObject({ kind: 'review', reason: 'unrecognized color' });
  });
});
