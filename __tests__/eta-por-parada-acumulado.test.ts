/**
 * ETA POR PARADA — ACUMULA A ROTA (defeito do dono, áudio de 02/10/2026).
 *
 * Palavra dele: *"As regras pra ele mandar o ETA também mano, tá zoado mano… ele manda de acordo com a
 * sua posição, não com a posição na rota. Porque por exemplo agora o primeiro cachorro deu o que eu ia
 * chegar lá entre 8 e 6 e 8 e 36 / O segundo cachorro deu o que eu ia chegar lá entre 8 e 10 e 8 e 40 /
 * O terceiro cachorro, 8 e 4 e 8 e 34… deveria ir aumentando, não diminuindo mano."*
 *
 * O defeito: sem as pernas gravadas pelo Optimize (`travel_seconds`), o ETA de CADA parada era medido
 * em linha reta DA POSIÇÃO ATUAL até aquela parada — cada uma isolada. Como a 3ª casa podia estar mais
 * perto do motorista que a 2ª, o aviso "andava para trás" (3ª antes da 2ª).
 *
 * O que estes vetores travam:
 *  (a) o ETA de uma parada é >= o de TODAS as anteriores na mesma fase (busca/entrega);
 *  (b) a mensagem do "Notify owner" carrega o número ACUMULADO, não o da posição isolada;
 *  (c) com janela/deadline a ordem continua coerente (atraso não decresce);
 *  (d) sem posição do motorista cai na estimativa da ROTA — nunca em zero inventado.
 */
import { lateMinutesForStop, minutosAteParada, minutosAteParadaPorRota, minutesToStop, nextStopEta, type EtaStop } from '@/features/driver/eta';
import { avisoWindow, etaMessageText, windowLabel } from '@/features/driver/etaMessage';

/** Posição do motorista no exemplo: origem (0,0). */
const MOTORISTA = { latitude: 0, longitude: 0 };

/**
 * As 3 paradas do dono — MESMA fase (busca), SEM pernas gravadas (rota não otimizada com tráfego).
 * As coordenadas foram escolhidas para reproduzir o defeito: a 3ª (C) está MAIS PERTO da posição do
 * motorista que a 2ª (B) — então a conta antiga (posição → alvo) dava C < B.
 */
type Parada = EtaStop & { clientName: string; dogName: string };
const parada = (p: Partial<Parada> & { id: string }): Parada => ({
  sequence: 1,
  status: 'pending',
  clientName: 'Tutor',
  dogName: 'Cão',
  latitude: null,
  longitude: null,
  travelSeconds: null,
  dropoffTravelSeconds: null,
  ...p,
});

const A = parada({ id: 'a', sequence: 1, dogName: 'Lucki', latitude: 0.05, longitude: 0 }); // ~13 min
const B = parada({ id: 'b', sequence: 2, dogName: 'Mowgli', latitude: 0.30, longitude: 0 }); // ~80 min (sozinho)
const C = parada({ id: 'c', sequence: 3, dogName: 'Luna', latitude: 0.10, longitude: 0 }); // ~27 min (sozinho)
const TRES: Parada[] = [A, B, C];

/** Os três minutos de serviço por parada intermediária (o MESMO número do Optimize e da tolerância). */
const SERVICO = 3;

