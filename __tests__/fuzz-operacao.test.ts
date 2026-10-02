/**
 * FUZZING DA OPERAÇÃO — mecanismo NOVO da auditoria de 02/10/2026.
 *
 * Por que existe: o dono já pegou dois defeitos fazendo a pergunta certa na hora certa ("e com várias
 * vans?"). Este arquivo faz essa pergunta MECANICAMENTE: sorteia milhares de dias, rotas, posições e
 * horários e cobra invariantes que NUNCA podem quebrar. Semente fixa (mulberry32) — se falhar, falha
 * igual em toda máquina, e o caso sorteado sai no `expect` para virar teste de regressão.
 *
 * O que ele NÃO faz: julgar se a operação está boa. Ele caça o impossível — cão perdido, cão contado
 * duas vezes, cão que aparece de dois motoristas, número negativo, NaN, ordem que piora a rota.
 */
import { buildDay, transportPool, vanPool, dogsJaNaVan } from '@/features/calendar/dayMath';
import type { DayItem, ReservationRecord, RecurringExceptionRecord, RecurringScheduleRecord } from '@/features/calendar/dayMath';
import { contagemDoDia, dogsOfDaySummary } from '@/features/dashboard/dayService';
import { optimizeRoute, minutosDaOrdem } from '@/features/dispatch/routeOptimizer';
import type { OptimizeStop } from '@/features/dispatch/routeOptimizer';
import { sugerirRotas } from '@/features/dispatch/routeSuggestion';
import type { CaoParaSugerir, MotoristaParaSugerir } from '@/features/dispatch/routeSuggestion';
import { minutosAteParadaPorRota, frescorDaPosicao, minutesBetweenKm, minutesOfDay, isPastDeadline } from '@/features/driver/eta';
import type { EtaStop } from '@/features/driver/eta';
import { fechamentoDaRota, buscaTerminou, entregaTerminou } from '@/features/driver/routeClosing';
import { addDaysISO, weekdayOfISO } from '@/features/calendar/dates';

/* ---------------------------------------------------------------- sorteio */

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const make = (seed: number) => {
  const r = prng(seed);
  return {
    int: (min: number, max: number) => min + Math.floor(r() * (max - min + 1)),
    pick: <T,>(list: T[]): T => list[Math.floor(r() * list.length)],
    chance: (p: number) => r() < p,
    coord: () => Number((37 + (r() - 0.5) * 0.4).toFixed(6)),
  };
};

/* ------------------------------------------------------------- geradores */

const DIA = '2026-10-05';

function caoAleatorio(t: ReturnType<typeof make>, indice: number) {
  return {
    id: `d${indice}`,
    dogName: `Cao ${indice}`,
    clientName: `Cliente ${t.int(0, 3)}`, // casa repetida de propósito: irmãos
    clientId: `c${t.int(0, 3)}`,
  };
}

function diaAleatorio(t: ReturnType<typeof make>, quantos: number) {
  const reservas: ReservationRecord[] = [];
  for (let i = 0; i < quantos; i += 1) {
    const dias = t.int(1, 4);
    reservas.push({
      id: `r${i}`,
      dog: caoAleatorio(t, i),
      serviceType: t.chance(0.75) ? 'daycare' : 'boarding',
      startDate: addDaysISO(DIA, -t.int(0, 2)),
      endDate: addDaysISO(DIA, dias - 1),
      transportRequired: t.chance(0.7),
      goesToDaycare: t.chance(0.8),
    });
  }
  const series: RecurringScheduleRecord[] = [];
  for (let i = 0; i < t.int(0, 3); i += 1) {
    series.push({
      id: `s${i}`,
      dog: caoAleatorio(t, 50 + i),
      weekdays: [1, 2, 3, 4, 5].filter(() => t.chance(0.6)),
      startDate: addDaysISO(DIA, -30),
      endDate: null,
      active: t.chance(0.85),
      transportRequired: t.chance(0.6),
    });
  }
  const excecoes: RecurringExceptionRecord[] = [];
  for (let i = 0; i < t.int(0, 3); i += 1) {
    excecoes.push({
      id: `e${i}`,
      scheduleId: `s${t.int(0, 3)}`,
      action: t.pick(['skip', 'extra', 'transport_on', 'transport_off'] as const),
      startDate: DIA,
      endDate: DIA,
    });
  }
  return { reservas, series, excecoes };
}

