/**
 * Plano do salvamento dos CAES de um cliente (23/09/2026).
 *
 * E a parte pura que decide o que o salvamento faz: quais caes sao atualizados (com foto nova
 * ou foto removida), quais sao inseridos e quais sao apagados. Ficou puro justamente para o
 * caso chato ter teste: cao novo com nome repetido (o cadastro ganhava "Luna" duas vezes) e
 * id de cao de OUTRA familia marcado para remocao (nao pode apagar o cao de outro cliente).
 */
import { dogSavePlan, type DogFormValues } from '@/features/clients/clientsService';

const cachorro = (name: string, extra: Partial<DogFormValues> = {}): DogFormValues => ({
  name,
  breed: null,
  behavior_notes: null,
  medical_notes: null,
  photo_url: null,
  ...extra,
});

const doCliente = [
  { id: 'dog-1', name: 'Mowgli' },
  { id: 'dog-2', name: 'Luna' },
];

describe('dogSavePlan', () => {
  it('atualiza os caes mantidos com os dados da tela', () => {
    const plano = dogSavePlan(
      doCliente,
      [
        { id: 'dog-1', ...cachorro('Mowgli', { breed: 'Poodle', photo_url: 'file:///var/mobile/novo.jpg' }) },
        { id: 'dog-2', ...cachorro('Luna') },
      ],
      [],
      [],
    );
    expect(plano.updates.map((item) => item.id)).toEqual(['dog-1', 'dog-2']);
    expect(plano.updates[0].values).toMatchObject({ name: 'Mowgli', breed: 'Poodle', photo_url: 'file:///var/mobile/novo.jpg' });
    expect(plano.inserts).toEqual([]);
    expect(plano.idsToDelete).toEqual([]);
  });

  it('apaga SO o cao deste cliente, mesmo se vier id de fora na lista de remocao', () => {
    const plano = dogSavePlan(doCliente, [{ id: 'dog-1', ...cachorro('Mowgli') }], ['dog-2', 'dog-de-outro'], []);
    expect(plano.idsToDelete).toEqual(['dog-2']);
    expect(plano.updates.map((item) => item.id)).toEqual(['dog-1']);
  });

  it('nao insere cao novo com nome que o cliente ja tem (nem repetido na mesma leva)', () => {
    const plano = dogSavePlan(doCliente, doCliente.map((dog) => ({ ...dog, ...cachorro(dog.name) })), [], [
      cachorro('luna', { breed: 'Shih Tzu' }),
      cachorro('Kona'),
      cachorro('kona'),
      cachorro('Thor'),
    ]);
    expect(plano.inserts.map((dog) => dog.name)).toEqual(['Kona', 'Thor']);
  });

  it('cao novo sem nome e ignorado (cartao que o gestor desistiu de preencher)', () => {
    const plano = dogSavePlan(doCliente, [], [], [cachorro('   '), cachorro('Kona')]);
    expect(plano.inserts.map((dog) => dog.name)).toEqual(['Kona']);
  });

  it('cao mantido sem nome e erro: nao se apaga cadastro existente por descuido', () => {
    expect(() => dogSavePlan(doCliente, [{ id: 'dog-1', ...cachorro('  ') }], [], [])).toThrow(/Dog name is required/);
  });

  it('foto removida na tela sai como null no payload (o arquivo antigo e apagado por quem salva)', () => {
    const plano = dogSavePlan(
      doCliente,
      [{ id: 'dog-1', ...cachorro('Mowgli', { photo_url: '  ' }) }],
      [],
      [],
    );
    expect(plano.updates[0].values.photo_url).toBeNull();
  });
});
