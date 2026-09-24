/**
 * VETORES INDEPENDENTES DO AGENTE DE TESTES (perfil agente2) — 24/09/2026.
 *
 * Escritos por mim, sem reaproveitar os casos do autor da mudança: aqui eu testo o que o GABRIEL pediu
 * ("quando clicar para sincronizar puxe TODOS os agendamentos do google calendar do cliente pro cliente")
 * e o que ele decidiu depois (criar cliente+cão; janela só de HOJE para frente).
 *
 * Cada teste falha se a regra de negócio for revertida por acidente — é a minha guarda de regressão,
 * separada da suíte do autor.
 */
import {
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
} from '@/features/integrations/google/importPlan';
import type { RemoteEvent } from '@/features/integrations/google/calendarSync';

const HOJE = '2026-09-24';
const JANELA = { from: HOJE, to: '2027-03-23' };

function evento(id: string, summary: string, startDate: string, extra: Partial<RemoteEvent> = {}): RemoteEvent {
  return { id, summary, startDate, endDate: startDate, appKey: null, ...extra };
}

const SEM_CAES: DogForImport[] = [];
const KONA: DogForImport = { id: 'dog-kona', name: 'Kona', clientName: 'Leigh Ann', clientId: 'cli-leigh' };
const SEM_RESERVAS: BookingForImport[] = [];

function reservaLigada(over: Partial<BookingForImport> = {}): BookingForImport {
  return {
    id: 'res-1',
    kind: 'reservation',
    dogId: 'dog-kona',
    googleEventId: 'ev-kona',
    source: 'google',
    serviceType: 'daycare',
    startDate: '2026-09-30',
    endDate: '2026-09-30',
    weekdays: null,
    // A regra de cancelamento exige reserva viva: 'confirmed' (reserva) — o planner compara como texto.
    status: 'confirmed',
    ...over,
  };
}

describe('PEDIDO DO DONO: Sync traz TODOS os agendamentos e cadastra o que falta', () => {
  it('cão que NÃO existe no app entra criando cliente + cão (com o nome do título)', () => {
    const plano = planCalendarImport([evento('ev-bella', 'Bella', '2026-09-30')], SEM_CAES, SEM_RESERVAS, JANELA);

    expect(plano).toHaveLength(1);
    const item = plano[0];
    expect(item.kind).toBe('create');
    // `dogId: null` é o que discrimina "criar cão novo" da variante com cão existente.
    if (item.kind !== 'create' || item.dogId !== null) throw new Error('esperava create com cadastro novo');
    expect(item.newDog.name).toBe('Bella');
    // Sem tutor no título, o cliente nasce com o MESMO nome (placeholder para o gestor renomear).
    expect(item.newDog.clientName).toBe('Bella');
    expect(item.parsed.startDate).toBe('2026-09-30');
  });

  it('título com dois nomes ("Leigh Ann · Kona") usa tutor e cão; cão existente NÃO é recadastrado', () => {
    const plano = planCalendarImport([evento('ev-2', 'Leigh Ann · Kona', '2026-09-30')], [KONA], SEM_RESERVAS, JANELA);

    expect(plano).toHaveLength(1);
    const item = plano[0];
    expect(item.kind).toBe('create');
    if (item.kind !== 'create') throw new Error('esperava create');
    // casa com o cão que já existe -> usa o id, não cria cadastro novo
    expect(item.dogId).toBe('dog-kona');
    expect('newDog' in item).toBe(false);
  });

  it('título vazio NÃO cria cadastro sem nome (não pode nascer cliente/cão em branco)', () => {
    const plano = planCalendarImport([evento('ev-vazio', '   ', '2026-09-30')], SEM_CAES, SEM_RESERVAS, JANELA);

    for (const item of plano) {
      if (item.kind === 'create' && 'newDog' in item) {
        expect(item.newDog.name.trim()).toBeTruthy();
      }
    }
    expect(plano.filter((i) => i.kind === 'create')).toHaveLength(0);
  });

  it('segundo Sync do MESMO evento não cria de novo (vínculo é por evento, não por nome)', () => {
    const eventos = [evento('ev-kona', 'Kona daycare', '2026-09-30')];
    // o que o primeiro Sync deixou no banco: reserva ligada ao evento do Google
    const plano = planCalendarImport(eventos, [KONA], [reservaLigada()], JANELA);

    expect(plano.filter((i) => i.kind === 'create')).toHaveLength(0);
  });

  it('evento do PASSADO não gera nada: nem reserva, nem pendência', () => {
    const plano = planCalendarImport([evento('ev-ontem', 'Bella', '2026-09-23')], SEM_CAES, SEM_RESERVAS, JANELA);

    expect(plano).toHaveLength(0);
  });

  it('NADA DO PASSADO: reserva ligada ao Google com data de ontem que sumiu da consulta NÃO é cancelada', () => {
    const reservaDeOntem = reservaLigada({ id: 'res-ontem', googleEventId: 'ev-ontem-gone', startDate: '2026-09-23', endDate: '2026-09-23' });
    // o evento não veio na consulta (a janela começa hoje) -> o planejador não pode tratar como "apagado"
    const plano = planCalendarImport([], [KONA], [reservaDeOntem], JANELA);

    expect(plano.filter((i) => i.kind === 'cancel')).toHaveLength(0);
  });

  it('mantém o comportamento antigo que NÃO foi revogado: evento futuro apagado no Google cancela a reserva', () => {
    const reservaFutura = reservaLigada({ id: 'res-futura', googleEventId: 'ev-sumiu', startDate: '2026-10-05', endDate: '2026-10-05' });
    const plano = planCalendarImport([], [KONA], [reservaFutura], JANELA);

    expect(plano).toHaveLength(1);
    expect(plano[0].kind).toBe('cancel');
  });

  it('evento que é o NOSSO espelho (appKey) é ignorado pela importação', () => {
    const plano = planCalendarImport([evento('ev-mirror', 'Bella', '2026-09-30', { appKey: 'res-abc' })], SEM_CAES, SEM_RESERVAS, JANELA);

    expect(plano).toHaveLength(0);
  });

  it('evento futuro com o mesmo cão de uma reserva JÁ ligada a ele atualiza, não duplica', () => {
    const plano = planCalendarImport([evento('ev-kona', 'Kona daycare', '2026-10-01')], [KONA], [reservaLigada()], JANELA);

    expect(plano.filter((i) => i.kind === 'create')).toHaveLength(0);
    const atualizacoes = plano.filter((i) => i.kind === 'update');
    for (const item of atualizacoes) {
      expect(item.parsed.startDate).toBe('2026-10-01');
    }
  });
});
