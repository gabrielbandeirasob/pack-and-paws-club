export const colors = {
  forest900: '#172B1D',
  forest700: '#203522',
  forest500: '#2D4630',
  gold: '#C7A75C',
  cream: '#F7F3E8',
  paper: '#FFFDF8',
  sage: '#DCE7D9',
  ink: '#1D281F',
  /**
   * Texto secundário (dica, legenda, "n min atrás").
   *
   * ⚠️ Escurecido em 02/10/2026 pela vistoria: o tom antigo (#718074) dava **3,76:1** sobre o creme e
   * **4,1:1** sobre o papel — abaixo do mínimo de 4,5:1 para texto pequeno (e este é usado em 11–12 px,
   * muito no celular do motorista, dentro da van e no sol). Este tom dá **4,91:1** no creme, 5,36:1 no
   * papel e 5,45:1 no branco. Mesma família de cor, só mais escuro.
   */
  muted: '#5F6D63',
  line: '#E6E0D2',
  /**
   * Erro / atenção (texto de falha, "late", problema).
   *
   * ⚠️ Escurecido em 02/10/2026: o tom antigo (#B85E4B) dava **4,0:1** sobre o creme — texto de ERRO
   * abaixo do mínimo de leitura. Este dá **4,78:1** no creme e 5,22:1 no papel.
   */
  urgency: '#AC5038',
  success: '#2F773D',
} as const;

export const radii = {
  small: 10,
  medium: 16,
  large: 22,
  hero: 30,
} as const;
