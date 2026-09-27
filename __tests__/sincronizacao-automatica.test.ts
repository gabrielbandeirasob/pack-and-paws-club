/**
 * SINCRONIZAÇÃO AUTOMÁTICA do Google Calendar (áudio do dono, 27/09/2026): "o cliente cancelou no
 * dia, ou um dia antes, dois dias antes… altera lá. Aí você vai ver no calendário vermelho".
 *
 * O gestor não deve precisar tocar em "Sync now" para ver o cancelamento. Aqui se prova a trava de
 * tempo (o que decide se sincroniza sozinho) — a metade sem relógio e sem armazenamento.
 */
import {
  JANELA_AUTO_MS,
  precisaSincronizar,
} from '@/features/integrations/google/lastSyncStore';

describe('precisaSincronizar', () => {
  const agora = 1_800_000_000_000;

  it('sem nenhuma sincronização antes, sincroniza', () => {
    expect(precisaSincronizar(null, JANELA_AUTO_MS, agora)).toBe(true);
  });

  it('logo depois de sincronizar, NÃO sincroniza de novo', () => {
    expect(precisaSincronizar(agora - 1_000, JANELA_AUTO_MS, agora)).toBe(false);
    expect(precisaSincronizar(agora - JANELA_AUTO_MS + 1, JANELA_AUTO_MS, agora)).toBe(false);
  });

  it('passada a trava, sincroniza', () => {
    expect(precisaSincronizar(agora - JANELA_AUTO_MS, JANELA_AUTO_MS, agora)).toBe(true);
    expect(precisaSincronizar(agora - 3 * JANELA_AUTO_MS, JANELA_AUTO_MS, agora)).toBe(true);
  });

  it('marca corrompida (NaN) não trava a sincronização para sempre', () => {
    expect(precisaSincronizar(Number.NaN, JANELA_AUTO_MS, agora)).toBe(true);
  });

  it('a trava padrão é de 10 minutos', () => {
    expect(JANELA_AUTO_MS).toBe(10 * 60 * 1000);
  });
});