describe('(a) ETA por parada acumula a rota — nunca decresce', () => {
  it('o defeito seria C < B medindo da posição, parada a parada (linha reta isolada)', () => {
    // Assim era a conta antiga: cada parada medida da POSIÇÃO ATUAL, isolada.
    const posA = minutesToStop(MOTORISTA, A)!;
    const posB = minutesToStop(MOTORISTA, B)!;
    const posC = minutesToStop(MOTORISTA, C)!;
    expect(posC).toBeLessThan(posB); // é EXATAMENTE o absurdo do áudio (3ª antes da 2ª)
  });

  it('com a correção: ETA(A) <= ETA(B) <= ETA(C)', () => {
    const etaA = minutosAteParada(TRES, 'a', MOTORISTA);
    const etaB = minutosAteParada(TRES, 'b', MOTORISTA);
    const etaC = minutosAteParada(TRES, 'c', MOTORISTA);

    expect(etaA).not.toBeNull();
    expect(etaB).not.toBeNull();
    expect(etaC).not.toBeNull();
    expect(etaA!).toBeLessThanOrEqual(etaB!);
    expect(etaB!).toBeLessThanOrEqual(etaC!);
    expect(etaA!).toBeLessThanOrEqual(etaC!);
  });

  it('a 2ª/3ª parada carregam a perna anterior MAIS o serviço (não a posição isolada)', () => {
    const etaA = minutosAteParada(TRES, 'a', MOTORISTA)!;
    const etaB = minutosAteParada(TRES, 'b', MOTORISTA)!;
    const etaC = minutosAteParada(TRES, 'c', MOTORISTA)!;
    // B = A + serviço + perna(A→B); C = B + serviço + perna(B→C). Tudo estritamente para cima.
    expect(etaB).toBeGreaterThan(etaA + SERVICO);
    expect(etaC).toBeGreaterThan(etaB + SERVICO);
    // E nada de o número da 3ª parada voltar ao da linha reta isolada.
    expect(etaC).toBeGreaterThan(minutesToStop(MOTORISTA, C)!);
  });

  it('as pernas gravadas pelo Optimize continuam mandando quando existem', () => {
    const comPernas: Parada[] = [
      parada({ id: 'a', sequence: 1, travelSeconds: 600 }),
      parada({ id: 'b', sequence: 2, travelSeconds: 900 }),
      parada({ id: 'c', sequence: 3, travelSeconds: 300 }),
    ];
    // 10 + 3 + 15 = 28; 10 + 3 + 15 + 3 + 5 = 36 — o mesmo contrato de antes.
    expect(minutosAteParada(comPernas, 'b', MOTORISTA)).toBe(28);
    expect(minutosAteParada(comPernas, 'c', MOTORISTA)).toBe(36);
    expect(minutosAteParadaPorRota(comPernas, 'c')).toBe(36);
  });

  it('na ordem da ENTREGA a acumulação usa a perna da entrega e segue crescente', () => {
    const tarde: Parada[] = [
      parada({ id: 'a', sequence: 1, dropoffSequence: 1, status: 'completed', dropoffTravelSeconds: 600 }),
      parada({ id: 'b', sequence: 2, dropoffSequence: 2, status: 'completed', dropoffTravelSeconds: 900 }),
      parada({ id: 'c', sequence: 3, dropoffSequence: 3, status: 'completed', dropoffTravelSeconds: 300 }),
    ];
    // dropoff 1 → 2 → 3: 10 ; 10+3+15 ; 10+3+15+3+5.
    expect(minutosAteParada(tarde, 'a', MOTORISTA)).toBe(10);
    expect(minutosAteParada(tarde, 'b', MOTORISTA)).toBe(28);
    expect(minutosAteParada(tarde, 'c', MOTORISTA)).toBe(36);
  });
});

