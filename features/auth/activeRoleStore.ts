/**
 * QUAL VISÃO O APP MOSTRA — o interruptor gestor ↔ motorista (áudio do dono, 27/09/2026):
 *
 * "todo administrador consegue ser, se ele quiser ou tiver necessidade de ser um driver, e na conta
 * do administrador ele consegue ter tipo um switch on and off que muda entre a dashboard do
 * administrador para a dashboard do driver, tipo o alarme do iPhone… porque o administrador também
 * faz os pick-ups e drop-off, então para o administrador não tem que ficar deslogando e logando".
 *
 * Regras que este módulo garante (e os testes travam):
 *  * o VÍNCULO não muda: quem é gestor continua gestor no banco; o interruptor troca só a VISÃO;
 *  * mão única: **só gestor** pode forçar a visão de motorista. Motorista NÃO vira gestor pelo
 *    interruptor (seria escalada de privilégio por um toque);
 *  * a escolha fica no APARELHO (SecureStore), então o gestor que dirige todo dia não precisa
 *    trocar de novo a cada abertura — e o outro gestor no celular dele não é afetado.
 */
import * as SecureStore from 'expo-secure-store';

export type ActiveView = 'manager' | 'driver';

const CHAVE = 'packpaws.visaoAtiva.v1';

/** Web/testes: sem SecureStore a escolha vive na memória (nada quebra). */
let memoria: ActiveView | null = null;
let leitura: Promise<ActiveView | null> | null = null;
let revisao = 0;
let escrita = Promise.resolve();
const ouvintes = new Set<() => void>();

export function assinarVisaoAtiva(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => { ouvintes.delete(ouvinte); };
}

export function obterVisaoAtiva(): ActiveView | null {
  return memoria;
}

function publicar(visao: ActiveView | null): void {
  memoria = visao;
  ouvintes.forEach((ouvinte) => ouvinte());
}

/**
 * Visão que o app deve mostrar, dado o papel real e a escolha guardada. Puro de propósito:
 * é aqui que mora a regra de mão única.
 */
export function visaoEfetiva(papel: 'manager' | 'driver' | null, escolhida: ActiveView | null): ActiveView | null {
  if (!papel) return null;
  if (papel === 'driver') return 'driver';
  return escolhida === 'driver' ? 'driver' : 'manager';
}

/** Quem pode ver o interruptor (só gestor). */
export function podeAlternarVisao(papel: 'manager' | 'driver' | null): boolean {
  return papel === 'manager';
}

export async function lerVisaoAtiva(): Promise<ActiveView | null> {
  if (!leitura) {
    const inicio = revisao;
    leitura = (async () => {
      try {
        const bruto = await SecureStore.getItemAsync(CHAVE);
        // Uma leitura antiga nunca desfaz um toque dado enquanto o cofre carregava.
        if (inicio === revisao && (bruto === 'driver' || bruto === 'manager')) publicar(bruto);
      } catch {
        // Web: mantém a escolha em memória quando o cofre não está disponível.
      }
      return memoria;
    })();
  }
  await leitura;
  return memoria;
}

export function salvarVisaoAtiva(visao: ActiveView | null): Promise<void> {
  revisao += 1;
  publicar(visao);
  // Mantém a ordem dos toques também no cofre, mesmo se a escrita demorar.
  escrita = escrita.then(async () => {
    try {
      if (visao) await SecureStore.setItemAsync(CHAVE, visao);
      else await SecureStore.deleteItemAsync(CHAVE);
    } catch {
      // Web/testes: a memória acima já serve.
    }
  });
  return escrita;
}

/** Só para os testes: zera a escolha em memória. */
export function esquecerVisaoAtiva(): void {
  revisao += 1;
  leitura = null;
  publicar(null);
}
