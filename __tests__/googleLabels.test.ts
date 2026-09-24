/**
 * CORES DO GOOGLE — os DOIS esquemas (bug 56, 25/09/2026).
 *
 * O Google ampliou a paleta em junho/2026: cada calendário passou a ter etiquetas
 * (`labelProperties.eventLabels`, cada uma com `id` + `backgroundColor` em hex) e o EVENTO passou a
 * carregar `eventLabelId`. O app só conhecia o `colorId` legado (1..11) — um evento pintado com a
 * paleta nova ("Cobalto" #4A86E8, o caso do cliente) chegava SEM cor e caía em "cor não reconhecida".
 *
 * Estes testes travam o contrato novo:
 *  - a etiqueta é classificada pelo TOM do hex: verde = boarding, azul = daycare, vermelho = cancela;
 *  - tom fora de verde/azul/vermelho (amarelo, laranja, roxo, cinza) NÃO vira serviço — o app não chuta;
 *  - a etiqueta MANDA quando existe; o `colorId` legado é o fallback (paleta velha);
 *  - a tela recebe o que foi lido: nome da etiqueta + hex + `colorId` legado (`Cobalto (#4A86E8)`).
 */
import {
  describeEventColor,
  hueOfHex,
  interpretarEtiquetas,
  labelForService,
  meaningOfLabelColor,
  readEventColor,
  type EventLabel,
} from '@/features/calendar/googleColors';

/** As etiquetas como a API do Google devolve (`labelProperties.eventLabels`). */
function resposta(etiquetas: { id: string; name?: string; backgroundColor: string }[]) {
  return { kind: 'calendar#calendar', id: 'primary', labelProperties: { eventLabels: etiquetas } };
}

/** Hexes reais da paleta do Google (a nova e a antiga) — nada de cor inventada. */
const COBALTO = '#4A86E8'; // o tom que o cliente escolheu no print
const SAGE = '#33b679'; // verde da paleta antiga (id 2)
const TOMATO = '#e67c73'; // vermelho da paleta antiga (id 11)
const BANANA = '#ffd666'; // amarelo: NÃO vira serviço

describe('tom (hue) do hex da etiqueta', () => {
  it('lê o tom de um hex de 6 dígitos e de 3 dígitos', () => {
    expect(hueOfHex(COBALTO)).toBeCloseTo(217, 0); // azul
    expect(hueOfHex(SAGE)).toBeCloseTo(152, 0); // verde
    expect(hueOfHex(TOMATO)).toBeCloseTo(5, 0); // vermelho
    expect(hueOfHex('#f00')).toBeCloseTo(0, 0);
    expect(hueOfHex('4A86E8')).toBeCloseTo(217, 0); // sem `#` também vale
  });

  it('hex sem tom (cinza, branco, preto) ou inválido não dizem nada', () => {
    for (const hex of ['#808080', '#ffffff', '#000000', '#zzzzzz', '', null, undefined]) {
      expect([hex, hueOfHex(hex)]).toEqual([hex, null]);
    }
  });

  it('verde = boarding, azul = daycare, vermelho = cancelamento', () => {
    expect(meaningOfLabelColor(SAGE)).toEqual({ kind: 'service', serviceType: 'boarding' });
    expect(meaningOfLabelColor('#0b8043')).toEqual({ kind: 'service', serviceType: 'boarding' });
    expect(meaningOfLabelColor(COBALTO)).toEqual({ kind: 'service', serviceType: 'daycare' });
    expect(meaningOfLabelColor('#039be5')).toEqual({ kind: 'service', serviceType: 'daycare' });
    expect(meaningOfLabelColor(TOMATO)).toEqual({ kind: 'cancel' });
    expect(meaningOfLabelColor('#d50000')).toEqual({ kind: 'cancel' });
  });

  it('tom fora de verde/azul/vermelho NÃO vira serviço (o app não chuta)', () => {
    // amarelo, laranja (Tangerine #f4511e ≈ 14°, de propósito FORA do vermelho), roxo e cinza.
    for (const hex of [BANANA, '#f4511e', '#8e24aa', '#dbadff', '#808080']) {
      expect([hex, meaningOfLabelColor(hex)]).toEqual([hex, null]);
    }
  });
});

