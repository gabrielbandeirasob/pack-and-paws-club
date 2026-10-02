/**
 * VAN POR ROTA COM VÁRIAS VANS (pergunta do dono, 01/10/2026: *"vamos supor que tenhas várias vans, o
 * erro não vai se repetir?"*).
 *
 * O que estes vetores travam:
 *  1. rota que APONTA uma van manda sempre (a escolha do gestor não é chutada por proximidade);
 *  2. rota SEM van, com 2+ vans cadastradas, sai da van MAIS PRÓXIMA das paradas — não da padrão;
 *  3. com UMA van só nada muda (é o mundo de hoje: uma van, comportamento idêntico ao de antes);
 *  4. sem coordenada utilizável, o app não chuta van: cai na padrão (ou em nenhuma, se não houver).
 */
import {
  vanDaRota,
  vanLocationForRoute,
  vanMaisProxima,
  type OrganizationLocation,
} from '@/features/organization/locations';

const van = (p: Partial<OrganizationLocation> & { id: string; latitude: number; longitude: number }): OrganizationLocation => ({
  name: p.id,
  kind: 'van',
  addressLine1: null,
  city: null,
  radiusMeters: 300,
  isDefault: false,
  ...p,
});

// São Francisco (a van de teste que causou o defeito) e San Mateo (a van de verdade).
const sf = van({ id: 'sf', name: 'Van teste', latitude: 37.7793, longitude: -122.4192, isDefault: true });
const sm = van({ id: 'sm', name: 'Van 1', latitude: 37.5427669, longitude: -122.2849451 });
// Parada em Palo Alto, do lado de San Mateo.
const paradaPaloAlto = { latitude: 37.4419, longitude: -122.143 };

describe('vanMaisProxima', () => {
  it('escolhe a van mais perto das paradas, não a padrão', () => {
    expect(vanMaisProxima([sf, sm], [paradaPaloAlto])?.id).toBe('sm');
    expect(vanMaisProxima([sf, sm], [{ latitude: 37.78, longitude: -122.41 }])?.id).toBe('sf');
  });

  it('usa a parada mais perto de qualquer uma das vans (não a média)', () => {
    const longe = { latitude: 38.9, longitude: -121.0 };
    expect(vanMaisProxima([sf, sm], [longe, paradaPaloAlto])?.id).toBe('sm');
  });

  it('sem ponto utilizável devolve null (quem chama cai na padrão)', () => {
    expect(vanMaisProxima([sf, sm], [])).toBeNull();
    expect(vanMaisProxima([sf, sm], [{ latitude: null, longitude: null }])).toBeNull();
    // GPS sem fix devolve 0,0 — não é lugar.
    expect(vanMaisProxima([sf, sm], [{ latitude: 0, longitude: 0 }])).toBeNull();
  });
});

describe('vanDaRota', () => {
  it('a van escolhida na rota manda, mesmo com outra mais perto', () => {
    expect(vanDaRota([sf, sm], 'sf', [paradaPaloAlto])?.id).toBe('sf');
    expect(vanDaRota([sf, sm], 'sm', [{ latitude: 37.78, longitude: -122.41 }])?.id).toBe('sm');
  });

  it('rota sem van escolhida sai da mais próxima das paradas (com 2+ vans)', () => {
    expect(vanDaRota([sf, sm], null, [paradaPaloAlto])?.id).toBe('sm');
  });

  it('sem parada com coordenada cai na van padrão', () => {
    expect(vanDaRota([sf, sm], null, [])?.id).toBe('sf');
    expect(vanDaRota([{ ...sf, isDefault: false }, sm], null, [])).toBeNull();
  });

  it('com UMA van só o resultado é o mesmo de vanLocationForRoute', () => {
    const so = [{ ...sm, isDefault: false }];
    expect(vanDaRota(so, null, [paradaPaloAlto])?.id).toBe(vanLocationForRoute(so, null)?.id);
    expect(vanDaRota(so, null, [])?.id).toBe(vanLocationForRoute(so, null)?.id);
    expect(vanDaRota([], null, [paradaPaloAlto])).toBeNull();
  });

  it('van apagada (id que não existe mais) cai na regra normal', () => {
    expect(vanDaRota([sf, sm], 'apagada', [paradaPaloAlto])?.id).toBe('sm');
  });
});
