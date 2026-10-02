import { minutosDaOrdem } from '@/features/dispatch/routeOptimizer';
import { origemDaEntregaDaRota, yardDaOrganizacao, type OrganizationLocation } from '@/features/organization/locations';

/**
 * DE ONDE A ENTREGA PARTE — cliente (02/10/2026): *"Posição do driver inicia rota dos drop offs"*; e o
 * dono no áudio: *"ele otimiza a rota pra onde tá a van (...) o bagulho do yard tem que ser diferente"*.
 *
 * A 1ª perna da ENTREGA parte do YARD da organização (é de lá que a matilha sai), NUNCA da van. A van é
 * onde o dia COMEÇA (pick-up) e onde ele FECHA (ver `fechamentoDaRota`). Sem yard cadastrado, o app não
 * inventa origem — a 1ª perna simplesmente não entra na conta, em vez de "cair na van" por engano.
 */
const van: OrganizationLocation = {
  id: 'van-1', name: 'Van 1', kind: 'van', addressLine1: '3111 La Selva', city: 'San Mateo',
  latitude: 37.5427669, longitude: -122.2849451, radiusMeters: 300, isDefault: true,
};
const yard: OrganizationLocation = {
  id: 'yard-1', name: 'Yard', kind: 'yard', addressLine1: '1089 Memorex Drive', city: 'Santa Clara',
  latitude: 37.362643, longitude: -122.9527423, radiusMeters: 300, isDefault: false,
};

describe('origemDaEntregaDaRota — a entrega parte do YARD, nunca da van', () => {
  it('com o yard, devolve as coordenadas DO YARD', () => {
    expect(origemDaEntregaDaRota(yard)).toEqual({ latitude: yard.latitude, longitude: yard.longitude });
  });

  it('a van NUNCA é origem da entrega', () => {
    expect(origemDaEntregaDaRota(van)).toBeNull();
  });

  it('sem yard cadastrado devolve null (não se inventa origem — e não cai na van)', () => {
    expect(origemDaEntregaDaRota(null)).toBeNull();
    expect(origemDaEntregaDaRota(undefined)).toBeNull();
  });

  it('com a organização inteira (van + yard), a origem é o yard escolhido por yardDaOrganizacao', () => {
    const escolhido = yardDaOrganizacao([van, yard]);
    expect(origemDaEntregaDaRota(escolhido)).toEqual({ latitude: 37.362643, longitude: -122.9527423 });
    // ...e é diferente da van (o dono reclamou justamente de a conta partir "pra onde tá a van").
    expect(origemDaEntregaDaRota(escolhido)).not.toEqual({ latitude: van.latitude, longitude: van.longitude });
  });

  it('mesmo com o YARD marcado como padrão, a origem continua sendo as coordenadas do yard', () => {
    expect(origemDaEntregaDaRota({ ...yard, isDefault: true })).toEqual({ latitude: yard.latitude, longitude: yard.longitude });
  });
});

describe('a 1ª perna da ENTREGA conta do yard (integração com o otimizador)', () => {
  // Um yard PERTO das paradas (como no dia real: os cães saem do yard e voltam para perto).
  const yardPerto = { latitude: 37.37, longitude: -121.95 };
  const ordem = ['perto do yard', 'longe do yard'];
  const stops = [
    { dogId: 'perto do yard', clientName: 'A', dogName: 'A', latitude: 37.37, longitude: -121.96, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const },
    { dogId: 'longe do yard', clientName: 'B', dogName: 'B', latitude: 37.50, longitude: -122.20, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const },
  ];
  const opcoes = { homeLatitude: van.latitude, homeLongitude: van.longitude, serviceMinutes: 0 };

  it('partindo do yard o total é MENOR do que partindo da base (a van)', () => {
    const daVan = minutosDaOrdem(stops, ordem, opcoes) as number;
    const doYard = minutosDaOrdem(stops, ordem, opcoes, origemDaEntregaDaRota({ ...yard, ...yardPerto })) as number;
    expect(daVan).not.toBeNull();
    expect(doYard).not.toBeNull();
    expect(doYard).toBeLessThan(daVan);
  });
});
