import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChangePasswordForm } from '@/features/auth/ChangePasswordForm';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

export default function ChangePasswordScreen(){
  const change=async(password:string)=>{
    const {error}=await supabase.auth.updateUser({password,data:{must_change_password:false}});
    if(error)throw new Error(error.message);
  };
  return <SafeAreaView style={styles.screen}><ChangePasswordForm onChangePassword={change}/></SafeAreaView>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.cream}});