describe('etiquetas do calendário', () => {
  const etiquetas = interpretarEtiquetas(
    resposta([
      { id: 'lab-azul', name: 'Cobalto', backgroundColor: COBALTO },
      { id: 'lab-verde', backgroundColor: SAGE }, // sem nome: continua válida
      { id: 'lab-amarela', name: 'Amarelo', backgroundColor: BANANA },
      { id: 'sem-hex', name: 'Sem hex' } as never, // sem hex não diz cor nenhuma, mas tem id
      { name: 'sem id' } as never, // sem id não dá para usar: fica de fora
    ]),
  );

  it('traduz a resposta da API e descarta etiqueta sem id', () => {
    expect(etiquetas.map((item) => item.id)).toEqual(['lab-azul', 'lab-verde', 'lab-amarela', 'sem-hex']);
    expect(etiquetas[0]).toEqual({ id: 'lab-azul', name: 'Cobalto', backgroundColor: COBALTO });
    expect(etiquetas[1].name).toBeNull();
  });

  it('resposta vazia ou sem `labelProperties` não quebra (calendário sem etiqueta)', () => {
    expect(interpretarEtiquetas(null)).toEqual([]);
    expect(interpretarEtiquetas({})).toEqual([]);
    expect(interpretarEtiquetas({ labelProperties: {} })).toEqual([]);
    expect(interpretarEtiquetas({ labelProperties: { eventLabels: 'nada' } })).toEqual([]);
  });

  it('a etiqueta do serviço é escolhida pelo TOM e é determinística (menor id)', () => {
    const duasVerdes: EventLabel[] = [
      { id: 'z-verde', name: 'Verde claro', backgroundColor: '#7ae7bf' },
      { id: 'a-verde', name: 'Verde escuro', backgroundColor: SAGE },
      { id: 'azul', name: 'Cobalto', backgroundColor: COBALTO },
    ];
    expect(labelForService(duasVerdes, 'boarding')?.id).toBe('a-verde');
    expect(labelForService(duasVerdes, 'daycare')?.id).toBe('azul');
    expect(labelForService([{ id: 'x', name: 'Amarelo', backgroundColor: BANANA }], 'boarding')).toBeNull();
    expect(labelForService([], 'daycare')).toBeNull();
    expect(labelForService(undefined, 'daycare')).toBeNull();
  });
});

describe('o que foi LIDO do evento (o que a tela mostra)', () => {
  const etiquetas: EventLabel[] = [
    { id: 'lab-cobalto', name: 'Cobalto', backgroundColor: COBALTO },
    { id: 'lab-amarela', name: 'Amarelo', backgroundColor: BANANA },
  ];

  it('evento da paleta NOVA (etiqueta, sem colorId): o serviço sai do tom — o caso do cliente', () => {
    const lido = readEventColor({ eventLabelId: 'lab-cobalto', colorId: null }, etiquetas);
    expect(lido).toEqual({
      source: 'label',
      labelId: 'lab-cobalto',
      labelName: 'Cobalto',
      backgroundColor: COBALTO,
      colorId: null,
      meaning: { kind: 'service', serviceType: 'daycare' },
    });
    // É esta linha que o suporte lê no cartão: `zara · Cobalto (#4A86E8)`.
    expect(describeEventColor(lido)).toBe('Cobalto (#4A86E8)');
  });

  it('evento da paleta ANTIGA (sem etiqueta): o `colorId` legado continua valendo (fallback)', () => {
    const lido = readEventColor({ eventLabelId: null, colorId: '2' }, etiquetas);
    expect(lido.source).toBe('colorId');
    expect(lido.meaning).toEqual({ kind: 'service', serviceType: 'boarding' });
    expect(describeEventColor(lido)).toBe('colorId 2 (Sage)');
  });

  it('etiqueta com tom não mapeado (amarelo) não vira serviço — e não cai no colorId', () => {
    const lido = readEventColor({ eventLabelId: 'lab-amarela', colorId: '2' }, etiquetas);
    expect(lido.labelName).toBe('Amarelo');
    expect(lido.meaning).toBeNull();
    expect(describeEventColor(lido)).toBe('Amarelo (#ffd666) · colorId 2 (Sage)');
  });

  it('etiqueta que não está na lista do calendário: mostra o id e cai no colorId legado', () => {
    const lido = readEventColor({ eventLabelId: 'lab-apagada', colorId: '7' }, etiquetas);
    expect(lido.labelName).toBeNull();
    expect(lido.meaning).toEqual({ kind: 'service', serviceType: 'daycare' });
    expect(describeEventColor(lido)).toBe('label lab-apagada (not in this calendar) · colorId 7 (Peacock)');
  });

  it('sem etiqueta e sem colorId: nada de serviço, e a tela diz que não há cor', () => {
    const lido = readEventColor({ eventLabelId: null, colorId: null }, etiquetas);
    expect(lido).toEqual({ source: 'none', labelId: null, labelName: null, backgroundColor: null, colorId: null, meaning: null });
    expect(describeEventColor(lido)).toBe('no color');
  });

  it('sem a lista de etiquetas (não deu para ler), o colorId ainda salva o evento', () => {
    const lido = readEventColor({ eventLabelId: 'lab-cobalto', colorId: '11' });
    expect(lido.meaning).toEqual({ kind: 'cancel' });
  });

  it('a tela tolera o que não foi lido (estado antigo na tela) sem quebrar', () => {
    expect(describeEventColor(undefined)).toBe('no color');
    expect(describeEventColor(null)).toBe('no color');
  });
});
