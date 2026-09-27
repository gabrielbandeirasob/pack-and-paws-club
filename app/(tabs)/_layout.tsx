import { useSyncExternalStore } from 'react';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text } from 'react-native';
import { View } from 'react-native';

import { NoAccess } from '@/features/auth/NoAccess';
import { useAuth } from '@/features/auth/AuthProvider';
import { useOrganizationRole } from '@/features/auth/useOrganizationRole';
import { assinarTodosPendentes, lerTodosPendentes } from '@/features/dashboard/dayTodosStore';
import { colors } from '@/features/theme/tokens';

type TabSpec = { name: string; title: string; icon: string };

const MANAGER_TABS: TabSpec[] = [
  { name: 'index', title: 'Home', icon: '⌂' },
  { name: 'calendar', title: 'Calendar', icon: '▦' },
  { name: 'dispatch', title: 'Dispatch', icon: '⇄' },
  { name: 'clients', title: 'Clients', icon: '♙' },
  { name: 'more', title: 'More', icon: '•••' },
];

const DRIVER_TABS: TabSpec[] = [
  { name: 'driver', title: "Today's Route", icon: '➤' },
  { name: 'schedule', title: 'Schedule', icon: '▦' },
  { name: 'assigned', title: 'Assigned', icon: '♙' },
  { name: 'profile', title: 'Profile', icon: '👤' },
];

const ALL_TABS = [...MANAGER_TABS, ...DRIVER_TABS];

export default function TabLayout() {
  const { role, isLoading, reload } = useOrganizationRole();
  const { session } = useAuth();
  /**
   * BOLINHA DO MENU (operação, 26/09/2026): "vai gerar tipo aquela bolinha para você clicar no
   * menu". O número são os itens ABERTOS da to-do list do dia, que a Home publica no store — a aba
   * que ganha a bolinha é a que mostra o "Today's progress" (Home).
   */
  const todosPendentes = useSyncExternalStore(assinarTodosPendentes, lerTodosPendentes, lerTodosPendentes);

  // Carregando é uma coisa; NÃO ter vínculo ativo é outra. Antes os dois casos mostravam a
  // mesma rodinha — quem entrava sem vínculo ficava travado para sempre (reclamação do motorista).
  if (isLoading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest700 }}><ActivityIndicator size="large" color={colors.gold} /></View>;
  }

  if (!role) {
    return <NoAccess email={session?.user?.email ?? null} onRetry={reload} />;
  }

  const activeNames = new Set((role === 'manager' ? MANAGER_TABS : DRIVER_TABS).map((tab) => tab.name));

  return (
    <><StatusBar style="light" />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.forest700,
        tabBarInactiveTintColor: '#7C877E',
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.line, height: 70, paddingTop: 7, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 9.5, fontWeight: '700' },
      }}
    >
      {ALL_TABS.map((tab) => {
        const active = activeNames.has(tab.name);
        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              href: active ? undefined : null,
              tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18, fontWeight: '800' }}>{tab.icon}</Text>,
              ...(tab.name === 'index' && todosPendentes > 0
                ? { tabBarBadge: todosPendentes, tabBarBadgeStyle: { backgroundColor: colors.urgency, color: 'white', fontSize: 10, fontWeight: '800' } }
                : {}),
            }}
          />
        );
      })}
    </Tabs>
    </>
  );
}
