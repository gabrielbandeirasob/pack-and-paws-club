import { fireEvent, render } from '@testing-library/react-native';

import { NotifyOwnerSheet } from '@/features/driver/NotifyOwnerSheet';

/**
 * Folha do aviso de ETA ao tutor (SMS / WhatsApp) — pedido do cliente (16/09/2026).
 *
 * O texto vai PRONTO e editável no mensageiro do motorista: nada é disparado pelo app
 * ("sem ser pelo Twilio, sem ser um disparo").
 */
describe('NotifyOwnerSheet', () => {
  const telefone = '+1 415 555 0134';
  const mensagem = "Hi Maria! I'm on my way to pick up Thor — about 15 minutes away.";

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

  it('escolher WhatsApp devolve whatsapp', async () => {
    const onChoose = jest.fn();
    const tela = await render(<NotifyOwnerSheet visible phone={telefone} message={mensagem} onChoose={onChoose} onClose={jest.fn()} />);
    await fireEvent.press(tela.getByLabelText('WhatsApp'));
    expect(onChoose).toHaveBeenCalledWith('whatsapp');
  });

  it('avisa quando o cliente não tem telefone (a folha é rede de segurança)', async () => {
    const tela = await render(<NotifyOwnerSheet visible phone="" message={mensagem} onChoose={jest.fn()} onClose={jest.fn()} />);
    expect(tela.getByText('Client without a phone number')).toBeTruthy();
  });
});