function paradasAleatorias(t: ReturnType<typeof make>, quantas: number, comCoordenada = true): OptimizeStop[] {
  const paradas: OptimizeStop[] = [];
  for (let i = 0; i < quantas; i += 1) {
    paradas.push({
      dogId: `d${i}`,
      clientName: `Cliente ${i}`,
      dogName: `Cao ${i}`,
      latitude: comCoordenada ? t.coord() : null,
      longitude: comCoordenada ? t.coord() : null,
      windowStart: null,
      windowEnd: null,
      exactTime: null,
      priority: t.chance(0.2) ? 'priority' : 'normal',
    });
  }
  return paradas;
}

const ids = (itens: { dogId: string }[]) => itens.map((i) => i.dogId).sort();

/* ------------------------------------------------------------ invariantes */

describe('FUZZING — dias aleatórios: pools e contagem', () => {
  it('nunca perde, duplica ou "inventa" cão (2.000 dias)', () => {
    const t = make(20261002);
    for (let caso = 0; caso < 2000; caso += 1) {
      const { reservas, series, excecoes } = diaAleatorio(t, t.int(0, 12));
      const dia = buildDay(DIA, reservas, series, excecoes);
      const contexto = `caso ${caso}`;

      const naVan = vanPool(dia);
      const fila = transportPool(dia);
      const jaNaVan = dogsJaNaVan(dia);

      // Nada repetido DENTRO de cada lista.
      for (const lista of [naVan, fila, dia.daycare, dia.boarding]) {
        const nomes = lista.map((i: DayItem) => i.dogId);
        expect(new Set(nomes).size).toBe(nomes.length);
      }

      // Um cão não pode estar na van E na fila de pickup ao mesmo tempo.
      const naFila = new Set(fila.map((i) => i.dogId));
      for (const item of naVan) expect(naFila.has(item.dogId)).toBe(false);

      // A fila só tem quem precisa de transporte e NÃO está na van.
      for (const item of fila) {
        expect(item.transportRequired).toBe(true);
        expect(jaNaVan.has(item.dogId)).toBe(false);
      }

      // Quem está na van é boarding que passa pelo daycare (contrato 28/09/2026).
      for (const item of naVan) {
        expect(item.kind).toBe('boarding');
        expect(item.goesToDaycare).toBe(true);
      }

      // A contagem do dia não pode passar do número de cães distintos nem ser negativa.
      const contagem = contagemDoDia(dia);
      const distintos = new Set([...dia.daycare, ...dia.boarding].map((i) => i.dogId)).size;
      expect(contagem.daycare).toBeGreaterThanOrEqual(0);
      expect(contagem.boarding).toBeGreaterThanOrEqual(0);
      expect(contagem.daycare + contagem.boarding).toBeLessThanOrEqual(distintos);
      expect(contagem.daycare + contagem.boarding).toBeGreaterThanOrEqual(
        new Set(dogsOfDaySummary(dia).map((c) => c.dogId)).size,
      );

      // Contagem e resumo falam dos MESMOS cães.
      expect(new Set(dogsOfDaySummary(dia).map((c) => c.dogId)).size)
        .toBe(new Set([...dia.daycare, ...dia.boarding].map((i) => i.dogId)).size);
      void contexto;
    }
  });
});

