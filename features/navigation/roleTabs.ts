export type UserRole = 'manager' | 'driver';

export type RoleTab = {
  route: string;
  label: string;
  icon: string;
};

const managerTabs: readonly RoleTab[] = [
  { route: 'index', label: 'Home', icon: 'house.fill' },
  { route: 'calendar', label: 'Calendar', icon: 'calendar' },
  { route: 'dispatch', label: 'Dispatch', icon: 'arrow.triangle.branch' },
  { route: 'clients', label: 'Clients', icon: 'person.2.fill' },
  { route: 'more', label: 'More', icon: 'ellipsis.circle' },
];

const driverTabs: readonly RoleTab[] = [
  { route: 'driver', label: "Today's Route", icon: 'map.fill' },
  { route: 'schedule', label: 'Schedule', icon: 'calendar' },
  { route: 'assigned', label: 'Assigned', icon: 'dog.fill' },
  { route: 'profile', label: 'Profile', icon: 'person.crop.circle' },
];

export function getTabsForRole(role: UserRole): RoleTab[] {
  return [...(role === 'manager' ? managerTabs : driverTabs)];
}

/**
 * Rota onde o app deve abrir depois do login, por papel.
 *
 * O expo-router abre "/" (o painel do gerente) enquanto o papel ainda esta carregando,
 * e o motorista nao tem essa tela — ele caia num painel de gestao com botoes que nao
 * sao dele. Aqui dizemos para onde redirecionar (null = nao redireciona nada).
 */
export function landingRouteForRole(role: UserRole | null, isLoading: boolean): string | null {
  if (isLoading || !role) return null;
  return role === 'driver' ? '/(tabs)/driver' : null;
}
