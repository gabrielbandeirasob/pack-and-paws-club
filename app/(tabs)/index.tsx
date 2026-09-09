import { useRouter } from 'expo-router';
import { ManagerDashboard } from '@/features/dashboard/ManagerDashboard';

export default function DashboardScreen() {
  const router = useRouter();
  return <ManagerDashboard onOpenDispatch={() => router.push('/dispatch')} />;
}
