import type { Session } from '@supabase/supabase-js';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type AuthState={session:Session|null;isLoading:boolean;isAuthenticated:boolean;mustChangePassword:boolean};
const AuthContext=createContext<AuthState|undefined>(undefined);

export function AuthProvider({children}:PropsWithChildren){
  const [session,setSession]=useState<Session|null>(null);
  const [isLoading,setIsLoading]=useState(true);
  useEffect(()=>{
    let mounted=true;
    supabase.auth.getSession().then(({data})=>{if(mounted){setSession(data.session);setIsLoading(false);}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{if(mounted){setSession(next);setIsLoading(false);}});
    return()=>{mounted=false;subscription.unsubscribe();};
  },[]);
  const value=useMemo(()=>({session,isLoading,isAuthenticated:!!session,mustChangePassword:session?.user.user_metadata?.must_change_password===true}),[session,isLoading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('useAuth must be used inside AuthProvider');return value;}
