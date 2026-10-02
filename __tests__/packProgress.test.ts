import { clockOf, driverPerformance, packProgress, performanceSummary, progressRows, progressSummary, stopIsDone, stopStatusLabel, totalPack } from '@/features/dashboard/packProgress';

describe('Total Pack e progresso do dia', () => {
  const rotas = [
    {
      driverName: 'Rafael',
      status: 'published',
      stops: [
        { status: 'completed', dogName: 'Bella', at: '2026-09-22T12:05:00.000Z' },
        { status: 'picked_up', dogName: 'Thor', at: '2026-09-22T12:20:00.000Z' },
      ],
    },
    {
      driverName: 'Jordan',
      status: 'published',
      stops: [
        { status: 'skipped', dogName: 'Luna', at: null },
        { status: 'pending', dogName: 'Mel', at: null },
        { status: 'pending', dogName: 'Nina', at: null },
      ],
    },
  ];

  it('conta o Total Pack somando os cães de todas as rotas', () => {
    expect(totalPack(rotas)).toBe(5);
    expect(totalPack([])).toBe(0);
  });

  it('resume o que já foi concluído (concluído ou com problema conta como resolvido)', () => {
    expect(packProgress(rotas)).toEqual({ total: 5, done: 2, left: 3, routes: 2 });
  });

  it('mostra o texto do painel', () => {
    expect(progressSummary(rotas)).toBe('2 of 5 done');
    expect(progressSummary([])).toBe('Nothing scheduled for today');
  });

  it('traduz os estados dos pontos', () => {
    expect(stopStatusLabel('pending')).toBe('Waiting');
    expect(stopStatusLabel('arrived')).toBe('Arrived');
    expect(stopStatusLabel('picked_up')).toBe('Picked up');
    expect(stopStatusLabel('completed')).toBe('Completed');
    expect(stopStatusLabel('skipped')).toBe('Problem');
    expect(stopStatusLabel('qualquer coisa')).toBe('Waiting');
    expect(stopStatusLabel(null)).toBe('Waiting');
  });

  it('sabe o que é estado final', () => {
    expect(stopIsDone('completed')).toBe(true);
    expect(stopIsDone('skipped')).toBe(true);
    expect(stopIsDone('picked_up')).toBe(false);
    expect(stopIsDone(null)).toBe(false);
  });

  it('formata a hora da marcação no fuso local e tolera data vazia', () => {
    const iso = new Date(2026, 8, 22, 14, 35).toISOString();
    const esperado = '2:35 PM';
    expect(clockOf(iso)).toBe(esperado);
    expect(clockOf(null)).toBeNull();
    expect(clockOf('')).toBeNull();
    expect(clockOf('nao é data')).toBeNull();
  });

  it('monta as linhas da tela por rota', () => {
    const linhas = progressRows(rotas);
    expect(linhas).toHaveLength(2);
    expect(linhas[0].driverName).toBe('Rafael');
    expect(linhas[0].stops[0]).toEqual({ dogName: 'Bella', status: 'completed', statusLabel: 'Completed', at: clockOf('2026-09-22T12:05:00.000Z') });
    expect(linhas[1].stops[2]).toMatchObject({ dogName: 'Nina', statusLabel: 'Waiting', at: null });
  });
});

/**
 * DESEMPENHO POR MOTORISTA (pedido do dono, 30/09/2026): "a parada do administrador acompanhar o
 * desempenho de cada driver". Sai tudo do que a tela "Today's progress" JÁ carrega — e o atraso usa
 * a MESMA tolerância de 3 minutos do motorista (nada de segunda definição de "atrasado").
 */
describe('desempenho por motorista', () => {
  /** 30/09/2026 às 12:00 (hora LOCAL do teste) — o `now` entra por parâmetro, então é determinístico. */
  const agora = new Date(2026, 8, 30, 12, 0);
  const rota = {
    driverName: 'Rafael',
    status: 'published',
    stops: [
      { status: 'completed', dogName: 'Bella', at: '2026-09-30T14:05:00.000Z', windowEnd: '11:00' },
      { status: 'skipped', dogName: 'Luna', at: '2026-09-30T14:20:00.000Z', windowEnd: null },
      { status: 'pending', dogName: 'Mel', at: null, windowEnd: '11:58' }, // 2 min depois → tolerância
      { status: 'pending', dogName: 'Nina', at: null, exactTime: '11:56' }, // 4 min depois → atrasada
    ],
  };

  it('conta concluídas × total, problemas, última atualização e atraso', () => {
    const desempenho = driverPerformance(rota, agora);

    expect(desempenho.driverName).toBe('Rafael');
    expect(desempenho.total).toBe(4);
    expect(desempenho.done).toBe(2); // concluída + com problema (mesma definição de stopIsDone)
    expect(desempenho.problems).toBe(1);
    expect(desempenho.late).toBe(1); // só a de 4 min (a de 2 min está dentro da tolerância)
    expect(desempenho.lastUpdate).toBe(clockOf('2026-09-30T14:20:00.000Z'));
  });

  it('o atraso respeita a tolerância de 3 minutos (2 min depois do prazo não é atraso)', () => {
    const quaseAtrasada = { driverName: 'X', status: 'published', stops: [{ status: 'pending', dogName: 'A', at: null, windowEnd: '11:58' }] };
    const foraDoPrazo = { driverName: 'X', status: 'published', stops: [{ status: 'pending', dogName: 'A', at: null, windowEnd: '11:56' }] };
    expect(driverPerformance(quaseAtrasada, agora).late).toBe(0);
    expect(driverPerformance(foraDoPrazo, agora).late).toBe(1);
  });

  it('parada sem prazo nunca conta como atrasada, e rota vazia não inventa número', () => {
    const semPrazo = { driverName: 'X', status: 'published', stops: [{ status: 'pending', dogName: 'A', at: null }] };
    expect(driverPerformance(semPrazo, agora).late).toBe(0);
    expect(driverPerformance({ driverName: 'X', status: 'published', stops: [] }, agora)).toMatchObject({ total: 0, done: 0, problems: 0, late: 0, lastUpdate: null });
  });

  it('resume em uma linha o que o gestor lê no cartão', () => {
    expect(performanceSummary(driverPerformance(rota, agora))).toBe(
      `2 of 4 done · 1 problem · 1 late · last update ${clockOf('2026-09-30T14:20:00.000Z')}`,
    );
  });

  it('as linhas da tela levam o desempenho junto (mesma ordem das rotas)', () => {
    const linhas = progressRows([rota, { driverName: 'Jordan', status: 'draft', stops: [] }], agora);
    expect(linhas[0].performance).toEqual(driverPerformance(rota, agora));
    expect(linhas[1].performance.driverName).toBe('Jordan');
    expect(performanceSummary(linhas[1].performance)).toBe('0 of 0 done');
  });
});
