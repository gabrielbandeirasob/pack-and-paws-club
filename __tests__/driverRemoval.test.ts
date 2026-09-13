/**
 * Remocao de motorista da equipe.
 *
 * O que o teste protege:
 * - o gestor nao pode remover a propria conta (a API tambem recusa: user_id <> auth.uid());
 * - com rota de hoje em diante, o aviso diz o que fica sem motorista e oferece "Disable";
 * - com rotas antigas, o aviso deixa claro que o historico fica mas o nome sai.
 */
import { driverRemovalPlan } from '@/features/drivers/driversService';

describe('remocao de motorista', () => {
  it('recusa remover a propria conta', () => {
    const plano = driverRemovalPlan('Sam Costa', { futureRoutes: 2, pastRoutes: 9, isSelf: true });
    expect(plano.allowed).toBe(false);
    expect(plano.title).toBe('Cannot remove yourself');
    expect(plano.message).toContain('signed in');
  });

  it('motorista com rota futura: avisa e oferece desligar em vez de remover', () => {
    const plano = driverRemovalPlan('Sam Costa', { futureRoutes: 3, pastRoutes: 0, isSelf: false });
    expect(plano.allowed).toBe(true);
    expect(plano.offerDisable).toBe(true);
    expect(plano.confirmLabel).toBe('Remove anyway');
    expect(plano.title).toBe('Remove Sam Costa from the team?');
    expect(plano.message).toContain('3 routes from today on');
    expect(plano.message).toContain('without a driver');
    expect(plano.message).toContain('history');
  });

  it('motorista so com historico: nome deixa de aparecer, historico fica', () => {
    const plano = driverRemovalPlan('Sam Costa', { futureRoutes: 0, pastRoutes: 12, isSelf: false });
    expect(plano.offerDisable).toBe(true);
    expect(plano.confirmLabel).toBe('Remove driver');
    expect(plano.message).toContain('12 past routes stay in the history');
    expect(plano.message).toContain('push notifications');
  });

  it('motorista novo (sem rota nenhuma): aviso curto e definitivo', () => {
    const plano = driverRemovalPlan(null, { futureRoutes: 0, pastRoutes: 0, isSelf: false });
    expect(plano.offerDisable).toBe(false);
    expect(plano.title).toContain('Driver');
    expect(plano.message).toContain('has to be invited again');
  });

  it('singular correto e contagem negativa tratada como zero', () => {
    const uma = driverRemovalPlan('A', { futureRoutes: 1, pastRoutes: 0, isSelf: false });
    expect(uma.message).toContain('1 route from today on');
    const negativa = driverRemovalPlan('A', { futureRoutes: -4, pastRoutes: -2, isSelf: false });
    expect(negativa.offerDisable).toBe(false);
    expect(negativa.message).not.toContain('-');
  });
});
