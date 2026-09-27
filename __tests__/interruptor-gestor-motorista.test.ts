/**
 * INTERRUPTOR GESTOR ↔ MOTORISTA (áudio do dono, 27/09/2026) — a parte pura.
 *
 * O que se prova aqui é a regra de MÃO ÚNICA e a persistência local, sem React:
 *  * só gestor pode forçar a visão de motorista (motorista não vira gestor por um toque);
 *  * sem vínculo não há visão nenhuma (a tela mostra o "sem acesso" em vez de inventar papel);
 *  * a escolha fica no aparelho — quem dirige todo dia não troca de novo a cada abertura.
 */
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import {
  esquecerVisaoAtiva,
  lerVisaoAtiva,
  podeAlternarVisao,
  salvarVisaoAtiva,
  visaoEfetiva,
} from '@/features/auth/activeRoleStore';

const store = SecureStore as jest.Mocked<typeof SecureStore>;

beforeEach(() => {
  jest.clearAllMocks();
  esquecerVisaoAtiva();
});

describe('visaoEfetiva', () => {
  it('gestor sem escolha vê o painel do gestor', () => {
    expect(visaoEfetiva('manager', null)).toBe('manager');
    expect(visaoEfetiva('manager', 'manager')).toBe('manager');
  });

  it('gestor que ligou o interruptor vê o app do motorista', () => {
    expect(visaoEfetiva('manager', 'driver')).toBe('driver');
  });

  it('MÃO ÚNICA: motorista nunca vira gestor pelo interruptor', () => {
    expect(visaoEfetiva('driver', 'manager')).toBe('driver');
    expect(visaoEfetiva('driver', 'driver')).toBe('driver');
  });

  it('sem vínculo não há visão (nada de inventar papel)', () => {
    expect(visaoEfetiva(null, 'driver')).toBeNull();
  });
});

describe('podeAlternarVisao', () => {
  it('só o gestor tem o interruptor', () => {
    expect(podeAlternarVisao('manager')).toBe(true);
    expect(podeAlternarVisao('driver')).toBe(false);
    expect(podeAlternarVisao(null)).toBe(false);
  });
});

describe('persistência da escolha', () => {
  it('salva e lê a escolha do aparelho', async () => {
    store.getItemAsync.mockResolvedValue('driver');
    await expect(lerVisaoAtiva()).resolves.toBe('driver');
    expect(store.getItemAsync).toHaveBeenCalledWith('packpaws.visaoAtiva.v1');
  });

  it('valor estranho no cofre não é aceito como escolha', async () => {
    store.getItemAsync.mockResolvedValue('qualquer coisa');
    await expect(lerVisaoAtiva()).resolves.toBeNull();
  });

  it('voltar para a visão de gestor apaga a marca', async () => {
    await salvarVisaoAtiva('manager');
    expect(store.setItemAsync).toHaveBeenCalledWith('packpaws.visaoAtiva.v1', 'manager');
    await salvarVisaoAtiva(null);
    expect(store.deleteItemAsync).toHaveBeenCalledWith('packpaws.visaoAtiva.v1');
  });

  it('sem SecureStore (web/testes) a escolha vive na memória e nada quebra', async () => {
    store.getItemAsync.mockRejectedValue(new Error('sem cofre'));
    store.setItemAsync.mockRejectedValue(new Error('sem cofre'));
    await salvarVisaoAtiva('driver');
    await expect(lerVisaoAtiva()).resolves.toBe('driver');
  });
});
