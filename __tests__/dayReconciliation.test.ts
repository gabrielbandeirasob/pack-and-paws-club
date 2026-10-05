// Pedido do cliente (04/10/2026): calendário e Dispatch identificam apenas o cão; as asserções permanecem.
/**
 * DEFEITO A (03/10/2026) — regra pura da reconciliação Dispatch × reservas do dia.
 * A tela desenha as linhas a partir de `route_stops`; este módulo diz quais paradas NÃO estão mais no
 * dia confirmado (reserva cancelada/substituída) e monta o aviso do topo do cartão.
 */
import { SELO_PARADA_FORA_DO_DIA, avisoDeParadasForaDoDia, paradasForaDoDia } from '@/features/dispatch/dayReconciliation';

const dia = new Set(['dog-billy']);
const paradas = [
  { dogId: 'dog-enso', clientName: 'Akmal', dogName: 'Enso' },
  { dogId: 'dog-billy', clientName: 'Amy', dogName: 'Billy' },
];

it('devolve só as paradas que NÃO estão no dia', () => {
  expect(paradasForaDoDia(paradas, dia).map((p) => p.dogId)).toEqual(['dog-enso']);
});

it('o selo da linha está em inglês (item 9: o detalhe vive na parada)', () => {
  expect(SELO_PARADA_FORA_DO_DIA).toBe("Cancelled — removed from today's route");
});

it('monta o aviso no singular (contador compacto, um aviso por assunto)', () => {
  expect(avisoDeParadasForaDoDia(paradasForaDoDia(paradas, dia)))
    .toBe('⚠ 1 booking changed');
});

it('monta o aviso no plural', () => {
  const dois = [
    { dogId: 'a', clientName: 'Akmal', dogName: 'Enso' },
    { dogId: 'b', clientName: 'Sam', dogName: 'Ollie' },
  ];
  expect(avisoDeParadasForaDoDia(dois)).toBe('⚠ 2 bookings changed');
});

it('sem parada fora do dia, não há aviso', () => {
  expect(avisoDeParadasForaDoDia([])).toBeNull();
});
