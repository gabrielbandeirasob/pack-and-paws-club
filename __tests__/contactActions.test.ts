/**
 * Acoes rapidas do cliente: ligar, mensagem e rota.
 *
 * Duas armadilhas que estes testes travam:
 * - numero sujo do iPhone ("+1 (415) 555-1234") precisa virar link discavel;
 * - numero curto (ramal, campo vazio) NAO pode virar botao: abrir o discador em numero
 *   errado na frente do cliente e pior do que nao ter o botao.
 */
import { addressLine, clientMessageTemplate, digitsForPhone, directionsTarget, phoneUrl, smsUrl } from '@/features/clients/contactActions';

describe('telefone do cliente', () => {
  it('limpa o formato do iPhone e preserva o + internacional', () => {
    expect(digitsForPhone('+1 (415) 555-1234')).toBe('+14155551234');
    expect(digitsForPhone('415.555.1234')).toBe('4155551234');
    expect(digitsForPhone(' 415-555-1234 ')).toBe('4155551234');
  });

  it('recusa numero curto demais, vazio ou ausente', () => {
    expect(digitsForPhone('1234')).toBeNull();
    expect(digitsForPhone('')).toBeNull();
    expect(digitsForPhone('   ')).toBeNull();
    expect(digitsForPhone(null)).toBeNull();
    expect(digitsForPhone(undefined)).toBeNull();
  });

  it('gera link de ligacao so quando o numero serve', () => {
    expect(phoneUrl('(415) 555-1234')).toBe('tel:4155551234');
    expect(phoneUrl('1234')).toBeNull();
  });

  it('gera link de mensagem com e sem texto', () => {
    expect(smsUrl('4155551234')).toBe('sms:4155551234');
    expect(smsUrl('4155551234', 'Hi Ana! ')).toBe('sms:4155551234&body=Hi%20Ana!');
    expect(smsUrl('1234', 'oi')).toBeNull();
  });

  it('o texto padrao cumprimenta pelo nome quando existe nome', () => {
    expect(clientMessageTemplate('Ana Souza')).toBe('Hi Ana Souza! ');
    expect(clientMessageTemplate('   ')).toBe('');
  });
});

describe('endereco e rota do cliente', () => {
  it('monta o endereco em uma linha, sem virgulas sobrando', () => {
    expect(
      addressLine({ address_line_1: '100 Market St', address_line_2: 'Apt 3', city: 'San Francisco', state: 'CA', postal_code: '94103' }),
    ).toBe('100 Market St, Apt 3, San Francisco, CA 94103');
    expect(addressLine({ address_line_1: '100 Market St', city: 'San Francisco' })).toBe('100 Market St, San Francisco');
    expect(addressLine({ address_line_1: '  ', city: '  ' })).toBeNull();
    expect(addressLine({})).toBeNull();
  });

  it('prefere a coordenada, mas aceita endereco de texto', () => {
    expect(directionsTarget({ latitude: 37.79, longitude: -122.4 })).toEqual({ address: null, latitude: 37.79, longitude: -122.4 });
    expect(directionsTarget({ address_line_1: '100 Market St', city: 'San Francisco' })).toEqual({
      address: '100 Market St, San Francisco',
      latitude: null,
      longitude: null,
    });
  });

  it('sem coordenada e sem endereco nao ha alvo (nao abre o mapa vazio)', () => {
    expect(directionsTarget({ address_line_1: null, city: null, postal_code: null })).toBeNull();
    expect(directionsTarget({ latitude: null, longitude: null })).toBeNull();
  });
});