describe('FUZZING — Optimize: a ordem nunca piora nem perde cão', () => {
  it('devolve sempre uma permuta (ou falha avisando) — 500 rotas', () => {
    const t = make(777);
    for (let caso = 0; caso < 500; caso += 1) {
      const quantas = t.int(2, 8);
      const paradas = paradasAleatorias(t, quantas);
      const saida = optimizeRoute(paradas, { homeLatitude: t.coord(), homeLongitude: t.coord() });
      if (!saida.feasible) {
        expect(saida.stops).toEqual([]);
        expect(saida.reason).toBeTruthy();
        continue;
      }
      expect(ids(saida.stops)).toEqual(ids(paradas));
      expect(new Set(saida.stops.map((s) => s.sequence)).size).toBe(quantas);
      for (const parada of saida.stops) {
        expect(parada.plannedArrival === null || /^\d{2}:\d{2}$/.test(parada.plannedArrival)).toBe(true);
        expect(Number.isFinite(parada.waitsMinutes)).toBe(true);
        expect(parada.waitsMinutes).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('sem coordenada em ALGUM cão, nunca devolve meia ordem (250 rotas)', () => {
    const t = make(4242);
    for (let caso = 0; caso < 250; caso += 1) {
      const paradas = paradasAleatorias(t, t.int(2, 6));
      paradas[t.int(0, paradas.length - 1)].latitude = null;
      const saida = optimizeRoute(paradas, { homeLatitude: t.coord(), homeLongitude: t.coord() });
      expect(saida.feasible).toBe(false);
      expect(saida.stops).toEqual([]);
      expect(saida.reason).toContain('Missing coordinates');
    }
  });

  it('a ordem otimizada nunca é PIOR que a ordem original (sem janela) — 400 rotas', () => {
    const t = make(31337);
    for (let caso = 0; caso < 400; caso += 1) {
      // Sem prioridade: a regra "cão PRIORITÁRIO vai primeiro" (pedido do dono) vale mais que a
      // distância — com prioridade em jogo o ganancioso manda, e a garantia não se aplica.
      const paradas = paradasAleatorias(t, t.int(3, 7)).map((parada) => ({ ...parada, priority: 'normal' as const }));
      const opcoes = {
        homeLatitude: t.coord(),
        homeLongitude: t.coord(),
        dropoffLatitude: t.coord(),
        dropoffLongitude: t.coord(),
        serviceMinutes: t.int(0, 12),
      };
      const saida = optimizeRoute(paradas, opcoes, { latitude: opcoes.dropoffLatitude, longitude: opcoes.dropoffLongitude });
      if (!saida.feasible) continue;
      const original = paradas.map((p) => p.dogId);
      const otimizada = saida.stops.map((p) => p.dogId);
      const origem = { latitude: opcoes.dropoffLatitude, longitude: opcoes.dropoffLongitude };
      const antes = minutosDaOrdem(paradas, original, opcoes, origem);
      const depois = minutosDaOrdem(paradas, otimizada, opcoes, origem);
      expect(antes).not.toBeNull();
      expect(depois).not.toBeNull();
      expect(depois as number).toBeLessThanOrEqual((antes as number) + 1e-6);
      expect(Number.isFinite(depois as number)).toBe(true);
      expect(depois as number).toBeGreaterThanOrEqual(0);
    }
  });

  it('cão PRIORITÁRIO continua indo primeiro (regra do dono, preservada pelo 2-opt)', () => {
    const paradas: OptimizeStop[] = [
      { dogId: 'longe', clientName: 'A', dogName: 'A', latitude: 37.60, longitude: -122.20, windowStart: null, windowEnd: null, exactTime: null, priority: 'priority' },
      { dogId: 'perto', clientName: 'B', dogName: 'B', latitude: 37.37, longitude: -121.96, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' },
      { dogId: 'medio', clientName: 'C', dogName: 'C', latitude: 37.45, longitude: -122.05, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' },
    ];
    const saida = optimizeRoute(paradas, { homeLatitude: 37.36, homeLongitude: -121.95, serviceMinutes: 0 });
    expect(saida.feasible).toBe(true);
    expect(saida.stops[0].dogId).toBe('longe');
    expect(saida.stops.map((s) => s.dogId).sort()).toEqual(['longe', 'medio', 'perto']);
  });

  it('minutosDaOrdem nunca inventa número: null ou finito e não negativo — 300 casos', () => {
    const t = make(9091);
    for (let caso = 0; caso < 300; caso += 1) {
      const paradas = paradasAleatorias(t, t.int(1, 5), t.chance(0.8));
      const ordem = paradas.map((p) => p.dogId);
      const total = minutosDaOrdem(paradas, ordem, { homeLatitude: 37.36, homeLongitude: -121.95 });
      if (total !== null) {
        expect(Number.isFinite(total)).toBe(true);
        expect(total).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('FUZZING — ETA e posição', () => {
  const etapa = (t: ReturnType<typeof make>, i: number, status: string): EtaStop => ({
    id: `p${i}`,
    sequence: i + 1,
    clientName: `Cliente ${i}`,
    dogName: `Cao ${i}`,
    latitude: t.coord(),
    longitude: t.coord(),
    windowEnd: t.chance(0.4) ? `${t.int(8, 20)}:00` : null,
    exactTime: null,
    status,
    deliveredAt: null,
    travelSeconds: t.chance(0.5) ? t.int(60, 1800) : null,
    dropoffTravelSeconds: t.chance(0.5) ? t.int(60, 1800) : null,
  });

  it('a contagem até uma parada é sempre finita e não negativa — 500 rotas', () => {
    const t = make(2468);
    for (let caso = 0; caso < 500; caso += 1) {
      const stops: EtaStop[] = [];
      const quantas = t.int(1, 6);
      for (let i = 0; i < quantas; i += 1) stops.push(etapa(t, i, t.pick(['pending', 'arrived', 'completed', 'skipped'])));
      for (const alvo of stops) {
        const minutos = minutosAteParadaPorRota(stops, alvo.id);
        if (minutos !== null) {
          expect(Number.isFinite(minutos)).toBe(true);
          expect(minutos).toBeGreaterThanOrEqual(0);
        }
      }
      expect(minutosAteParadaPorRota(stops, 'nao-existe')).toBeNull();
    }
  });

  it('frescor da posição nunca estoura com carimbo estranho — 400 casos', () => {
    const t = make(1357);
    const agora = new Date('2026-10-02T18:00:00Z');
    for (let caso = 0; caso < 400; caso += 1) {
      const iso = new Date(agora.getTime() - t.int(-3600, 60 * 60 * 24 * 3) * 1000).toISOString();
      const frescor = frescorDaPosicao(iso, agora);
      // O rótulo é sempre texto legível e a idade nunca é negativa (posição "futura" do relógio torto
      // do aparelho cai em 'just now', não em número negativo).
      expect(typeof frescor.texto).toBe('string');
      expect(frescor.texto.length).toBeGreaterThan(0);
      expect(frescor.minutos).toBeGreaterThanOrEqual(0);
      expect(typeof frescor.velha).toBe('boolean');
      expect(typeof frescor.muitoVelha).toBe('boolean');
    }
    expect(() => frescorDaPosicao('', agora)).not.toThrow();
    expect(() => frescorDaPosicao('lixo', agora)).not.toThrow();
  });

  it('contas de tempo do dia nunca devolvem NaN — 200 casos', () => {
    const t = make(8642);
    for (let caso = 0; caso < 200; caso += 1) {
      const km = t.int(0, 120);
      const minutos = minutesBetweenKm(km, t.int(5, 90));
      expect(Number.isFinite(minutos)).toBe(true);
      expect(minutos).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(minutesOfDay(new Date(t.int(0, 40) * 3600 * 1000)))).toBe(true);
      expect(typeof isPastDeadline(t.chance(0.5) ? '12:00' : null, null)).toBe('boolean');
    }
  });
});

describe('FUZZING — fechamento da rota (yard/van)', () => {
  it('nunca inventa destino nem diz dois fins — 500 casos', () => {
    const t = make(5511);
    const van = { id: 'v1', name: 'Van 1', kind: 'van' as const, addressLine1: 'Rua da van', city: 'San Mateo', latitude: 37.5, longitude: -122.3, radiusMeters: 200 };
    const yard = { id: 'y1', name: 'Yard', kind: 'yard' as const, addressLine1: '1089 Memorex', city: 'Santa Clara', latitude: 37.36, longitude: -121.95, radiusMeters: 300 };

    for (let caso = 0; caso < 500; caso += 1) {
      // Estado COERENTE com a vida real: só está entregue quem já foi buscado. (A primeira versão deste
      // fuzz sorteava "entregue e pendente" ao mesmo tempo — estado impossível no app — e acusava um
      // defeito que não existe.)
      const stopSet = Array.from({ length: t.int(1, 5) }, (_, i) => {
        const estagio = t.pick(['pending', 'arrived', 'no_cao', 'entregue', 'pulado'] as const);
        return {
          id: `p${i}`,
          status: estagio === 'no_cao' || estagio === 'entregue' ? 'completed' : estagio === 'pulado' ? 'skipped' : estagio,
          deliveredAt: estagio === 'entregue' ? '2026-10-02T18:00:00Z' : null,
        };
      });
      const buscaOk = buscaTerminou(stopSet);
      const entregaOk = entregaTerminou(stopSet);
      const yardOuNulo = t.chance(0.85) ? (yard as never) : null;
      const vanOuNula = t.chance(0.9) ? (van as never) : null;
      const fim = fechamentoDaRota({
        buscaTerminou: buscaOk,
        entregaTerminou: entregaOk,
        yard: yardOuNulo,
        van: vanOuNula,
      });

      if (!buscaOk && !entregaOk) {
        expect(fim).toBeNull();
        continue;
      }
      if (fim) {
        expect(['yard', 'van']).toContain(fim.kind);
        // O título tem de falar do destino que veio, não de outro.
        if (fim.kind === 'yard') expect(fim.title).toContain('yard');
        if (fim.kind === 'van') expect(fim.title).toContain('van');
        expect(fim.subtitle.length).toBeGreaterThan(0);
      }
      // Fim de busca com yard cadastrado vai SEMPRE para o yard; fim de dia com van, para a van.
      if (!entregaOk && yardOuNulo) expect(fim?.kind).toBe('yard');
      if (entregaOk && vanOuNula) expect(fim?.kind).toBe('van');
    }
  });
});

describe('FUZZING — sugestão de rotas entre várias vans', () => {
  it('todo cão aparece UMA vez, irmãos juntos e sem lugar não ganha coordenada — 300 casos', () => {
    const t = make(6060);
    for (let caso = 0; caso < 300; caso += 1) {
      const caes: CaoParaSugerir[] = Array.from({ length: t.int(1, 14) }, (_, i) => ({
        dogId: `d${i}`,
        dogName: `Cao ${i}`,
        clientName: `Cliente ${i % 4}`,
        clientId: `c${i % 4}`,
        latitude: t.chance(0.85) ? t.coord() : null,
        longitude: t.chance(0.85) ? t.coord() : null,
      }));
      const motoristas: MotoristaParaSugerir[] = Array.from({ length: t.int(0, 4) }, (_, i) => ({
        driverId: `m${i}`,
        driverName: `Motorista ${i}`,
        latitude: t.chance(0.6) ? t.coord() : null,
        longitude: t.chance(0.6) ? t.coord() : null,
      }));

      const sugestao = sugerirRotas(caes, motoristas, { latitude: 37.36, longitude: -121.95 });
      const nosBlocos = sugestao.blocos.flatMap((b) => b.caes.map((c) => c.dogId));
      const semLugar = sugestao.semLugar.map((c) => c.dogId);

      // Ninguém se perde, ninguém aparece duas vezes.
      expect([...nosBlocos, ...semLugar].sort()).toEqual(caes.map((c) => c.dogId).sort());
      expect(new Set(nosBlocos).size).toBe(nosBlocos.length);
      expect(new Set(semLugar).size).toBe(semLugar.length);

      // Sem motorista, ninguém entra em bloco (e ninguém some).
      if (motoristas.length === 0) expect(nosBlocos).toEqual([]);

      // Irmãos (mesma casa) ficam no MESMO bloco.
      const blocoDe = new Map<string, string>();
      for (const bloco of sugestao.blocos) for (const cao of bloco.caes) blocoDe.set(cao.dogId, bloco.driverId);
      const casaDe = new Map<string, string[]>();
      for (const cao of sugestao.blocos.flatMap((b) => b.caes)) {
        const chave = cao.clientId ?? cao.dogId;
        casaDe.set(chave, [...(casaDe.get(chave) ?? []), blocoDe.get(cao.dogId) as string]);
      }
      for (const donos of casaDe.values()) expect(new Set(donos).size).toBe(1);

      // Distância nunca é NaN e o total é a soma dos blocos.
      for (const bloco of sugestao.blocos) {
        expect(Number.isFinite(bloco.km)).toBe(true);
        expect(bloco.km).toBeGreaterThanOrEqual(0);
      }
      expect(Number.isFinite(sugestao.kmTotal)).toBe(true);
      const soma = sugestao.blocos.reduce((acc, b) => acc + b.km, 0);
      expect(Math.abs(soma - sugestao.kmTotal)).toBeLessThan(1e-6);
    }
  });
});

describe('FUZZING — datas (virada de mês, ano e bissexto)', () => {
  it('10 anos de dias seguidos: sempre crescente, formato certo, dia da semana encadeado', () => {
    let iso = '2026-01-01';
    let anterior = iso;
    for (let i = 0; i < 3653; i += 1) {
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(iso > anterior || i === 0).toBe(true);
      const dia = weekdayOfISO(iso);
      expect(dia).toBeGreaterThanOrEqual(0);
      expect(dia).toBeLessThanOrEqual(6);
      const proximo = addDaysISO(iso, 1);
      expect(weekdayOfISO(proximo)).toBe((dia + 1) % 7);
      anterior = iso;
      iso = proximo;
    }
  });

  it('viradas conhecidas estão certas', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29'); // bissexto
    expect(addDaysISO('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysISO('2026-11-01', 0)).toBe('2026-11-01');
    // 💡 horário de verão dos EUA (America/Los_Angeles): 2026-11-01 é a virada — o dia seguinte é 02.
    expect(addDaysISO('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysISO('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDaysISO('2026-03-08', 1)).toBe('2026-03-09');
  });
});
