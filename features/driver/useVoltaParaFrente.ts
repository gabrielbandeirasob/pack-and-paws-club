/**
 * RELER AO VOLTAR PARA A FRENTE (dono, 05/10/2026).
 *
 * Defeito relatado: *"ao mudar uma parada do driver pelo painel administrador a rota no driver não
 * atualiza automaticamente, o que gera confusão"*.
 *
 * São DOIS casos, e este arquivo cobre o segundo:
 *  1. o evento de DELETE não chegava — causa raiz no banco (`route_stops` sem `replica identity full`:
 *     o payload de DELETE manda só a chave, o filtro `route_id=eq.<rota>` não casa). Conserto na
 *     migração `202610050100_parada_removida_no_tempo_real.sql`;
 *  2. o app em SEGUNDO PLANO perde o canal de tempo real — tudo o que o gestor mexeu nesse meio-tempo
 *     não chega por evento nenhum. Ao voltar para a frente, a tela relê por baixo.
 *
 * Só dispara na TRANSIÇÃO para `active`: desligar a tela, atender ligação ou abrir a central de
 * controle NÃO pode virar recarga (bateria e dados do motorista, que fica com o app no bolso o dia
 * inteiro). Quem chama passa uma releitura SILENCIOSA, sem piscar a tela.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Regra pura: só quando o app PASSOU a estar na frente. */
export function deveReler(anterior: AppStateStatus, novo: AppStateStatus): boolean {
  return novo === 'active' && anterior !== 'active';
}

/** Reexecuta `aoVoltarParaFrente` a cada volta do app para a frente. */
export function useRelendoAoVoltarParaFrente(aoVoltarParaFrente: () => void): void {
  const anterior = useRef<AppStateStatus>(AppState.currentState);
  const callback = useRef(aoVoltarParaFrente);

  useEffect(() => {
    callback.current = aoVoltarParaFrente;
  }, [aoVoltarParaFrente]);

  useEffect(() => {
    const assinatura = AppState.addEventListener('change', (novo) => {
      if (deveReler(anterior.current, novo)) callback.current();
      anterior.current = novo;
    });
    return () => assinatura.remove();
  }, []);
}
