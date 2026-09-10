import { fullNameOrFallback, isActiveStatus, memberStatusFromActive, memberStatusLabel } from '@/features/drivers/driversService';

describe('status do motorista', () => {
  it('ativo/desativado usa os valores do enum do banco', () => {
    expect(memberStatusFromActive(true)).toBe('active');
    expect(memberStatusFromActive(false)).toBe('disabled');
  });

  it('só "active" conta como ativo (convite pendente não é ativo)', () => {
    expect(isActiveStatus('active')).toBe(true);
    expect(isActiveStatus('invited')).toBe(false);
    expect(isActiveStatus('disabled')).toBe(false);
    expect(isActiveStatus(null)).toBe(false);
  });

  it('mostra rótulo legível para cada estado', () => {
    expect(memberStatusLabel('active')).toBe('Active');
    expect(memberStatusLabel('invited')).toBe('Invite pending');
    expect(memberStatusLabel('disabled')).toBe('Disabled');
  });

  it('nunca mostra nome vazio', () => {
    expect(fullNameOrFallback('  ')).toBe('Driver');
    expect(fullNameOrFallback('Rafael')).toBe('Rafael');
  });
});
