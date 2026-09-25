/**
 * Folha do aviso de ETA ao tutor (SMS) — pedido do cliente (16/09/2026).
 *
 * O texto vai PRONTO e editável no mensageiro do motorista: nada é disparado pelo app
 * ("sem ser pelo Twilio, sem ser um disparo").
 *
 * Ajuste da operação (25/09/2026): o WhatsApp saiu da interface ("a gente sempre usa Messenger
 * aqui") e, com UM mensageiro só, o app nem abre esta folha — ela é a rede de segurança para o
 * dia em que houver mais de um mensageiro (ver messengerChoiceNeeded). A mensagem de exemplo
 * abaixo é a nova, em faixa de horário.
 */
import { fireEvent, render } from '@testing-library/react-native';

import { NotifyOwnerSheet } from '@/features/driver/NotifyOwnerSheet';

describe('NotifyOwnerSheet', () => {
  const telefone = '+1 415 555 0134';
  const mensagem = "Good morning, Maria! This is Alex from Pack & Paws Club. I'll be there between 9:00 and 9:30 AM to pick up Thor. Looking forward to another great day with them! 🐶🐾";

  it('mostra o texto que vai ser enviado antes de escolher', async () => {
    const tela = await render(<NotifyOwnerSheet visible phone={telefone} message={mensagem} onChoose={jest.fn()} onClose={jest.fn()} />);
    expect(tela.getByText(mensagem)).toBeTruthy();
    expect(tela.getByText(/\+1 415 555 0134/)).toBeTruthy();
  });

  it('escolher SMS devolve sms', async () => {
    const onChoose = jest.fn();
    const tela = await render(<NotifyOwnerSheet visible phone={telefone} message={mensagem} onChoose={onChoose} onClose={jest.fn()} />);
    await fireEvent.press(tela.getByLabelText('Messages (SMS)'));
    expect(onChoose).toHaveBeenCalledWith('sms');
  });

  it('não oferece WhatsApp (removido da interface a pedido do cliente)', async () => {
    const tela = await render(<NotifyOwnerSheet visible phone={telefone} message={mensagem} onChoose={jest.fn()} onClose={jest.fn()} />);
    expect(tela.queryByLabelText('WhatsApp')).toBeNull();
    expect(tela.getByLabelText('Messages (SMS)')).toBeTruthy();
  });

  it('avisa quando o cliente não tem telefone (a folha é rede de segurança)', async () => {
    const tela = await render(<NotifyOwnerSheet visible phone="" message={mensagem} onChoose={jest.fn()} onClose={jest.fn()} />);
    expect(tela.getByText('Client without a phone number')).toBeTruthy();
  });
});
