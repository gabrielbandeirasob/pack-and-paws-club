import { splitContactName } from '@/features/clients/clientsService';

/**
 * O chefe salva o contato com o nome do cachorro entre parenteses — "Leigh Ann(Mowgli)".
 * O app usava isso como nome do cliente e ainda pedia o nome do cachorro de novo.
 * Aqui o contato e separado em nome do cliente + dica de nome de cachorro.
 */
describe('splitContactName (nome do contato -> cliente + cachorro)', () => {
  it('separa o nome do cachorro que veio colado no nome', () => {
    expect(splitContactName('Leigh Ann(Mowgli)')).toEqual({ clientName: 'Leigh Ann', dogHint: 'Mowgli' });
  });

  it('separa quando ha espaco antes do parentese', () => {
    expect(splitContactName('Leigh Ann (Mowgli)')).toEqual({ clientName: 'Leigh Ann', dogHint: 'Mowgli' });
  });

  it('devolve varios cachorros do mesmo contato', () => {
    expect(splitContactName('Ana (Mowgli, Kona)')).toEqual({ clientName: 'Ana', dogHint: 'Mowgli, Kona' });
    expect(splitContactName('Ana (Mowgli e Kona)')).toEqual({ clientName: 'Ana', dogHint: 'Mowgli, Kona' });
  });

  it('junta parenteses repetidos no fim do nome', () => {
    expect(splitContactName('Leigh Ann(Mowgli)(Kona)')).toEqual({ clientName: 'Leigh Ann', dogHint: 'Mowgli, Kona' });
  });

  it('nao mexe em nome sem parentese', () => {
    expect(splitContactName('Mocha House')).toEqual({ clientName: 'Mocha House', dogHint: '' });
  });

  it('mantem o nome do cliente quando so o parentese sobra', () => {
    // Sem isso o cliente ficaria sem nome — melhor manter o texto original.
    expect(splitContactName('(Mowgli)')).toEqual({ clientName: '(Mowgli)', dogHint: 'Mowgli' });
  });

  it('aguenta espacos e nome vazio', () => {
    expect(splitContactName('  Bob (Luna)  ')).toEqual({ clientName: 'Bob', dogHint: 'Luna' });
    expect(splitContactName('   ')).toEqual({ clientName: '', dogHint: '' });
  });

  it('trata o separador de lista tambem dentro do parentese', () => {
    expect(splitContactName('Ana (Mowgli, Kona, Soko)').dogHint).toBe('Mowgli, Kona, Soko');
  });
});
