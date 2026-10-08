/**
 * CINZA = DAYCARE (decisão do dono, 08/10/2026): *"quero que a cor cinza também seja reconhecida como
 * daycare"*.
 *
 * O cinza é a única cor **ACROMÁTICA** do calendário e chega ao app de DUAS formas:
 *  - paleta ANTIGA: `colorId` 8 (**Graphite**) — o mapa por id não olha tom nenhum;
 *  - paleta NOVA: etiqueta cujo hex é cinza (`#808080`, `#e1e1e1`, `#616161`…) — `hueOfHex` devolve
 *    `null` (não há matiz) e era por aí que o evento caía em *"color not recognized"* no cartão.
 *
 * O que estes vetores travam:
 *  - `colorId` 8 e etiqueta cinza viram **DAYCARE** (dia normal: ponto de rota, Total Pack e van);
 *  - o corte é o **CROMA** (`ehCinza`), e não a luminosidade — quase branco e quase preto NÃO são o
 *    cinza do escritório e seguem sem serviço;
 *  - o cinza é regra de **LEITURA**: quem o app usa para PINTAR daycare continua sendo o azul
 *    (`COLOR_OF_SERVICE.daycare` = Peacock) — nenhuma etiqueta cinza é escolhida para escrever.
 */
import {
  describeEventColor,
  ehCinza,
  hueOfHex,
  labelForService,
  meaningOfColor,
  meaningOfLabelColor,
  readEventColor,
  type EventLabel,
} from '@/features/calendar/googleColors';
import { parseEvent } from '@/features/integrations/google/calendarApi';
import { planCalendarImport, type DogForImport } from '@/features/integrations/google/importPlan';

const JANELA = { from: '2026-10-08', to: '2027-04-07' };
const KONA: DogForImport = { id: 'dog-kona', name: 'Kona', clientName: 'Nina' };
const GRAFITE: EventLabel = { id: 'lab-grafite', name: 'Graphite', backgroundColor: '#808080' };

describe('cinza = daycare — a cor sem tom, não o tom', () => {
  it('paleta ANTIGA: colorId 8 (Graphite) é daycare', () => {
    expect(meaningOfColor('8')).toEqual({ kind: 'service', serviceType: 'daycare' });
  });

  it('paleta NOVA: a etiqueta cinza é daycare, e continua SEM tom', () => {
    for (const hex of ['#808080', '#e1e1e1', '#616161', '#a0a0a0']) {
      expect([hex, meaningOfLabelColor(hex)]).toEqual([hex, { kind: 'service', serviceType: 'daycare' }]);
      // O `hueOfHex` continua devolvendo null: o cinza nunca teve matiz — o que mudou foi o significado.
      expect([hex, hueOfHex(hex)]).toEqual([hex, null]);
    }
  });

  it('o corte é o CROMA, não a luminosidade: quase branco e quase preto ficam de fora', () => {
    for (const hex of ['#808080', '#f0f0f0', '#333333', '#e1e1e1']) {
      expect([hex, ehCinza(hex)]).toEqual([hex, true]);
    }
    // Branco, no Google, é o evento SEM cor (que já é daycare por outra regra); quase preto não é cor
    // que o escritório use. Nos dois casos o app não chuta serviço.
    for (const hex of ['#ffffff', '#fdfdfd', '#000000', '#0a0a0a']) {
      expect([hex, ehCinza(hex)]).toEqual([hex, false]);
      expect([hex, meaningOfLabelColor(hex)]).toEqual([hex, null]);
    }
  });

  it('cor que TEM tom não é cinza, nem quando é escura — e lixo/hex inválido também não', () => {
    for (const hex of ['#0b8043', '#4A86E8', '#d50000', '#795548', '#8e24aa']) {
      expect([hex, ehCinza(hex)]).toEqual([hex, false]);
    }
    for (const invalido of ['', '   ', null, undefined, '#zzzzzz', '#12345']) {
      expect([String(invalido), ehCinza(invalido)]).toEqual([String(invalido), false]);
    }
  });

  it('o cartão mostra a etiqueta lida e o serviço sai daycare (é o que o suporte lê)', () => {
    const lido = readEventColor({ eventLabelId: GRAFITE.id }, [GRAFITE]);
    expect(lido.meaning).toEqual({ kind: 'service', serviceType: 'daycare' });
    expect(describeEventColor(lido)).toBe('Graphite (#808080)');
  });

  it('caminho REAL do Google: evento cinza (colorId 8) cria reserva de DAYCARE, com van', () => {
    const remoto = parseEvent({
      id: 'ev-cinza',
      summary: 'Kona',
      colorId: '8',
      start: { date: '2026-10-09' },
      end: { date: '2026-10-10' },
    } as never);
    const plano = planCalendarImport([remoto], [KONA], [], JANELA);
    expect(plano).toHaveLength(1);
    expect(plano[0]).toMatchObject({
      kind: 'create',
      dogId: 'dog-kona',
      parsed: { serviceType: 'daycare', transportRequired: true, cancels: false },
    });
  });

  it('caminho REAL do Google: evento com ETIQUETA cinza (paleta nova) também entra como daycare', () => {
    const remoto = parseEvent({
      id: 'ev-etiqueta-cinza',
      summary: 'Kona',
      eventLabelId: GRAFITE.id,
      start: { date: '2026-10-09' },
      end: { date: '2026-10-10' },
    } as never);
    const plano = planCalendarImport([remoto], [KONA], [], JANELA, { labels: [GRAFITE] });
    expect(plano).toHaveLength(1);
    expect(plano[0]).toMatchObject({ kind: 'create', dogId: 'dog-kona', parsed: { serviceType: 'daycare' } });
  });

  it('o cinza é regra de LEITURA: o app não pinta daycare de cinza (a etiqueta azul continua sendo a da escrita)', () => {
    const azul: EventLabel = { id: 'z-azul', name: 'Peacock', backgroundColor: '#039be5' };
    // A etiqueta cinza tem o MENOR id: sem o corte, seria ela a escolhida para pintar o daycare.
    expect(labelForService([GRAFITE, azul], 'daycare')?.id).toBe('z-azul');
    // Só com a cinza em mãos não há cor de escrita: quem pinta é o `colorId` legado (Peacock, 7).
    expect(labelForService([GRAFITE], 'daycare')).toBeNull();
  });
});
