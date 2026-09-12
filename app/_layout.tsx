import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { installGlobalErrorHandler } from '@/features/errors/errorReporter';
import { PushRegistrar } from '@/features/notifications/PushRegistrar';
import { colors } from '@/features/theme/tokens';

// tela de erro da marca + registro automatico (substitui a ErrorBoundary crua do expo-router)
export { AppErrorBoundary as ErrorBoundary } from '@/features/errors/AppErrorBoundary';

installGlobalErrorHandler();

SplashScreen.preventAutoHideAsync();

const packPawsTheme={...DefaultTheme,colors:{...DefaultTheme.colors,primary:colors.forest700,background:colors.cream,card:colors.paper,text:colors.ink,border:colors.line,notification:colors.gold}};

export default function RootLayout(){
  const [loaded,error]=useFonts({SpaceMono:require('../assets/fonts/SpaceMono-Regular.ttf')});
  useEffect(()=>{if(error)throw error;},[error]);
  useEffect(()=>{if(loaded)SplashScreen.hideAsync();},[loaded]);
  if(!loaded)return null;
  return <ThemeProvider value={packPawsTheme}><AuthProvider><PushRegistrar/><RootNavigator/></AuthProvider></ThemeProvider>;
}

function RootNavigator(){
  const {isLoading,isAuthenticated,mustChangePassword}=useAuth();
  if(isLoading)return <View style={styles.loading}><ActivityIndicator size="large" color={colors.gold}/></View>;
  return <Stack screenOptions={{headerShown:false}}>
    <Stack.Protected guard={!isAuthenticated}><Stack.Screen name="login"/></Stack.Protected>
    <Stack.Protected guard={isAuthenticated&&mustChangePassword}><Stack.Screen name="change-password"/></Stack.Protected>
    <Stack.Protected guard={isAuthenticated && !mustChangePassword}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="drivers" options={{ headerShown: false }} />
      <Stack.Screen name="client-edit" options={{ headerShown: false }} />
      <Stack.Screen name="reservation-edit" options={{ headerShown: false }} />
      <Stack.Screen name="route-history" options={{ headerShown: false }} />
    </Stack.Protected>
    <Stack.Screen name="+not-found"/>
  </Stack>;
}

const styles=StyleSheet.create({loading:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:colors.forest700}});
