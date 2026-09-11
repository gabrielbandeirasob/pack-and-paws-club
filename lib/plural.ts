/**
 * Concordancia simples em ingles ("1 driver" / "2 drivers").
 * O painel mostrava "1 drivers" — pequeno, mas aparece na tela o dia inteiro.
 */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
