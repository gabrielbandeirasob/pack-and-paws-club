import { clockOf, packProgress, progressRows, progressSummary, stopIsDone, stopStatusLabel, totalPack } from '@/features/dashboard/packProgress';

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
    const iso = '2026-09-22T14:35:00.000Z';
    const esperado = new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).slice(0, 5);
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
