/**
 * Regras de status do motorista (puras, testaveis).
 * O banco usa o enum member_status: invited | active | disabled.
 */
export type MemberStatus = 'invited' | 'active' | 'disabled';

export function memberStatusFromActive(isActive: boolean): MemberStatus {
  return isActive ? 'active' : 'disabled';
}

export function isActiveStatus(status: string | null | undefined): boolean {
  return status === 'active';
}

export function memberStatusLabel(status: string | null | undefined): string {
  if (status === 'active') return 'Active';
  if (status === 'invited') return 'Invite pending';
  if (status === 'disabled') return 'Disabled';
  return 'Unknown';
}

export function fullNameOrFallback(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Driver';
}
