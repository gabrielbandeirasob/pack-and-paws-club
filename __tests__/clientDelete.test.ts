/**
 * Exclusao de cliente e de cao.
 *
 * O que estes testes protegem (foi exatamente o que faltava no app):
 * 1. o aviso dizer o que vai junto (cachorros, reservas, passagem por rota);
 * 2. apagar cliente COM historico exigir o caminho de duas etapas e oferecer a saida
 *    reversivel ("manter historico / inativo");
 * 3. nunca apagar o id de um cao que nao e deste cliente.
 */
import { clientDeletePlan, dogRemovalMessage, dogRemovalPlan, type ClientHistoryCounts } from '@/features/clients/clientsService';

const semHistorico: ClientHistoryCounts = { dogs: 1, reservations: 0, upcomingReservations: 0, routeStops: 0 };
const comHistorico: ClientHistoryCounts = { dogs: 2, reservations: 7, upcomingReservations: 3, routeStops: 12 };

describe('aviso de exclusao do cliente', () => {
  it('cliente sem historico: aviso simples, sem oferecer arquivar', () => {
    const plano = clientDeletePlan(semHistorico);
    expect(plano.hasHistory).toBe(false);
    expect(plano.offerArchive).toBe(false);
    expect(plano.title).toBe('Delete this client?');
    expect(plano.message).toContain('1 dog');
    expect(plano.message).toContain('cannot be undone');
    expect(plano.message).not.toContain('history');
  });

  it('cliente com historico: avisa o que some e oferece manter historico', () => {
    const plano = clientDeletePlan(comHistorico);
    expect(plano.hasHistory).toBe(true);
    expect(plano.offerArchive).toBe(true);
    expect(plano.title).toBe('Delete client with history?');
    expect(plano.message).toContain('2 dogs');
    expect(plano.message).toContain('7 bookings');
    expect(plano.message).toContain('12 route stops');
    expect(plano.message).toContain('3 bookings of them are still to come');
    expect(plano.message).toContain('Keep history (inactive)');
  });

  it('plural e singular certos, e historico tambem conta quando so ha parada de rota', () => {
    const soRota = clientDeletePlan({ dogs: 1, reservations: 0, upcomingReservations: 0, routeStops: 1 });
    expect(soRota.hasHistory).toBe(true);
    expect(soRota.message).toContain('their 1 route stop');
    const duasReservas = clientDeletePlan({ dogs: 0, reservations: 2, upcomingReservations: 1, routeStops: 0 });
    expect(duasReservas.message).toContain('2 bookings');
    expect(duasReservas.message).toContain('1 booking of them is still to come');
  });

  it('cliente vazio (sem cao e sem historico) nao inventa lista', () => {
    const plano = clientDeletePlan({ dogs: 0, reservations: 0, upcomingReservations: 0, routeStops: 0 });
    expect(plano.hasHistory).toBe(false);
    expect(plano.message).toBe('This permanently deletes the client. This cannot be undone.');
  });

  it('numero negativo (contagem que veio errada da API) nao escreve "-1 booking"', () => {
    const plano = clientDeletePlan({ dogs: -3, reservations: -1, upcomingReservations: -5, routeStops: -2 });
    expect(plano.hasHistory).toBe(false);
    expect(plano.message).not.toContain('-');
  });
});

describe('remocao de cao', () => {
  const cachorros = [{ id: 'dog-1' }, { id: 'dog-2' }];

  it('apaga somente ids que pertencem a este cliente', () => {
    expect(dogRemovalPlan(cachorros, ['dog-1', 'dog-de-outro']).idsToDelete).toEqual(['dog-1']);
  });

  it('nao repete id e nao apaga nada quando a lista esta vazia', () => {
    expect(dogRemovalPlan(cachorros, ['dog-2', 'dog-2']).idsToDelete).toEqual(['dog-2']);
    expect(dogRemovalPlan(cachorros, []).idsToDelete).toEqual([]);
  });

  it('a confirmacao cita o nome do cao e o que fica no calendario', () => {
    const texto = dogRemovalMessage('Mowgli');
    expect(texto).toContain('Mowgli');
    expect(texto).toContain('calendar');
    expect(dogRemovalMessage('   ')).toContain('This dog');
  });
});
