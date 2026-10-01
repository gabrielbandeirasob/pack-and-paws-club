import { avisoDeFechamento, paradasPendentes } from '@/features/dispatch/routeClosing';

/**
 * Fechar (completed), despublicar (draft) ou cancelar (cancelled) tira a rota da tela do motorista.
 * Com parada pendente, o gestor tem de ler quantas são e QUAIS cães ficam sem a rota. Incidente de
 * 30/09/2026: rota fechada com as 3 paradas pendentes 1 s depois de publicada. O cancelar entrou na
 * mesma proteção em 01/10/2026 (era o único dos três botões que saía sem perguntar nada).
 */
describe('paradasPendentes', () => {
  it('devolve só o que não terminou: completed e skipped já são resolvidas', () => {
    const stops = [
      { dogName: 'Rex', status: 'pending' },
      { dogName: 'Nina', status: 'arrived' },
      { dogName: 'Bob', status: 'picked_up' },
      { dogName: 'Luna', status: 'completed' },
      { dogName: 'Filó', status: 'skipped' },
    ];
    expect(paradasPendentes(stops).map((parada) => parada.dogName)).toEqual(['Rex', 'Nina', 'Bob']);
  });

  it('rota sem parada pendente devolve lista vazia', () => {
    expect(paradasPendentes([
      { dogName: 'Luna', status: 'completed' },
      { dogName: 'Filó', status: 'skipped' },
    ])).toEqual([]);
  });
});

describe('avisoDeFechamento', () => {
  const pendentes = [
    { dogName: 'Rex', status: 'pending' },
    { dogName: 'Nina', status: 'pending' },
    { dogName: 'Bob', status: 'pending' },
  ];

  it('conta as paradas, nomeia os cães e diz o efeito da ação (fechar)', () => {
    const aviso = avisoDeFechamento('complete', pendentes);
    expect(aviso.title).toBe('Close this route?');
    expect(aviso.message).toContain('3 stops still pending: Rex, Nina, Bob');
    expect(aviso.message).toContain('The driver will no longer see this route on his phone.');
    expect(aviso.confirmLabel).toBe('Close route');
  });

  it('mesmo aviso para despublicar, com o rótulo da ação', () => {
    const aviso = avisoDeFechamento('unpublish', pendentes);
    expect(aviso.title).toBe('Unpublish this route?');
    expect(aviso.message).toContain('3 stops still pending: Rex, Nina, Bob');
    expect(aviso.message).toContain('The driver will no longer see this route on his phone.');
    expect(aviso.confirmLabel).toBe('Unpublish');
  });

  it('mesmo aviso para CANCELAR a rota, com o rótulo da ação', () => {
    const aviso = avisoDeFechamento('cancel', pendentes);
    expect(aviso.title).toBe('Cancel this route?');
    expect(aviso.message).toContain('3 stops still pending: Rex, Nina, Bob');
    expect(aviso.message).toContain('The driver will no longer see this route on his phone.');
    expect(aviso.confirmLabel).toBe('Cancel route');
  });

  it('uma parada pendente fala no singular', () => {
    const aviso = avisoDeFechamento('complete', [{ dogName: 'Rex', status: 'pending' }]);
    expect(aviso.message).toContain('1 stop still pending: Rex');
  });
});
