import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii } from '@/features/theme/tokens';

export type DashboardRoute = {
  id: string;
  driverName: string;
  stops: number;
  miles: number;
  statusLabel: string;
  late: boolean;
  nextLabel: string | null;
};

type Props = {
  dateLabel: string;
  greeting: string;
  initials: string;
  daycare: number;
  boarding: number;
  /** Total Pack: quantos cães saem hoje (escolhidos pelo gestor no Dispatch). */
  totalPack: number;
  /** Progresso do dia somando TODAS as rotas (pedido do cliente). */
  progress: { done: number; total: number };
  routes: DashboardRoute[];
  onOpenProgress: () => void;
  onOpenDispatch: () => void;
  onOpenClients: () => void;
  onNewReservation: () => void;
};

export function ManagerDashboard({ dateLabel, greeting, initials, daycare, boarding, totalPack, progress, routes, onOpenProgress, onOpenDispatch, onOpenClients, onNewReservation }: Props) {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.brandBlock}>
              <Image source={require('../../assets/images/pack-paws-logo.jpg')} style={styles.logo} />
              <Text style={styles.brand}>PACK & PAWS CLUB</Text>
            </View>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
          </View>
          <Text style={styles.date}>{dateLabel}</Text>
          <Text style={styles.greeting}>{greeting}</Text>
        </View>

        <View style={styles.statsRow}>
          <Stat value={String(totalPack)} label="Total Pack" destaque />
          <Stat value={String(daycare)} label="Daycare" />
          <Stat value={String(boarding)} label="Boarding" />
          <Stat value={String(routes.length)} label="Routes" />
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="See today's progress" style={styles.progressCard} onPress={onOpenProgress}>
          <View style={styles.progressLeft}>
            <Text style={styles.progressTitle}>Today&apos;s progress</Text>
            <Text style={styles.muted}>
              {progress.total === 0
                ? 'Nothing scheduled for today'
                : `${progress.done} of ${progress.total} dogs done`}
            </Text>
          </View>
          <Text style={styles.link}>See all ›</Text>
        </Pressable>

        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitleInline}>Today&apos;s routes</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="View all routes" onPress={onOpenDispatch}>
            <Text style={styles.link}>View all</Text>
          </Pressable>
        </View>

        {routes.length === 0 ? (
          <View style={styles.routeCard}>
            <Text style={styles.emptyTitle}>No routes yet today</Text>
            <Text style={styles.muted}>Assign the dogs that need transport in Dispatch and publish the route — it appears here and in the driver&apos;s app instantly.</Text>
          </View>
        ) : (
          routes.map((route) => (
            <View key={route.id} style={styles.routeCard}>
              <View style={styles.routeTop}>
                <View style={styles.driverBlock}>
                  <View style={styles.driverAvatar}><Text style={styles.driverInitial}>{route.driverName.charAt(0).toUpperCase()}</Text></View>
                  <View>
                    <Text style={styles.driverName}>{route.driverName}</Text>
                    <Text style={styles.muted}>
                      {route.stops} stop{route.stops === 1 ? '' : 's'}
                      {route.miles > 0 ? ` · ${route.miles} mi` : ''}
                    </Text>
                  </View>
                </View>
                <View style={[styles.statusPill, route.late && styles.statusPillLate]}>
                  <Text style={[styles.statusText, route.late && styles.statusTextLate]}>{route.statusLabel}</Text>
                </View>
              </View>
              <View style={styles.routeBottom}>
                <Text style={styles.muted}>{route.nextLabel ?? 'All stops done'}</Text>
              </View>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.quickRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Add from contacts" style={styles.quickCard} onPress={onOpenClients}>
            <Text style={styles.quickIcon}>＋</Text><Text style={styles.quickText}>Add from Contacts</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="New reservation" style={styles.quickCard} onPress={onNewReservation}>
            <Text style={styles.quickIcon}>▦</Text><Text style={styles.quickText}>New reservation</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label, destaque = false }: { value: string; label: string; destaque?: boolean }) {
  return (
    <View style={[styles.stat, destaque && styles.statDestaque]}>
      <Text style={[styles.statValue, destaque && styles.statValueDestaque]}>{value}</Text>
      <Text style={destaque ? styles.statLabelDestaque : styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.forest700},content:{paddingBottom:28},scroll:{flex:1,backgroundColor:colors.cream},hero:{backgroundColor:colors.forest700,paddingHorizontal:20,paddingTop:12,paddingBottom:50,borderBottomLeftRadius:radii.hero,borderBottomRightRadius:radii.hero},brandRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},brandBlock:{flexDirection:'row',alignItems:'center',gap:10},logo:{width:44,height:44,borderRadius:12,borderWidth:1,borderColor:colors.gold},brand:{color:'white',fontFamily:'serif',fontSize:15,fontWeight:'700',letterSpacing:.4},avatar:{width:38,height:38,borderRadius:19,backgroundColor:'#F0DB9C',alignItems:'center',justifyContent:'center'},avatarText:{color:colors.forest700,fontWeight:'800'},date:{color:'#D7E1D4',fontSize:12,letterSpacing:.7,marginTop:24},greeting:{color:'white',fontFamily:'serif',fontSize:29,fontWeight:'700',lineHeight:34,marginTop:6,maxWidth:310},statsRow:{flexDirection:'row',gap:9,paddingHorizontal:18,marginTop:-27},stat:{flex:1,backgroundColor:colors.paper,borderRadius:radii.medium,padding:14,shadowColor:colors.forest900,shadowOpacity:.08,shadowRadius:14,shadowOffset:{width:0,height:6},elevation:2},statValue:{color:colors.forest700,fontFamily:'serif',fontWeight:'800',fontSize:23},muted:{color:colors.muted,fontSize:11},sectionTitleRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20,marginTop:24,marginBottom:11},sectionTitle:{fontFamily:'serif',fontWeight:'800',fontSize:18,color:colors.ink,marginHorizontal:20,marginTop:22,marginBottom:11},sectionTitleRowTitle:{fontFamily:'serif'},link:{color:colors.forest700,fontWeight:'800'},routeCard:{backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,borderRadius:radii.large,padding:16,marginHorizontal:18,marginBottom:11},routeTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},driverBlock:{flexDirection:'row',alignItems:'center',gap:11},driverAvatar:{width:38,height:38,borderRadius:12,backgroundColor:colors.sage,alignItems:'center',justifyContent:'center'},driverInitial:{color:colors.forest700,fontWeight:'900'},driverName:{fontWeight:'800',color:colors.ink},statusPill:{backgroundColor:'#E3F1DF',borderRadius:20,paddingHorizontal:9,paddingVertical:6},statusText:{color:'#2E6334',fontSize:11,fontWeight:'800'},routeBottom:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:15},dogs:{fontSize:18},quickRow:{flexDirection:'row',gap:10,paddingHorizontal:18},quickCard:{flex:1,backgroundColor:colors.paper,borderRadius:radii.medium,borderWidth:1,borderColor:colors.line,padding:15,minHeight:92},quickIcon:{color:colors.forest700,fontSize:25,fontWeight:'500'},quickText:{color:colors.ink,fontWeight:'800',fontSize:13,marginTop:8},
  sectionTitleInline:{fontFamily:'serif',fontWeight:'800',fontSize:18,color:colors.ink},
  emptyTitle:{fontFamily:'serif',fontWeight:'800',fontSize:15,color:colors.forest900,marginBottom:5},
  statDestaque:{backgroundColor:colors.gold},
  statValueDestaque:{color:colors.forest900},
  statLabelDestaque:{color:colors.forest900,fontSize:11,fontWeight:'700'},
  progressCard:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,borderRadius:radii.large,padding:16,marginHorizontal:18,marginTop:20},
  progressLeft:{flex:1},
  progressTitle:{fontFamily:'serif',fontWeight:'800',fontSize:16,color:colors.ink,marginBottom:3},
  statusPillLate:{backgroundColor:'#FBEAE6'},
  statusTextLate:{color:colors.urgency},
});
