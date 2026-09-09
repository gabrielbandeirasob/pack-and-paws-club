import { getTabsForRole } from '@/features/navigation/roleTabs';

describe('role-based tabs', () => {
  it('shows management tools only to managers', () => {
    expect(getTabsForRole('manager').map((tab) => tab.route)).toEqual([
      'index', 'calendar', 'dispatch', 'clients', 'more',
    ]);
  });

  it('shows only operational driver tools to drivers', () => {
    expect(getTabsForRole('driver').map((tab) => tab.route)).toEqual([
      'driver', 'schedule', 'assigned', 'profile',
    ]);
  });
});
