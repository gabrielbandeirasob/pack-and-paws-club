import { RouteSummary } from '@/features/driver/RouteSummary';
import { fireEvent, render } from '@testing-library/react-native';
import { DriverRouteView, type DriverStop } from '@/features/driver/DriverRouteView';

const stops: DriverStop[] = [
  { id: 'stop-1', sequence: 1, status: 'pending', clientName: 'Maria', dogName: 'Bob', address: '123 Main St', city: 'Goiania', instructions: 'Call box 185. Key inside lockbox.' },
  { id: 'stop-2', sequence: 2, status: 'pending', clientName: 'John', dogName: 'Luna', address: 'Oak Avenue 45', city: 'Goiania', instructions: null },
];

describe('DriverRouteView', () => {
  it('keeps pickup and delivery milestones in their respective phases', async () => {
    const completed: DriverStop[] = [{
      ...stops[0], status: 'completed',
      arrivedAt: new Date(2026, 9, 2, 8, 28).toISOString(),
      completedAt: new Date(2026, 9, 2, 8, 28).toISOString(),
      deliveredAt: new Date(2026, 9, 2, 14, 46).toISOString(),
    }];
    const screen = await render(<DriverRouteView stops={completed} fase="pickup" onAction={jest.fn()} />);
    expect(screen.getByText('arrived 8:28 AM · done 8:28 AM')).toBeTruthy();
    expect(screen.queryByText(/delivered /i)).toBeNull();
    await screen.rerender(<DriverRouteView stops={completed} fase="dropoff" onAction={jest.fn()} />);
    expect(screen.queryByText(/arrived 8:28|done 8:28/)).toBeNull();
    expect(screen.getByText('delivered 2:46 PM')).toBeTruthy();
    expect(screen.getByText('Delivered at 2:46 PM')).toBeTruthy();
  });

  // AVISO DE ETA AO TUTOR (pedido do cliente em áudio, 16/09/2026): o motorista avisa com o
  // texto pronto. O botão só existe quando o cliente tem telefone e a parada ainda está viva.
  it('avisa o tutor com o ETA da parada', async () => {
    const onNotifyOwner = jest.fn();
    const comTelefone: DriverStop[] = [{ ...stops[0], clientPhone: '+1 415 555 0134', etaMinutes: 12 }];
    const tela = await render(<DriverRouteView stops={comTelefone} onAction={jest.fn()} onNotifyOwner={onNotifyOwner} />);

    expect(tela.getByText('~12 min away')).toBeTruthy();
    await fireEvent.press(tela.getByLabelText('Notify owner Bob'));
    expect(onNotifyOwner).toHaveBeenCalledWith(expect.objectContaining({ id: 'stop-1' }));
  });

  it('marca o aviso em âmbar quando a chegada atrasa', async () => {
    const atrasada: DriverStop[] = [{ ...stops[0], clientPhone: '+1 415 555 0134', etaMinutes: 20, lateMinutes: 10 }];
    const tela = await render(<DriverRouteView stops={atrasada} onAction={jest.fn()} onNotifyOwner={jest.fn()} />);

    expect(tela.getByText('Notify owner · late')).toBeTruthy();
    expect(tela.getByText('~20 min away · 10 min late')).toBeTruthy();
  });

  it('sem telefone do cliente não oferece o aviso', async () => {
    const semTelefone: DriverStop[] = [{ ...stops[0], etaMinutes: 12 }];
    const tela = await render(<DriverRouteView stops={semTelefone} onAction={jest.fn()} onNotifyOwner={jest.fn()} />);

    expect(tela.queryByLabelText('Notify owner Bob')).toBeNull();
  });

  /**
   * TRANSFERÊNCIA DE CÃO ENTRE MOTORISTAS (item 5 do documento do cliente, 25/09/2026 — migration 052):
   * o gestor passa um cão da rota de um motorista para a de outro no meio do dia ("por escolha do
   * chefe"). O cão chega com o histórico preservado e a tela diz DE QUEM ele veio e a hora; sem isso o
   * motorista não sabia se aquele cão era dele ou do colega.
   */
  it('mostra de quem o cão foi transferido e a hora', async () => {
    const transferido: DriverStop[] = [
      { ...stops[0], handedFromName: 'Jordan', handedAt: '2026-10-02T17:05:00.000Z' },
    ];
    const tela = await render(<DriverRouteView stops={transferido} onAction={jest.fn()} />);

    expect(tela.getByText(/^Received from Jordan · \d{1,2}:\d{2}/)).toBeTruthy();
  });

  it('sem transferência, a tela não fala em "Received from"', async () => {
    const tela = await render(<DriverRouteView stops={[stops[0]]} onAction={jest.fn()} />);

    expect(tela.queryByText(/Received from/)).toBeNull();
  });

  /**
   * ENTREGA (conferência do dono, 01/10/2026 — itens 2 e 5): o 2º toque ("Next") deixa a parada
   * `completed` com o cão NA VAN. Até aqui isso desabilitava o aviso ao tutor, e o motorista ficava sem
   * mandar a mensagem da ENTREGA — o cliente reclamou justamente disso. O aviso só desaparece quando a
   * entrega é confirmada (`deliveredAt`) ou a parada virou problema.
   */
  it('parada concluída COM entrega pendente ainda oferece o aviso (é a mensagem da tarde)', async () => {
    const naVan: DriverStop[] = [{ ...stops[0], status: 'completed', clientPhone: '+1 415 555 0134', etaMinutes: 5 }];
    const tela = await render(<DriverRouteView stops={naVan} onAction={jest.fn()} onNotifyOwner={jest.fn()} />);

    expect(tela.getByLabelText('Notify owner Bob')).toBeTruthy();
    expect(tela.getByText('In the van')).toBeTruthy();
  });

  it('parada ENTREGUE não oferece aviso (o dia dela acabou)', async () => {
    const entregue: DriverStop[] = [{
      ...stops[0], status: 'completed', clientPhone: '+1 415 555 0134', etaMinutes: 5,
      deliveredAt: '2026-10-01T21:05:00.000Z',
    }];
    const tela = await render(<DriverRouteView fase="dropoff" stops={entregue} onAction={jest.fn()} onNotifyOwner={jest.fn()} />);

    expect(tela.queryByLabelText('Notify owner Bob')).toBeNull();
    expect(tela.getByText('Delivered')).toBeTruthy();
    expect(tela.getByText(/Delivered at \d{1,2}:\d{2} (AM|PM)/)).toBeTruthy();
  });

  it('o toque da ENTREGA aparece para o cão que já está na van', async () => {
    const naVan: DriverStop[] = [{ ...stops[0], status: 'completed' }];
    const onAction = jest.fn().mockResolvedValue(undefined);
    const tela = await render(<DriverRouteView fase="pickup" stops={naVan} onAction={onAction} />);
    expect(tela.queryByRole('button', { name: 'Delivered Bob' })).toBeNull();
    await tela.rerender(<DriverRouteView fase="dropoff" stops={naVan} onAction={onAction} />);

    await fireEvent.press(tela.getByRole('button', { name: 'Delivered Bob' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'deliver');
  });

  it('mostra que o tutor já foi avisado, com a hora', async () => {
    const avisado: DriverStop[] = [{ ...stops[0], clientPhone: '+1 415 555 0134', etaNoticeAt: '2026-09-23T11:35:00.000Z' }];
    const tela = await render(<DriverRouteView stops={avisado} onAction={jest.fn()} />);

    expect(tela.getByText(/Owner notified at \d{2}:\d{2}/)).toBeTruthy();
  });
  it('lists ordered stops with dog, address and instructions', async () => {
    const screen = await render(<DriverRouteView stops={stops} onAction={jest.fn()} />);
    expect(screen.getByText('1. Bob')).toBeTruthy();
    expect(screen.getByText('123 Main St · Goiania')).toBeTruthy();
    expect(screen.getByText('Call box 185. Key inside lockbox.')).toBeTruthy();
    expect(screen.getByText('2. Luna')).toBeTruthy();
  });

  it('fires stop actions for the right stop', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<DriverRouteView stops={stops} onAction={onAction} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark arrived stop-1' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'arrived');
    await fireEvent.press(screen.getByRole('button', { name: 'Navigate to Bob' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'navigate');
  });

  it('fluxo de 2 toques na lista: "I arrived" e depois "Next" (pegou + concluiu juntos)', async () => {
    // Pedido do dono (30/09/2026): "I arrived e next. Talvez dois cliques" — o botão do meio
    // ("Dog picked up") saiu da lista; o 2º toque é 'finish' (grava os dois passos de uma vez).
    const onAction = jest.fn().mockResolvedValue(undefined);

    const pendente = await render(<DriverRouteView stops={[stops[0]]} onAction={onAction} />);
    expect(pendente.getByText('I arrived')).toBeTruthy();
    await fireEvent.press(pendente.getByRole('button', { name: 'Mark arrived stop-1' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'arrived');

    const chegou = await render(<DriverRouteView stops={[{ ...stops[0], status: 'arrived' }]} onAction={onAction} />);
    expect(chegou.getByText('Next')).toBeTruthy();
    await fireEvent.press(chegou.getByRole('button', { name: 'Next Bob' }));
    expect(onAction).toHaveBeenLastCalledWith('stop-1', 'finish');
    // O "Problem" continua na lista enquanto a parada está viva e continua pedindo o motivo.
    expect(chegou.getByRole('button', { name: 'Problem stop-1' })).toBeTruthy();
  });

  it('selo do cão que já foi pego é "In the van" (na van até a entrega)', async () => {
    // Regra única desde 01/10/2026: "In the van" = o cão está com o motorista (pego ou concluído) e
    // "Delivered" = entregue. O selo antigo ("Dog picked up"/"Completed") não dizia que faltava entregar.
    const progressed: DriverStop[] = [{ ...stops[0], status: 'picked_up' }];
    const screen = await render(<DriverRouteView stops={progressed} onAction={jest.fn()} />);
    expect(screen.getByText('In the van')).toBeTruthy();
  });

  it('depois do pick-up o selo vira "In the van" (o dia ainda não acabou)', async () => {
    // "Completed" às 9 da manhã num dia com 6 entregas pela frente é leitura errada — foi o que o
    // cliente viu junto com o ETA desaparecendo (conferência do dono, 01/10/2026).
    const concluida: DriverStop[] = [{ ...stops[0], status: 'completed' }];
    const screen = await render(<DriverRouteView stops={concluida} onAction={jest.fn()} />);
    expect(screen.getByText('In the van')).toBeTruthy();
    expect(screen.queryByText('Completed')).toBeNull();
  });

  it('mostra a foto do cao do cadastro na parada (e nada quando o cao nao tem foto)', async () => {
    // A foto do cadastro e o que confirma na porta que e o cachorro certo. Sem foto, nao
    // pode aparecer imagem quebrada.
    const comFoto: DriverStop[] = [
      { ...stops[0], dogPhotoUrl: 'https://bhuexxjcrjdhkmsvagdw.supabase.co/storage/v1/object/public/dog-photos/org-1/dog-1/bob.jpg' },
    ];
    const comImagem = await render(<DriverRouteView stops={comFoto} onAction={jest.fn()} />);
    const foto = comImagem.getByLabelText('Photo of Bob');
    expect(foto).toBeTruthy();
    // A miniatura da LISTA (46 pt) vem da transformação do Storage, não da foto original
    // (auditoria de desempenho, 02/10/2026).
    expect(foto.props.source.uri).toContain('/storage/v1/render/image/public/');

    const semImagem = await render(<DriverRouteView stops={[stops[1]]} onAction={jest.fn()} />);
    expect(semImagem.queryByLabelText('Photo of Luna')).toBeNull();
  });

  it('numera as paradas pela posicao, mesmo se o banco trouxer sequence 0', async () => {
    // Visto no teste na web: a tela mostrava "0. <nome>" porque o sequence vinha 0
    // (o painel do Dispatch numerava 1, 2 — a tela do motorista usava o campo cru).
    const zerados: DriverStop[] = [
      { ...stops[0], sequence: 0 },
      { ...stops[1], sequence: 0 },
    ];
    const screen = await render(<DriverRouteView stops={zerados} onAction={jest.fn()} />);
    expect(screen.getByText('1. Bob')).toBeTruthy();
    expect(screen.getByText('2. Luna')).toBeTruthy();
    expect(screen.queryByText('0. Bob')).toBeNull();
  });

  it('parada concluida continua navegavel: o cartao e o botao levam ao mapa', async () => {
    // Relato do dono (12/09/2026): "rota apareceu mas ao clicar nao direciona a aplicativo algum".
    // Causa: com a parada em Completed/Skipped, TODOS os botoes ficavam atras de `!done` - inclusive
    // o Navigate - entao nao havia como abrir o mapa justamente quando o motorista quer reconferir.
    const onAction = jest.fn().mockResolvedValue(undefined);
    const feita: DriverStop[] = [{ ...stops[0], status: 'completed' }];
    const screen = await render(<DriverRouteView stops={feita} onAction={onAction} />);
    // O selo passou a dizer "In the van": `completed` é o fim da BUSCA, não do dia (01/10/2026).
    expect(screen.getByText('In the van')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Navigate to Bob' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'navigate');

    await fireEvent.press(screen.getByRole('button', { name: 'Open navigation for Bob' }));
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  /**
   * 🪤 VISTORIA (02/10/2026) — BECO SEM SAÍDA NA ENTREGA.
   *
   * Depois do 2º toque ("Next") a parada fica `completed` SEM `deliveredAt` e o botão "Problem" só
   * existia na CHEGADA (`arrived`). Se o tutor não estivesse em casa, o motorista só tinha "Delivered"
   * — a parada nunca fechava e o dia não acabava. Agora a ENTREGA expõe as DUAS saídas.
   */
  it('na ENTREGA (cão na van, sem deliveredAt) há DUAS saídas: Delivered e Problem', async () => {
    const naVan: DriverStop[] = [{ ...stops[0], status: 'completed' }];
    const onAction = jest.fn().mockResolvedValue(undefined);
    const tela = await render(<DriverRouteView fase="pickup" stops={naVan} onAction={onAction} />);
    expect(tela.queryByRole('button', { name: 'Delivered Bob' })).toBeNull();
    await tela.rerender(<DriverRouteView fase="dropoff" stops={naVan} onAction={onAction} />);

    await fireEvent.press(tela.getByRole('button', { name: 'Delivered Bob' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'deliver');
    await fireEvent.press(tela.getByRole('button', { name: 'Problem stop-1' }));
    expect(onAction).toHaveBeenCalledWith('stop-1', 'problem');
  });

  it('parada ENTREGUE não oferece mais o Problem (o dia dela acabou)', async () => {
    const entregue: DriverStop[] = [{ ...stops[0], status: 'completed', deliveredAt: '2026-10-01T21:05:00.000Z' }];
    const tela = await render(<DriverRouteView fase="dropoff" stops={entregue} onAction={jest.fn()} />);
    expect(tela.queryByRole('button', { name: 'Problem stop-1' })).toBeNull();
  });
});


it('resumo conta uma casa com dois cães só quando ambos terminam e separa entrega', async () => {
  const grupo: DriverStop[] = stops.map((stop, index) => ({ ...stop, groupId: 'casa', status: index === 0 ? 'completed' : 'pending' }));
  const tela = await render(<RouteSummary stops={grupo} fase="pickup" />);
  // Barra compacta de uma linha (redesenho de 05/10/2026): "0/1" no lugar de "0 of 1 completed".
  expect(tela.getByText('0/1')).toBeTruthy();
  const buscados: DriverStop[] = grupo.map(stop => ({ ...stop, status: 'completed' }));
  await tela.rerender(<RouteSummary stops={buscados} fase="pickup" />);
  expect(tela.getByText('1/1')).toBeTruthy();
  await tela.rerender(<RouteSummary stops={buscados} fase="dropoff" />);
  expect(tela.getByText('0/1')).toBeTruthy();
});
