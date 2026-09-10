import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { LoginForm } from '@/features/auth/LoginForm';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.fill}>
        <LoginForm initialEmail={process.env.EXPO_PUBLIC_INITIAL_MANAGER_EMAIL} onSignIn={signIn} />
      </View>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.cream},fill:{flex:1}});
