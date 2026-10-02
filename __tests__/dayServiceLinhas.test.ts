/**
 * VISTORIA (02/10/2026) — ESCRITAS DO DIA (to-do e carga) QUE NÃO CONFERIAM LINHAS.
 *
 * Com RLS/policy, o PostgREST devolve SUCESSO com ZERO linha: a caixinha do to-do aparecia marcada,
 * o texto salvo e o item apagado — e a opção do pack aparecia aplicada — sem o banco ter mudado nada.
 * Agora 0 linha = ERRO (as telas já avisam o gestor); 1 linha salva normalmente.
 */
import {
  removeTodo,
  saveDayPlan,
  setPackFlag,
  setTodoDone,
  updateTodoText,
} from '@/features/dashboard/dayService';

/** Cliente Supabase falso: toda escrita termina em `.select('id')`, que devolve o resultado combinado. */
function clienteFalso(resultado: { data: unknown; error?: unknown }) {
  const select = jest.fn().mockResolvedValue({ data: resultado.data, error: resultado.error ?? null });
  const eq = jest.fn().mockReturnValue({ select });
  const chain = {
    update: jest.fn(() => ({ eq })),
    delete: jest.fn(() => ({ eq })),
    upsert: jest.fn(() => ({ select })),
  };
  return { client: { from: jest.fn(() => chain) } as never, chain };
}

describe('to-do do dia confere a linha', () => {
  it('marcar feito: 0 linha = ERRO', async () => {
    const { client } = clienteFalso({ data: [] });
    await expect(setTodoDone(client, 't1', true)).rejects.toThrow(/Could not save this to-do/);
  });

  it('marcar feito: 1 linha salva', async () => {
    const { client } = clienteFalso({ data: [{ id: 't1' }] });
    await expect(setTodoDone(client, 't1', true)).resolves.toBeUndefined();
  });

  it('editar o texto: 0 linha = ERRO', async () => {
    const { client } = clienteFalso({ data: [] });
    await expect(updateTodoText(client, 't1', 'Trocar a água')).rejects.toThrow(/Could not save this to-do/);
  });

  it('apagar o item: 0 linha = ERRO', async () => {
    const { client } = clienteFalso({ data: [] });
    await expect(removeTodo(client, 't1')).rejects.toThrow(/Could not delete this to-do/);
  });

  it('erro do servidor estoura com a mensagem original', async () => {
    const { client } = clienteFalso({ data: null, error: { message: 'permission denied' } });
    await expect(setTodoDone(client, 't1', true)).rejects.toThrow('permission denied');
  });
});

describe('fechamento do dia e pack ("carga") conferem a linha', () => {
  it('salvar o dia (upsert) com 0 linha = ERRO (a tela mostrava "Saved")', async () => {
    const { client } = clienteFalso({ data: [] });
    await expect(saveDayPlan(client, { organizationId: 'org', day: '2026-10-02', revenueCents: 1234 }))
      .rejects.toThrow(/Could not save the day plan/);
  });

  it('salvar o dia com 1 linha salva', async () => {
    const { client } = clienteFalso({ data: [{ id: 'p1' }] });
    await expect(saveDayPlan(client, { organizationId: 'org', day: '2026-10-02', revenueCents: 1234 })).resolves.toBeUndefined();
  });

  it('marcar o pack (upsert) com 0 linha = ERRO', async () => {
    const { client } = clienteFalso({ data: [] });
    await expect(setPackFlag(client, { organizationId: 'org', day: '2026-10-02', dogId: 'd1', inPack: false }))
      .rejects.toThrow(/Could not save the pack/);
  });
});