describe('(b) a mensagem do Notify owner leva o número acumulado', () => {
  const REF = new Date(2026, 9, 2, 8, 0); // 02/10/2026 08:00 (hora do dono)
  const base = { clientName: 'Tutor', driverName: 'Rafael', phase: 'pickup' as const, now: REF };

  it('a faixa da 3ª parada é a ACUMULADA (10:15–10:45) e não a da posição isolada (8:25–8:55)', () => {
    const minutesC = minutosAteParada(TRES, 'c', MOTORISTA)!;
    const texto = etaMessageText({ ...base, dogName: 'Luna', minutes: minutesC });

    // O número acumulado (139 → 140 arredondado) coloca a faixa às 10:15.
    expect(texto).toContain('between 10:15 –10:45 AM to pick up Luna');
    // A conta ANTIGA (posição isolada, ~27 → 30) diria 8:25 — o defeito que o dono ouviu.
    const posicaoIsolada = minutesToStop(MOTORISTA, C)!;
    expect(texto).not.toContain(windowLabel(avisoWindow({ now: REF, minutes: posicaoIsolada, phase: 'pickup' })));
  });

  it('as faixas das 3 paradas avançam na ordem da rota', () => {
    const janelas = TRES.map((stop) => {
      const minutes = minutosAteParada(TRES, stop.id, MOTORISTA)!;
      return avisoWindow({ now: REF, minutes, phase: 'pickup' });
    });
    expect(janelas[0].inicioMin).toBeLessThanOrEqual(janelas[1].inicioMin);
    expect(janelas[1].inicioMin).toBeLessThanOrEqual(janelas[2].inicioMin);
    expect(janelas[0].fimMin).toBeLessThanOrEqual(janelas[2].fimMin);
    // E nenhuma faixa "anda para trás": a 3ª nunca começa antes da 2ª.
    expect(janelas[2].inicioMin).toBeGreaterThanOrEqual(janelas[1].inicioMin);
  });

  it('o texto da 2ª e da 3ª mantêm a ordem (8ª > 7ª no exemplo real do dono)', () => {
    const mB = minutosAteParada(TRES, 'b', MOTORISTA)!;
    const mC = minutosAteParada(TRES, 'c', MOTORISTA)!;
    const tB = etaMessageText({ ...base, dogName: 'Mowgli', minutes: mB });
    const tC = etaMessageText({ ...base, dogName: 'Luna', minutes: mC });
    // A faixa da 3ª tem de ser posterior à da 2ª (nunca "8 e 4" vindo depois de "8 e 10").
    const wB = avisoWindow({ now: REF, minutes: mB, phase: 'pickup' });
    const wC = avisoWindow({ now: REF, minutes: mC, phase: 'pickup' });
    expect(wC.inicioMin).toBeGreaterThanOrEqual(wB.inicioMin);
    expect(tB).toContain(windowLabel(wB));
    expect(tC).toContain(windowLabel(wC));
  });
});

describe('(c) com janela/deadline a ordem continua coerente', () => {
  it('o atraso projetado não decresce na ordem da rota', () => {
    const now = new Date(2026, 9, 2, 8, 0);
    const comPrazo: Parada[] = TRES.map((stop) => ({ ...stop, windowEnd: '08:00' }));
    const atrasos = comPrazo.map((stop) => {
      const minutes = minutosAteParada(comPrazo, stop.id, MOTORISTA)!;
      return lateMinutesForStop(stop, minutes, now);
    });
    expect(atrasos[0]).toBeLessThanOrEqual(atrasos[1]);
    expect(atrasos[1]).toBeLessThanOrEqual(atrasos[2]);
    expect(atrasos[0]).toBeGreaterThan(0); // todas passaram do prazo + tolerância
  });

  it('a projeção (agora + minutos) é crescente para as paradas', () => {
    const now = new Date(2026, 9, 2, 8, 0);
    const minutos = TRES.map((stop) => minutosAteParada(TRES, stop.id, MOTORISTA)!);
    const projecao = minutos.map((m) => now.getHours() * 60 + now.getMinutes() + m);
    expect(projecao[0]).toBeLessThan(projecao[1]);
    expect(projecao[1]).toBeLessThan(projecao[2]);
  });
});

describe('(d) sem posição do motorista cai na estimativa da rota (nunca zero inventado)', () => {
  it('com pernas gravadas e SEM posição: usa a rota e é > 0', () => {
    const comPernas: Parada[] = [
      parada({ id: 'a', sequence: 1, travelSeconds: 600 }),
      parada({ id: 'b', sequence: 2, travelSeconds: 900 }),
    ];
    const eta = nextStopEta(comPernas, null);
    expect(eta?.stopId).toBe('a');
    expect(eta?.temBase).toBe(true);
    expect(eta?.minutes).toBeGreaterThan(0);

    const ateB = minutosAteParada(comPernas, 'b', null);
    expect(ateB).not.toBeNull();
    expect(ateB).toBe(28); // 10 + 3 + 15, sem depender de posição
  });

  it('sem pernas E sem posição: null / temBase false — nunca zero como se fosse chegada', () => {
    expect(minutosAteParada(TRES, 'a', null)).toBeNull();
    expect(minutosAteParadaPorRota(TRES, 'c')).toBeNull();

    const eta = nextStopEta(TRES, null);
    expect(eta?.temBase).toBe(false);
    expect(eta?.minutes).toBe(0);
  });
});
