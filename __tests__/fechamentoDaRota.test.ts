/**
 * ONDE A ROTA FECHA — pedido do CLIENTE (02/10/2026, print encaminhado pelo dono):
 *
 *   *"Outra coisa as rota de pick up não tão acabando no yard. E as de drop off não tão acabando no
 *   local da van. Tem como adicionar isso automaticamente?"*
 *
 * Regra: depois da última BUSCA o dia vai para o YARD (onde os cães ficam); depois da última ENTREGA
 * volta para a VAN. Sem yard cadastrado, o fim da busca cai na van; sem nada cadastrado, não se inventa
 * destino (a tela não mostra fechamento).
 */
import { buscaTerminou, entregaTerminou, fechamentoDaRota } from '@/features/driver/routeClosing';
import { yardDaOrganizacao, type OrganizationLocation } from '@/features/organization/locations';

const van: OrganizationLocation = {
  id: 'van-1', name: 'Van 1', kind: 'van', addressLine1: '3111 La Selva', city: 'San Mateo',
  latitude: 37.5427669, longitude: -122.2849451, radiusMeters: 300, isDefault: true,
};
const yard: OrganizationLocation = {
  id: 'yard-1', name: 'Yard', kind: 'yard', addressLine1: '1089 Memorex Drive', city: 'Santa Clara',
  latitude: 37.362643, longitude: -122.9527423, radiusMeters: 300, isDefault: false,
};

describe('o dia terminou de buscar / de entregar', () => {
  it('busca só termina quando nenhuma parada está pendente ou chegada', () => {
    expect(buscaTerminou([{ status: 'pending' }])).toBe(false);
    expect(buscaTerminou([{ status: 'arrived' }])).toBe(false);
    expect(buscaTerminou([{ status: 'completed' }, { status: 'pending' }])).toBe(false);
    expect(buscaTerminou([{ status: 'completed' }, { status: 'skipped' }])).toBe(true);
    expect(buscaTerminou([])).toBe(false);
  });

  it('entrega só termina quando TODO cão foi entregue (ou pulado)', () => {
    expect(entregaTerminou([{ status: 'completed', deliveredAt: null }])).toBe(false);
    expect(entregaTerminou([{ status: 'completed', deliveredAt: '2026-10-02T21:00:00.000Z' }])).toBe(true);
    expect(entregaTerminou([{ status: 'skipped' }])).toBe(true);
    expect(entregaTerminou([{ status: 'completed', deliveredAt: null }, { status: 'completed', deliveredAt: '2026-10-02T21:00:00.000Z' }])).toBe(false);
  });
});

describe('fechamentoDaRota', () => {
  it('enquanto tem busca pendente, NÃO existe fechamento', () => {
    expect(fechamentoDaRota({ buscaTerminou: false, entregaTerminou: false, yard, van })).toBeNull();
  });

  it('busca terminada: o dia vai para o YARD, com o endereço', () => {
    const fim = fechamentoDaRota({ buscaTerminou: true, entregaTerminou: false, yard, van });
    expect(fim).toEqual({
      kind: 'yard',
      title: 'Back to the yard',
      subtitle: 'All dogs on board — drop them at the yard.',
      address: '1089 Memorex Drive · Santa Clara',
    });
  });

  it('sem yard cadastrado, o fim da busca cai na VAN (nunca fica sem destino)', () => {
    const fim = fechamentoDaRota({ buscaTerminou: true, entregaTerminou: false, yard: null, van });
    expect(fim?.title).toBe('Back to the van');
    expect(fim?.address).toBe('3111 La Selva · San Mateo');
  });

  it('dia entregue: volta para a VAN', () => {
    const fim = fechamentoDaRota({ buscaTerminou: true, entregaTerminou: true, yard, van });
    expect(fim).toEqual({
      kind: 'van',
      title: 'Back to the van',
      subtitle: 'All dogs delivered — the day ends here.',
      address: '3111 La Selva · San Mateo',
    });
  });

  it('sem van cadastrada, o fim do dia usa o yard como ponto final', () => {
    const fim = fechamentoDaRota({ buscaTerminou: true, entregaTerminou: true, yard, van: null });
    expect(fim?.title).toBe('Back to the yard');
  });

  it('sem NENHUMA sede cadastrada, não se inventa destino', () => {
    expect(fechamentoDaRota({ buscaTerminou: true, entregaTerminou: true, yard: null, van: null })).toBeNull();
    expect(fechamentoDaRota({ buscaTerminou: true, entregaTerminou: false, yard: null, van: null })).toBeNull();
  });
});

describe('yardDaOrganizacao', () => {
  it('vale o yard marcado como padrão', () => {
    const outro: OrganizationLocation = { ...yard, id: 'yard-2', name: 'Anexo', isDefault: false };
    expect(yardDaOrganizacao([van, outro, { ...yard, isDefault: true }])?.id).toBe('yard-1');
  });

  it('sem nenhum marcado como padrão, vale o primeiro em ordem de nome', () => {
    const outro: OrganizationLocation = { ...yard, id: 'yard-2', name: 'Anexo', isDefault: false };
    expect(yardDaOrganizacao([van, outro, yard])?.id).toBe('yard-2');
  });

  it('sem yard cadastrado, não há fim de busca para apontar', () => {
    expect(yardDaOrganizacao([van])).toBeNull();
    expect(yardDaOrganizacao([])).toBeNull();
  });
});
