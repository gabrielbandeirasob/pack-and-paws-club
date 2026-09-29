/**
 * CÃES DA MESMA CASA — regra pedida pelo dono em áudio (29/09/2026).
 *
 * Caso real do calendário dele: **Sam** e **Ollie** são os dois cães do cliente Jose (56 Melrose Pl).
 * *"se eu mandar o Sam para um driver, o Oli vai para o mesmo driver… não faz sentido eu ter que clicar
 * duas vezes para a mesma casa"* — e, no segundo áudio, *"ele tem que reconhecer que são dois
 * cachorros"*: a contagem continua sendo de dois cães.
 */
import { irmaosDeCasa, juntarIrmaosDeCasa, nomesDosIrmaos, vaoJunto } from '@/features/dispatch/houseMates';

const CASA_JOSE = 'casa-jose';
const CASA_CHUCK = 'casa-chuck';
type CaoTest = { dogId: string; dogName: string; clientId: string | null; inVan?: boolean; houseMates?: string[] };
const fila: CaoTest[] = [
  { dogId: 'sam', dogName: 'Sam', clientId: CASA_JOSE },
  { dogId: 'ollie', dogName: 'Ollie', clientId: CASA_JOSE },
  { dogId: 'sammy', dogName: 'Sammy', clientId: CASA_CHUCK },
];

it('acha o irmão de casa do cão e não traz cão de outra casa', () => {
  expect(irmaosDeCasa(fila, 'sam').map((item) => item.dogId)).toEqual(['ollie']);
  expect(irmaosDeCasa(fila, 'sammy')).toEqual([]);
});

it('cão sem cliente (cadastro antigo) não agrupa nada', () => {
  const semCasa: CaoTest[] = [{ dogId: 'x', dogName: 'X', clientId: null }, { dogId: 'y', dogName: 'Y', clientId: null }];
  expect(irmaosDeCasa(semCasa, 'x')).toEqual([]);
  expect(vaoJunto(semCasa, 'x', new Set())).toEqual([]);
});

it('vai junto quem está sem motorista; quem o gestor já pôs em outro carro é respeitado', () => {
  expect(vaoJunto(fila, 'sam', new Set()).map((item) => item.dogId)).toEqual(['ollie']);
  expect(vaoJunto(fila, 'sam', new Set(['ollie']))).toEqual([]);
});

it('os dois cães continuam sendo DOIS cães na fila (nada é fundido)', () => {
  const marcada = juntarIrmaosDeCasa([...fila, { dogId: 'mel', dogName: 'Mel', clientId: 'casa-marcos', inVan: true }]);
  expect(marcada.map((item) => item.dogId)).toEqual(['sam', 'ollie', 'sammy', 'mel']);
  expect(marcada.find((item) => item.dogId === 'sam')?.houseMates).toEqual(['Ollie']);
  expect(marcada.find((item) => item.dogId === 'ollie')?.houseMates).toEqual(['Sam']);
  expect(marcada.find((item) => item.dogId === 'sammy')?.houseMates).toEqual([]);
});

it('cão que já está na van não conta como irmão da fila de pickup', () => {
  const comVan: CaoTest[] = [
    { dogId: 'sam', dogName: 'Sam', clientId: CASA_JOSE },
    { dogId: 'ollie', dogName: 'Ollie', clientId: CASA_JOSE, inVan: true },
  ];
  const marcada = juntarIrmaosDeCasa(comVan);
  // O que está na van fica como está (sem pickup para juntar) e não vira irmão de quem está na fila.
  expect(marcada.find((item) => item.dogId === 'ollie')?.houseMates).toBeUndefined();
  expect(nomesDosIrmaos(comVan.filter((item) => !item.inVan), 'sam')).toEqual([]);
});
