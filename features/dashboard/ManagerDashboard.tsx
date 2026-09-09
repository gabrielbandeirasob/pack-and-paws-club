import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii } from '@/features/theme/tokens';

type Props = { onOpenDispatch: () => void };

const routes = [
  { initial: 'R', driver: 'Rafael', detail: '4 stops · 28 mi', status: 'On time', next: 'Bob · 8:52 AM' },
  { initial: 'J', driver: 'Jordan', detail: '3 stops · 19 mi', status: 'Ready', next: 'Starts 9:10 AM' },
];

export function ManagerDashboard({ onOpenDispatch }: Props) {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.brandBlock}>
              <Image source={require('../../assets/images/pack-paws-logo.jpg')} style={styles.logo} />
              <Text style={styles.brand}>PACK & PAWS CLUB</Text>
            </View>
            <View style={styles.avatar}><Text style={styles.avatarText}>AM</Text></View>
          </View>
          <Text style={styles.date}>MONDAY · SEPTEMBER 8</Text>
          <Text style={styles.greeting}>Good morning, Alexandra</Text>
        </View>

        <View style={styles.statsRow}>
          <Stat value="18" label="Daycare" />
          <Stat value="5" label="Boarding" />
          <Stat value="3" label="Routes" />
        </View>

        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Today&apos;s routes</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="View all routes" onPress={onOpenDispatch}>
            <Text style={styles.link}>View all</Text>
          </Pressable>
        </View>

        {routes.map((route) => (
          <View key={route.driver} style={styles.routeCard}>
            <View style={styles.routeTop}>
              <View style={styles.driverBlock}>
                <View style={styles.driverAvatar}><Text style={styles.driverInitial}>{route.initial}</Text></View>
                <View><Text style={styles.driverName}>{route.driver}</Text><Text style={styles.muted}>{route.detail}</Text></View>
              </View>
              <View style={styles.statusPill}><Text style={styles.statusText}>{route.status}</Text></View>
            </View>
            <View style={styles.routeBottom}>
              <Text style={styles.dogs}>🐶  🐕  🐩</Text>
              <Text style={styles.muted}>{route.next}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.quickRow}>
          <Pressable accessibilityRole="button" style={styles.quickCard}>
            <Text style={styles.quickIcon}>＋</Text><Text style={styles.quickText}>Add from Contacts</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.quickCard}>
            <Text style={styles.quickIcon}>▦</Text><Text style={styles.quickText}>New reservation</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.muted}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.cream},content:{paddingBottom:28},hero:{backgroundColor:colors.forest700,paddingHorizontal:20,paddingTop:12,paddingBottom:50,borderBottomLeftRadius:radii.hero,borderBottomRightRadius:radii.hero},brandRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},brandBlock:{flexDirection:'row',alignItems:'center',gap:10},logo:{width:44,height:44,borderRadius:12,borderWidth:1,borderColor:colors.gold},brand:{color:'white',fontFamily:'serif',fontSize:15,fontWeight:'700',letterSpacing:.4},avatar:{width:38,height:38,borderRadius:19,backgroundColor:'#F0DB9C',alignItems:'center',justifyContent:'center'},avatarText:{color:colors.forest700,fontWeight:'800'},date:{color:'#D7E1D4',fontSize:12,letterSpacing:.7,marginTop:24},greeting:{color:'white',fontFamily:'serif',fontSize:29,fontWeight:'700',lineHeight:34,marginTop:6,maxWidth:310},statsRow:{flexDirection:'row',gap:9,paddingHorizontal:18,marginTop:-27},stat:{flex:1,backgroundColor:colors.paper,borderRadius:radii.medium,padding:14,shadowColor:colors.forest900,shadowOpacity:.08,shadowRadius:14,shadowOffset:{width:0,height:6},elevation:2},statValue:{color:colors.forest700,fontFamily:'serif',fontWeight:'800',fontSize:23},muted:{color:colors.muted,fontSize:11},sectionTitleRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20,marginTop:24,marginBottom:11},sectionTitle:{fontFamily:'serif',fontWeight:'800',fontSize:18,color:colors.ink,marginHorizontal:20,marginTop:22,marginBottom:11},sectionTitleRowTitle:{fontFamily:'serif'},link:{color:colors.forest700,fontWeight:'800'},routeCard:{backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,borderRadius:radii.large,padding:16,marginHorizontal:18,marginBottom:11},routeTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},driverBlock:{flexDirection:'row',alignItems:'center',gap:11},driverAvatar:{width:38,height:38,borderRadius:12,backgroundColor:colors.sage,alignItems:'center',justifyContent:'center'},driverInitial:{color:colors.forest700,fontWeight:'900'},driverName:{fontWeight:'800',color:colors.ink},statusPill:{backgroundColor:'#E3F1DF',borderRadius:20,paddingHorizontal:9,paddingVertical:6},statusText:{color:'#2E6334',fontSize:11,fontWeight:'800'},routeBottom:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:15},dogs:{fontSize:18},quickRow:{flexDirection:'row',gap:10,paddingHorizontal:18},quickCard:{flex:1,backgroundColor:colors.paper,borderRadius:radii.medium,borderWidth:1,borderColor:colors.line,padding:15,minHeight:92},quickIcon:{color:colors.forest700,fontSize:25,fontWeight:'500'},quickText:{color:colors.ink,fontWeight:'800',fontSize:13,marginTop:8},
});
