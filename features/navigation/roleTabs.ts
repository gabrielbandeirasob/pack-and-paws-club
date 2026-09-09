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
