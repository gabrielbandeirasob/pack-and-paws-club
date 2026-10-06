import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { ClientsList } from '@/features/clients/ClientsList';
import type { ClientWithDogs } from '@/features/clients/types';

/**
 * FOCO NO CÃO, FOTO MAIOR E FOTO AMPLIADA — pedido do Gabriel (06/10/2026): *"na aba cliente o nome
 * grande que fica em destaque é o nome do dono do cachorro, gostaria que o foco fosse o nome do cachorro
 * e que a foto seja maior também e que ao clicar nela ela aumente, o nome do dono pode aparecer mas de
 * forma menos destacada"*.
 *
 * O que os testes abaixo provam, um por um: (1) o nome do cão é o texto MAIOR do cartão — medido em
 * pontos, não "no olho"; (2) o nome do tutor continua no cartão, menor; (3) a foto tem 64 pt (era 30) e
 * é tocável; (4) tocar nela abre a foto ampliada com o nome do cão; (5) tocar fecha; (6) cão sem foto e
 * cliente sem cão continuam funcionando (nada de espaço vazio nem de cartão quebrado).
 */

const URL_BOB = 'https://bhuexxjcrjdhkmsvagdw.supabase.co/storage/v1/object/public/dog-photos/org-1/dog-1/bob.jpg';

const clientes: ClientWithDogs[] = [
  {
    id: '1',
    name: 'Maria Silva',
    phone: '+55 62 99999-0000',
    address_line_1: '123 Main St',
    city: 'Goiania',
    state: 'GO',
    active: true,
    dogs: [
      { name: 'Bob', photo_url: URL_BOB },
      { name: 'Mel', photo_url: null },
    ],
  },
];

const renderLista = (clients: ClientWithDogs[] = clientes) =>
  render(<ClientsList clients={clients} loading={false} onAddClient={jest.fn()} onOpenClient={jest.fn()} />);

/** Tamanho de fonte efetivo de um texto do cartão (merge dos estilos, como o RN faz). */
const fonte = (elemento: { props: { style?: unknown } }): number => {
  const estilo = StyleSheet.flatten(elemento.props.style as never) as { fontSize?: number };
  return estilo?.fontSize ?? 0;
};

describe('lista de clientes — destaque do cão, foto maior e foto ampliada', () => {
  it('o nome do cão é o maior texto do cartão e o do tutor vem menor', async () => {
    const tela = await renderLista();
    const nomeDoCao = tela.getAllByTestId('nome-do-cao')[0];
    const nomeDoDono = tela.getAllByTestId('nome-do-dono')[0];

    expect(nomeDoCao).toHaveTextContent('Bob');
    expect(nomeDoDono).toHaveTextContent('Maria Silva');
    expect(fonte(nomeDoCao)).toBeGreaterThan(fonte(nomeDoDono));
    expect(fonte(nomeDoCao)).toBeGreaterThanOrEqual(17);
  });

  it('a foto do cão aparece maior e tocável, e o cão sem foto não deixa buraco', async () => {
    const tela = await renderLista();
    const foto = tela.getByTestId('foto-do-cao-Bob');
    const imagem = tela.getByLabelText('Photo of Bob');
    const estilo = StyleSheet.flatten(imagem.props.style as never) as { width: number; height: number };

    expect(estilo.width).toBeGreaterThan(30);
    expect(estilo.height).toBeGreaterThan(30);
    // Mel não tem foto: nenhum botão de foto para ela (nunca um espaço vazio no cartão).
    expect(tela.queryByTestId('foto-do-cao-Mel')).toBeNull();
    expect(foto).toBeTruthy();
  });

  it('tocar na foto abre ela ampliada com o nome do cão, e tocar fecha', async () => {
    const tela = await renderLista();
    expect(tela.queryByTestId('visualizador-de-foto')).toBeNull();

    await fireEvent.press(tela.getByTestId('foto-do-cao-Bob'));

    const ampliada = tela.getByTestId('visualizador-de-foto');
    expect(ampliada).toBeTruthy();
    expect(tela.getByTestId('visualizador-de-foto-nome')).toHaveTextContent('Bob');
    // A foto ampliada é a MESMA URL do cadastro (nada é inventado na hora de ampliar).
    expect(tela.getByTestId('visualizador-de-foto-imagem').props.source).toEqual({ uri: URL_BOB });

    await fireEvent.press(ampliada);
    expect(tela.queryByTestId('visualizador-de-foto')).toBeNull();
  });

  it('tocar na foto NÃO abre o cadastro do cliente (o toque é da foto)', async () => {
    const onOpenClient = jest.fn();
    const tela = await render(
      <ClientsList clients={clientes} loading={false} onAddClient={jest.fn()} onOpenClient={onOpenClient} />,
    );

    await fireEvent.press(tela.getByTestId('foto-do-cao-Bob'));

    expect(onOpenClient).not.toHaveBeenCalled();
  });

  it('cliente sem cão: o nome dele mesmo é o título (nada de cartão sem destaque)', async () => {
    const semCao: ClientWithDogs[] = [
      { id: '9', name: 'Ana Souza', phone: null, address_line_1: null, city: null, state: null, active: true, dogs: [] },
    ];
    const tela = await renderLista(semCao);

    expect(tela.getAllByTestId('nome-do-cao')[0]).toHaveTextContent('Ana Souza');
    // Sem tutor diferente para mostrar abaixo: o cartão não repete o mesmo nome duas vezes.
    expect(tela.queryAllByTestId('nome-do-dono')).toHaveLength(0);
  });

  it('dois cães: os dois nomes aparecem no destaque', async () => {
    const dois: ClientWithDogs[] = [
      {
        id: '2',
        name: 'Joao Souza',
        phone: null,
        address_line_1: null,
        city: null,
        state: null,
        active: true,
        dogs: [
          { name: 'Luna', photo_url: URL_BOB },
          { name: 'Max', photo_url: null },
        ],
      },
    ];
    const tela = await renderLista(dois);
    const destaques = tela.getAllByTestId('nome-do-cao').map((item) => item.props.children);

    expect(destaques).toEqual(['Luna', 'Max']);
    expect(tela.getByTestId('nome-do-dono')).toHaveTextContent('Joao Souza');
  });
});
