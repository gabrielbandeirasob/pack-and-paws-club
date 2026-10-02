import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii } from '@/features/theme/tokens';
import { DayPlanCard } from './DayPlanCard';
import { PackSheet } from './PackSheet';
import { TodoCard } from './TodoCard';
import { formatCents, parseMoneyToCents, type DailyTodo } from './dayOperation';

export type DashboardRoute = {
  id: string;
  driverName: string;
  stops: number;
  miles: number;
  statusLabel: string;
  late: boolean;
  nextLabel: string | null;
};

/** Membros que podem CAMINHAR com um cão (o motorista que pega na rota pode ser outro). */
export type DashboardMember = { id: string; name: string };

/**
 * Tudo o que a operação pediu em 26/09/2026 e vive no dia: os 5 indicadores, o pack (caminhada) e o
 * fechamento do dia. Vem em um objeto só para não espalhar dez props na tela.
 */
export type DashboardDaySection = {
  /** Todos os cães do dia (daycare + boarding, sem repetir). */
  totalDogs: number;
  /** Cães que vão para a caminhada hoje (Total Pack). */
  pack: number;
  /** Faturamento digitado, em centavos; null = não digitado. */
  revenueCents: number | null;
  /** Linhas do pack (para a folha do Total Pack). */
  packRows: { dogId: string; dogName: string; clientName: string; serviceType: 'daycare' | 'boarding'; inPack: boolean; walkerId: string | null }[];
  members: DashboardMember[];
  packBusy?: boolean;
  onTogglePack: (dogId: string, inPack: boolean) => void;
  onSetWalker: (dogId: string, walkerId: string | null) => void;
  onSaveRevenue: (cents: number | null) => void;
  todos: DailyTodo[];
  todosBusy?: boolean;
  onAddTodo: (text: string) => void;
  onToggleTodo: (id: string, done: boolean) => void;
  onEditTodo: (id: string, text: string) => void;
  onRemoveTodo: (id: string) => void;
  plan: { walkLocation: string | null; photoIdea: string | null };
  planBusy?: boolean;
  planSaved?: string | null;
  onSavePlan: (values: { walkLocation: string; photoIdea: string }) => void;
  /** Abre o histórico ("clicar lá, dia tal, e ver todas essas informações do dia tal"). */
  onOpenDaySummary: () => void;
};

type Props = {
  dateLabel: string;
  /** Navegação por dia: swipe no cabeçalho verde + setas + "Back to today". */
  dayNav: DashboardDayNav;
  greeting: string;
  viewSwitch?: ReactNode;
  initials: string;
  daycare: number;
  boarding: number;
  /** Progresso do dia somando TODAS as rotas (pedido do cliente em 22/09/2026). */
  progress: { done: number; total: number };
  routes: DashboardRoute[];
  /**
   * Toque no cartão do motorista → lista dos pick-ups daquela rota, com a hora de cada um
   * (pedido do cliente em áudio, 01/10/2026). Sem a prop o cartão fica como sempre foi (só leitura),
   * para não mexer nos testes nem no comportamento de quem não passa a função.
   */
  onOpenRoute?: (routeId: string) => void;
  /** 5 indicadores + pack + fechamento do dia (operação, 26/09/2026). */
  day: DashboardDaySection;
  onOpenProgress: () => void;
  onOpenDispatch: () => void;
  onOpenClients: () => void;
  onNewReservation: () => void;
  /** Jornada/horas dos motoristas (pedido do cliente, 16/09/2026). */
  onOpenDriverHours: () => void;
  /** Resumo da semana (áudio do dono, 27/09/2026): quem veio de segunda a sábado. */
  onOpenWeekSummary: () => void;
  /** Texto de apoio do atalho — no sábado a semana fechou, e a frase muda. */
  weekSummaryHint: string;
};

/**
 * Navegação por dia (pedido do dono, áudio de 27/09/2026): o gestor ARRASTA O CABEÇALHO VERDE para
 * o lado e o painel inteiro passa a mostrar aquele dia — para trás ou para frente. É assim que ele
 * planeja o dia SEGUINTE (local da caminhada e ideia da foto), que é quando essa decisão acontece:
 * "a foto, o jeito que vai ser tirada a foto e o local é decidido no dia anterior".
 */
export type DashboardDayNav = {
  /** "Today" / "Tomorrow" / "Yesterday" / "Monday" — deixa os títulos dos cartões honestos. */
  prefix: string;
  isToday: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
};

