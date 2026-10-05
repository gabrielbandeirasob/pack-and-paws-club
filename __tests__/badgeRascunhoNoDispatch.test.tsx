/**
 * BADGE "DRAFT — O MOTORISTA AINDA NÃO VÊ" no cartão do motorista (dono, 01/10/2026).
 *
 * O motorista só lê rota `published`. Rascunho com paradas prontas parece publicada no quadro, e o
 * gestor espera o motorista sair com o carro sem nada ter chegado ao celular dele. O aviso fica na
 * linha de status do próprio cartão; `completed`/`cancelled` NÃO avisam (sair da tela do motorista
 * foi exatamente o que o gestor pediu ao tocar no botão).
 */
import { render } from '@testing-library/react-native';

import { DispatchBoard } from '@/features/dispatch/DispatchBoard';

// O quadro importa o cliente do Supabase (via ProofViewer) e exigiria a config pública no ambiente
// de teste — aqui nada de rede: o mock só deixa o módulo carregar.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(), rpc: jest.fn(), storage: { from: jest.fn() },
    channel: () => ({ on: () => ({ subscribe: () => {} }) }), removeChannel: jest.fn(),
  },
}));

const AVISO = 'Not visible to driver yet';

function paradas() {
  return [{
    dogId: 'sam', dogName: 'Sam', clientName: 'Jose', sequence: 1, status: 'pending' as const,
    priority: 'normal' as const, windowStart: null, windowEnd: null, exactTime: null,
    latitude: null, longitude: null,
  }];
}

function props(status: 'draft' | 'published' | 'completed' | 'cancelled') {
  return {
    date: '2026-10-01',
    drivers: [{ id: 'motorista', name: 'Rafael' }],
    dayItems: [{ dogId: 'sam', clientName: 'Jose', dogName: 'Sam' }],
    routes: [{ routeId: 'rota', driverId: 'motorista', status, stops: paradas() }],
    driverLocations: {},
    onAssign: jest.fn(),
    onSaveStop: jest.fn(),
    onRemoveStop: jest.fn(),
    onMoveStop: jest.fn(),
    onOptimize: jest.fn(),
    onPublish: jest.fn(),
    onUnpublish: jest.fn(),
    onCancelRoute: jest.fn(),
    onCompleteRoute: jest.fn(),
    onDateChange: jest.fn(),
  } as React.ComponentProps<typeof DispatchBoard>;
}

describe('aviso de rascunho no cartão do motorista', () => {
  it('rascunho mostra o aviso (e continua mostrando o rótulo Draft)', async () => {
    const tela = await render(<DispatchBoard {...props('draft')} />);
    expect(tela.getByTestId('driver-draft-badge')).toBeTruthy();
    expect(tela.getByText(AVISO)).toBeTruthy();
    // Redesenho (item 5/14): o status virou BADGE e a contagem é uma peça própria.
    expect(tela.getByText('1 stop')).toBeTruthy();
    expect(tela.getByText('Draft')).toBeTruthy();
  });

  it('publicada não mostra o aviso: o motorista está vendo a rota', async () => {
    const tela = await render(<DispatchBoard {...props('published')} />);
    expect(tela.queryByTestId('driver-draft-badge')).toBeNull();
    expect(tela.queryByText(AVISO)).toBeNull();
  });

  it('concluída e cancelada também não avisam (o motorista sair da rota era o esperado)', async () => {
    const concluida = await render(<DispatchBoard {...props('completed')} />);
    expect(concluida.queryByTestId('driver-draft-badge')).toBeNull();
    const cancelada = await render(<DispatchBoard {...props('cancelled')} />);
    expect(cancelada.queryByTestId('driver-draft-badge')).toBeNull();
  });

  it('motorista sem rota no dia não ganha aviso nenhum', async () => {
    const semRota = { ...props('draft'), routes: [] };
    const tela = await render(<DispatchBoard {...semRota} />);
    expect(tela.queryByTestId('driver-draft-badge')).toBeNull();
  });
});
