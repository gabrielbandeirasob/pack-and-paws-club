/**
 * Busca e agrupamento dos caes no seletor do agendamento.
 *
 * Antes o seletor era uma pilha de botoes — com muitos caes virava uma parede e nao tinha
 * busca. Aqui ficam as funcoes puras (dá para testar sem renderizar nada): normalizar o
 * texto para busca (o dado real tem acento: "Filó", "Dygão", "Rogério"), filtrar por nome do
 * cao OU do cliente, e agrupar por cliente.
 */
import type { DogRef } from '@/features/calendar/dayMath';

/** Minusculas e sem acento, para "dyg" achar "Dygão" e "filo" achar "Filó". */
export function semAcento(texto: string): string {
  const mapa: Record<string, string> = {
    á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a',
    é: 'e', è: 'e', ê: 'e', ë: 'e',
    í: 'i', ì: 'i', î: 'i', ï: 'i',
    ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
    ú: 'u', ù: 'u', û: 'u', ü: 'u',
    ç: 'c', ñ: 'n',
  };
  return texto
    .toLowerCase()
    .split('')
    .map((letra) => mapa[letra] ?? letra)
    .join('')
    .trim();
}

/** Filtra por nome do cao ou do cliente (sem acento, sem maiuscula). Termo vazio = todos. */
export function filtrarCaes(caes: DogRef[], termo: string): DogRef[] {
  const busca = semAcento(termo ?? '');
  if (!busca) return caes;
  return caes.filter((cao) => semAcento(`${cao.dogName} ${cao.clientName}`).includes(busca));
}

export type GrupoDeCaes = { cliente: string; caes: DogRef[] };

/** Agrupa por cliente (ordem alfabetica) mantendo os caes em ordem dentro do grupo. */
export function agruparPorCliente(caes: DogRef[]): GrupoDeCaes[] {
  const mapa = new Map<string, DogRef[]>();
  for (const cao of caes) {
    const chave = cao.clientName?.trim() || 'Sem cliente';
    const lista = mapa.get(chave) ?? [];
    lista.push(cao);
    mapa.set(chave, lista);
  }
  return [...mapa.entries()]
    .map(([cliente, lista]) => ({
      cliente,
      caes: [...lista].sort((a, b) => a.dogName.localeCompare(b.dogName)),
    }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
}

/** Texto do resumo: "8 dogs" / "2 of 8 dogs" quando ha busca ativa. */
export function resumoDaBusca(total: number, encontrados: number, termo: string): string {
  if (!termo?.trim()) return `${total} ${total === 1 ? 'dog' : 'dogs'}`;
  return `${encontrados} of ${total} ${total === 1 ? 'dog' : 'dogs'}`;
}