/** Quanto o dedo precisa andar para valer como "arrastou para o lado" (não é toque, não é scroll). */
const ARRASTO_MINIMO = 60;

export function ManagerDashboard({ dateLabel, dayNav, greeting, viewSwitch, initials, daycare, boarding, progress, routes, day, onOpenProgress, onOpenDispatch, onOpenClients, onNewReservation, onOpenDriverHours, onOpenWeekSummary, weekSummaryHint, onOpenRoute }: Props) {
  const [folhaAberta, setFolhaAberta] = useState(false);

  /**
   * O cabo do swipe: arrastar para a ESQUERDA vai para o dia seguinte, para a DIREITA volta um dia
   * (é o sentido de um calendário que rola por baixo do dedo). O gesto só é capturado quando é
   * claramente horizontal — assim a rolagem da tela (vertical) continua funcionando em cima do
   * cabeçalho.
   */
  const diaNav = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evento, gesto) =>
          Math.abs(gesto.dx) > 12 && Math.abs(gesto.dx) > Math.abs(gesto.dy),
        onMoveShouldSetPanResponderCapture: (_evento, gesto) =>
          Math.abs(gesto.dx) > 12 && Math.abs(gesto.dx) > Math.abs(gesto.dy),
        onPanResponderRelease: (_evento, gesto) => {
          if (gesto.dx <= -ARRASTO_MINIMO) dayNav.onNextDay();
          else if (gesto.dx >= ARRASTO_MINIMO) dayNav.onPreviousDay();
        },
      }),
    [dayNav],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* CABEÇALHO VERDE — aqui mora a navegação por dia: arrastar para o lado troca o dia. */}
        <View style={styles.hero} {...diaNav.panHandlers}>
          <View style={styles.brandRow}>
            <View style={styles.brandBlock}>
              <Image source={require('../../assets/images/pack-paws-logo.jpg')} style={styles.logo} />
              <Text style={styles.brand}>PACK & PAWS CLUB</Text>
            </View>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
          </View>
          <View style={styles.dayNavRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous day"
              accessibilityState={{ disabled: !dayNav.canGoBack }}
              disabled={!dayNav.canGoBack}
              onPress={dayNav.onPreviousDay}
              style={[styles.dayArrow, !dayNav.canGoBack && styles.dayArrowOff]}
            >
              <Text style={styles.dayArrowText}>‹</Text>
            </Pressable>
            <View style={styles.dayCenter}>
              <Text style={styles.date}>{dateLabel}</Text>
              {dayNav.isToday ? (
                <Text style={styles.dayHint}>swipe sideways for the next day</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to today"
                  onPress={dayNav.onToday}
                  style={styles.dayPill}
                >
                  <Text style={styles.dayPillText}>Back to today</Text>
                </Pressable>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next day"
              accessibilityState={{ disabled: !dayNav.canGoForward }}
              disabled={!dayNav.canGoForward}
              onPress={dayNav.onNextDay}
              style={[styles.dayArrow, !dayNav.canGoForward && styles.dayArrowOff]}
            >
              <Text style={styles.dayArrowText}>›</Text>
            </Pressable>
          </View>
          <Text style={styles.greeting}>{greeting}</Text>
          {viewSwitch}
        </View>

        {/*
          OS 5 INDICADORES (operação, 26/09/2026). Duas fileiras porque cinco quadrados numa linha
          de telefone viram nada legível:
            1ª Daycare · Boarding · Total dogs   (os números do calendário do dia)
            2ª Total Pack (clicável, o pack da CAMINHADA) · Revenue (digitável)
          "Total Pack" é o termo DELES (matilha / pack walk): o cliente perguntou o que era o número
          (áudio de 23/09/2026), então a legenda fica aqui em vez de trocar o nome que eles usam.
        */}
        <View style={styles.statsRow}>
          <Stat value={String(daycare)} label="Daycare" />
          <Stat value={String(boarding)} label="Boarding" />
          {/* Rótulo em PORTUGUÊS por pedido do dono (28/09/2026): "o número total de cães aparece sempre a
              contagem de acordo com o calendário" — e ele quer esse rótulo e o do faturamento em português. */}
          <Stat value={String(day.totalDogs)} label="Número total de Cães" hint="on the calendar today" />
        </View>

        <View style={styles.statsRow2}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Total Pack — open the pack of the day"
            onPress={() => setFolhaAberta(true)}
            style={[styles.stat, styles.statDestaque]}
          >
            <Text style={styles.statValueDestaque}>{String(day.pack)}</Text>
            <Text style={styles.statLabelDestaque}>Total Pack</Text>
            <Text style={styles.statHint}>going to the walk · tap to see the dogs</Text>
          </Pressable>
          <RevenueStat revenueCents={day.revenueCents} onSave={day.onSaveRevenue} />
        </View>

        {/*
          ATENÇÃO (23/09/2026): quem o cliente pediu para TIRAR foi o QUADRADO "Routes" da fileira de
          indicadores — o áudio diz "tira o botão, esse aqui mostrando as rotas que tem no dia". O
          print dele tem duas setas verdes: uma no quadrado "Total Pack" e outra no quadrado
          "Routes"; o cabo da segunda atravessa este cartão, mas o alvo é o quadrado. Este cartão
          ("Today's progress") foi pedido por ele em 22/09 e FICA.
        */}
        <Pressable accessibilityRole="button" accessibilityLabel="See today's progress" style={styles.progressCard} onPress={onOpenProgress}>
          <View style={styles.progressLeft}>
            <Text style={styles.progressTitle}>{`${dayNav.prefix}'s progress`}</Text>
            <Text style={styles.muted}>
              {progress.total === 0
                ? dayNav.isToday
                  ? 'Nothing scheduled for today'
                  : 'Nothing scheduled for this day'
                : `${progress.done} of ${progress.total} dogs done`}
            </Text>
          </View>
          <Text style={styles.link}>See all ›</Text>
        </Pressable>

        {/* TO-DO LIST do dia (operação, 26/09/2026) — dentro do progresso do dia. */}
        <TodoCard
          title={`${dayNav.prefix}'s to-do`}
          todos={day.todos}
          busy={day.todosBusy}
          onAdd={day.onAddTodo}
          onToggle={day.onToggleTodo}
          onEdit={day.onEditTodo}
          onRemove={day.onRemoveTodo}
        />

        {/* PLANO DO DIA: local da caminhada + ideia da foto (operação, 26/09/2026; nome corrigido em
            27/09/2026 — é decidido no dia ANTERIOR, então não é "fim do dia"). */}
        <DayPlanCard
          walkLocation={day.plan.walkLocation}
          photoIdea={day.plan.photoIdea}
          busy={day.planBusy}
          saved={day.planSaved}
          onSave={day.onSavePlan}
          packRows={day.packRows}
          members={day.members}
        />

        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitleInline}>{`${dayNav.prefix}'s routes`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="View all routes" onPress={onOpenDispatch}>
            <Text style={styles.link}>View all</Text>
          </Pressable>
        </View>

        {routes.length === 0 ? (
          <View style={styles.routeCard}>
            <Text style={styles.emptyTitle}>{dayNav.isToday ? 'No routes yet today' : 'No routes yet for this day'}</Text>
            <Text style={styles.muted}>Assign the dogs that need transport in Dispatch and publish the route — it appears here and in the driver&apos;s app instantly.</Text>
          </View>
        ) : (
          routes.map((route) => (
            <Pressable
              key={route.id}
              accessibilityRole="button"
              accessibilityLabel={onOpenRoute ? `Open ${route.driverName} route` : undefined}
              onPress={onOpenRoute ? () => onOpenRoute(route.id) : undefined}
              style={({ pressed }) => [styles.routeCard, pressed && onOpenRoute ? styles.routeCardPressed : null]}
            >
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
                {/* O cliente pediu para ABRIR a lista de pick-ups daquele motorista (áudio de
                    01/10/2026): a seta é o convite ao toque, e sem a prop o cartão fica como era. */}
                {onOpenRoute ? <Text style={styles.routeSeta}>›</Text> : null}
              </View>
            </Pressable>
          ))
        )}

        {/* Histórico do dia: "você vai ser capaz de clicar lá, dia tal, e ver todas essas informações". */}
        <Pressable accessibilityRole="button" accessibilityLabel="See another day" style={styles.dayLink} onPress={day.onOpenDaySummary}>
          <Text style={styles.dayLinkTexto}>See another day</Text>
          <Text style={styles.dayLinkSeta}>›</Text>
        </Pressable>

        {/* RESUMO DA SEMANA (áudio do dono, 27/09/2026): "sempre que chegar no sábado, vai ter essa
            checagem da semana" — a lista dos cães que vieram, com os dias de cada um. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Weekly summary — Monday to Saturday"
          style={styles.dayLink}
          onPress={onOpenWeekSummary}
        >
          <View style={styles.dayLinkBloco}>
            <Text style={styles.dayLinkTexto}>Weekly summary</Text>
            <Text style={styles.muted}>{weekSummaryHint}</Text>
          </View>
          <Text style={styles.dayLinkSeta}>›</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.quickRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Add from contacts" style={styles.quickCard} onPress={onOpenClients}>
            <Text style={styles.quickIcon}>＋</Text><Text style={styles.quickText}>Add from Contacts</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="New reservation" style={styles.quickCard} onPress={onNewReservation}>
            <Text style={styles.quickIcon}>▦</Text><Text style={styles.quickText}>New reservation</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Driver hours" style={styles.quickCard} onPress={onOpenDriverHours}>
            <Text style={styles.quickIcon}>⏱</Text><Text style={styles.quickText}>Driver hours</Text>
          </Pressable>
        </View>
      </ScrollView>

      <PackSheet
        visible={folhaAberta}
        dayLabel={dateLabel}
        rows={day.packRows}
        members={day.members}
        busy={day.packBusy}
        onToggle={day.onTogglePack}
        onSetWalker={day.onSetWalker}
        onClose={() => setFolhaAberta(false)}
      />
    </SafeAreaView>
  );
}

/**
 * Faturamento digitável: o valor vive no TextInput enquanto o gestor digita e sobe para o banco ao
 * sair do campo (ou apertar "done"). Fica em centavos, nunca em ponto flutuante.
 */
function RevenueStat({ revenueCents, onSave }: { revenueCents: number | null; onSave: (cents: number | null) => void }) {
  const [texto, setTexto] = useState(formatCents(revenueCents));
  useEffect(() => setTexto(formatCents(revenueCents)), [revenueCents]);

  const enviar = () => {
    const centavos = parseMoneyToCents(texto);
    if (centavos !== revenueCents) onSave(centavos);
    setTexto(formatCents(centavos));
  };

  return (
    <View style={[styles.stat, styles.statReceita]}>
      <Text style={styles.moeda}>$</Text>
      <TextInput
        accessibilityLabel="Revenue of the day"
        value={texto}
        onChangeText={setTexto}
        onBlur={enviar}
        onSubmitEditing={enviar}
        keyboardType="numbers-and-punctuation"
        placeholder="0.00"
        placeholderTextColor={colors.muted}
        style={styles.receitaCampo}
      />
      {/* Rótulo em PORTUGUÊS por pedido do dono (28/09/2026): "o faturamento é por conta do admin". */}
      <Text style={styles.muted}>Faturamento · tap to type</Text>
    </View>
  );
}

function Stat({ value, label, hint, destaque = false }: { value: string; label: string; hint?: string; destaque?: boolean }) {
  return (
    <View style={[styles.stat, destaque && styles.statDestaque]}>
      <Text style={[styles.statValue, destaque && styles.statValueDestaque]}>{value}</Text>
      <Text style={destaque ? styles.statLabelDestaque : styles.muted}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.forest700},content:{paddingBottom:28},scroll:{flex:1,backgroundColor:colors.cream},hero:{backgroundColor:colors.forest700,paddingHorizontal:20,paddingTop:12,paddingBottom:50,borderBottomLeftRadius:radii.hero,borderBottomRightRadius:radii.hero},brandRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},brandBlock:{flexDirection:'row',alignItems:'center',gap:10},logo:{width:44,height:44,borderRadius:12,borderWidth:1,borderColor:colors.gold},brand:{color:'white',fontFamily:'serif',fontSize:15,fontWeight:'700',letterSpacing:.4},avatar:{width:38,height:38,borderRadius:19,backgroundColor:'#F0DB9C',alignItems:'center',justifyContent:'center'},avatarText:{color:colors.forest700,fontWeight:'800'},date:{color:'#D7E1D4',fontSize:12,letterSpacing:.7,textAlign:'center'},
  /** Navegação por dia: setas nas pontas, data no meio (o gestor também pode arrastar). */
  dayNavRow:{flexDirection:'row',alignItems:'center',gap:10,marginTop:20},
  dayArrow:{width:44,height:44,borderRadius:22,borderWidth:1,borderColor:'rgba(255,255,255,.35)',alignItems:'center',justifyContent:'center'},
  dayArrowOff:{opacity:.3},
  dayArrowText:{color:'white',fontSize:22,fontWeight:'700',lineHeight:24},
  dayCenter:{flex:1,alignItems:'center'},
  dayHint:{color:'#A9BFA6',fontSize:10.5,marginTop:3},
  dayPill:{marginTop:5,borderWidth:1,borderColor:colors.gold,borderRadius:20,paddingHorizontal:12,paddingVertical:5},
  dayPillText:{color:colors.gold,fontSize:11,fontWeight:'800'},greeting:{color:'white',fontFamily:'serif',fontSize:29,fontWeight:'700',lineHeight:34,marginTop:6,maxWidth:310},statsRow:{flexDirection:'row',gap:9,paddingHorizontal:18,marginTop:-27},statsRow2:{flexDirection:'row',gap:9,paddingHorizontal:18,marginTop:9},stat:{flex:1,backgroundColor:colors.paper,borderRadius:radii.medium,padding:14,shadowColor:colors.forest900,shadowOpacity:.08,shadowRadius:14,shadowOffset:{width:0,height:6},elevation:2},statValue:{color:colors.forest700,fontFamily:'serif',fontWeight:'800',fontSize:23},muted:{color:colors.muted,fontSize:11},sectionTitleRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20,marginTop:24,marginBottom:11},sectionTitle:{fontFamily:'serif',fontWeight:'800',fontSize:18,color:colors.ink,marginHorizontal:20,marginTop:22,marginBottom:11},link:{color:colors.forest700,fontWeight:'800'},routeCard:{backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,borderRadius:radii.large,padding:16,marginHorizontal:18,marginBottom:11},routeCardPressed:{opacity:.75},routeSeta:{color:colors.forest700,fontWeight:'800',fontSize:16},routeTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},driverBlock:{flexDirection:'row',alignItems:'center',gap:11},driverAvatar:{width:38,height:38,borderRadius:12,backgroundColor:colors.sage,alignItems:'center',justifyContent:'center'},driverInitial:{color:colors.forest700,fontWeight:'900'},driverName:{fontWeight:'800',color:colors.ink},statusPill:{backgroundColor:'#E3F1DF',borderRadius:20,paddingHorizontal:9,paddingVertical:6},statusText:{color:'#2E6334',fontSize:11,fontWeight:'800'},routeBottom:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:15},dogs:{fontSize:18},quickRow:{flexDirection:'row',gap:10,paddingHorizontal:18},quickCard:{flex:1,backgroundColor:colors.paper,borderRadius:radii.medium,borderWidth:1,borderColor:colors.line,padding:15,minHeight:92},quickIcon:{color:colors.forest700,fontSize:25,fontWeight:'500'},quickText:{color:colors.ink,fontWeight:'800',fontSize:13,marginTop:8},
  sectionTitleInline:{fontFamily:'serif',fontWeight:'800',fontSize:18,color:colors.ink},
  emptyTitle:{fontFamily:'serif',fontWeight:'800',fontSize:15,color:colors.forest900,marginBottom:5},
  statDestaque:{backgroundColor:colors.gold},
  statValueDestaque:{color:colors.forest900,fontFamily:'serif',fontWeight:'800',fontSize:23},
  statLabelDestaque:{color:colors.forest900,fontSize:11,fontWeight:'700'},
  /** Legenda do indicador (ex.: o que o "Total Pack" conta). */
  statHint:{color:colors.forest900,fontSize:9,opacity:.75,marginTop:2},
  /** Faturamento: campo digitável dentro do quadrado. */
  statReceita:{backgroundColor:colors.paper},
  moeda:{color:colors.forest700,fontFamily:'serif',fontWeight:'800',fontSize:13,marginBottom:2},
  receitaCampo:{color:colors.forest700,fontFamily:'serif',fontWeight:'800',fontSize:19,padding:0,margin:0},
  progressCard:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,borderRadius:radii.large,padding:16,marginHorizontal:18,marginTop:20},
  progressLeft:{flex:1},
  progressTitle:{fontFamily:'serif',fontWeight:'800',fontSize:16,color:colors.ink,marginBottom:3},
  statusPillLate:{backgroundColor:'#FBEAE6'},
  statusTextLate:{color:colors.urgency},
  /** Atalho para o histórico do dia (indicadores de um dia passado). */
  dayLink:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,borderRadius:radii.large,paddingHorizontal:16,paddingVertical:14,marginHorizontal:18,marginTop:16},
  dayLinkTexto:{color:colors.forest700,fontWeight:'800',fontSize:13.5},
  dayLinkBloco:{flex:1},
  dayLinkSeta:{color:colors.forest700,fontWeight:'800',fontSize:16},
});
