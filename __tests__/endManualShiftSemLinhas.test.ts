/**
 * VISTORIA (02/10/2026) — CLOCK OUT (fechar jornada manual) TEM DE CONFERIR A LINHA.
 *
 * A jornada é o número que PAGA o motorista. Com a policy bloqueando, o PostgREST responde SUCESSO
 * com 0 linhas: o horário de saída nunca era gravado e a tela dizia "journey closed". Agora 0 linha
 * = ERRO (o chamador mostra o motivo) e 1 linha fecha normalmente.
 */
import { endManualShift } from '@/features/driver/shiftService';

/** Cliente Supabase falso: `from().update().eq().select()` devolve o resultado combinado. */
function clienteFalso(resultado: { data: unknown; error: unknown }) {
  const select = jest.fn().mockResolvedValue(resultado);
  const eq = jest.fn().mockReturnValue({ select });
  const update = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ update });
  return { client: { from } as never, from, update, eq, select };
}

describe('endManualShift confere a linha atingida', () => {
  it('0 linha (policy bloqueou) = FALHA, não "jornada fechada"', async () => {
    const { client, from } = clienteFalso({ data: [], error: null });
    await expect(endManualShift(client, { shiftId: 'sh1', reason: 'Fim do turno', endedAt: '2026-10-02T18:00:00Z' }))
      .rejects.toThrow(/Could not close this journey/);
    expect(from).toHaveBeenCalledWith('driver_shifts');
  });

  it('1 linha fecha normalmente', async () => {
    const { client } = clienteFalso({ data: [{ id: 'sh1' }], error: null });
    await expect(endManualShift(client, { shiftId: 'sh1', reason: 'Fim do turno' })).resolves.toBeUndefined();
  });

  it('erro do servidor estoura com a mensagem original', async () => {
    const { client } = clienteFalso({ data: null, error: { message: 'permission denied' } });
    await expect(endManualShift(client, { shiftId: 'sh1', reason: 'Fim' })).rejects.toThrow('permission denied');
  });
});
