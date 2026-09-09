import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/features/theme/tokens';

type Props = { title: string; description: string };

export function SectionPlaceholder({ title, description }: Props) {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.brandLine} />
      <View style={styles.content}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <View style={styles.card}><Text style={styles.cardText}>This module is prepared for the next product slice.</Text></View>
      </View>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.cream},brandLine:{height:8,backgroundColor:colors.forest700},content:{padding:24},eyebrow:{color:colors.gold,fontSize:11,fontWeight:'900',letterSpacing:1.2},title:{fontFamily:'serif',fontWeight:'800',fontSize:32,color:colors.forest900,marginTop:12},description:{color:colors.muted,fontSize:15,lineHeight:22,marginTop:8},card:{backgroundColor:colors.paper,borderRadius:18,borderWidth:1,borderColor:colors.line,padding:18,marginTop:28},cardText:{color:colors.ink,fontWeight:'700'}});
