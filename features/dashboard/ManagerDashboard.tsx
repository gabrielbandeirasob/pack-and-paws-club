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
   * ATENÇÃO e PROGRESSO (dono, 05/10/2026). `semCaminhante` = cão que VAI à caminhada e ainda não tem
   * caminhante assinado (é o que a seção "Needs attention" denuncia e resolve). `pct` é só a barra.
   */
  const semCaminhante = day.packRows.filter((linha) => linha.inPack && !linha.walkerId).length;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

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
              {/* numberOfLines 2 (medido em 320 px, 05/10/2026): "TODAY · MONDAY · OCTOBER 5" tem 200 px e o
                  espaço é 180 — em UMA linha ele era cortado. Aqui ele quebra no separador, nunca no meio
                  da palavra; de 360 px para cima continua numa linha só. */}
              <Text numberOfLines={2} style={styles.date}>{dateLabel}</Text>
              {/* "swipe sideways for the next day" SAIU (dono, 05/10/2026): o gesto e as setas já se
                  explicam, e a frase custava uma linha inteira do painel. */}
              {dayNav.isToday ? null : (
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
          <Text numberOfLines={1} style={styles.greeting}>{greeting}</Text>
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
          {/* Rótulo CURTO e em inglês: o dono pediu idioma ÚNICO na tela (05/10/2026) — antes o total de
              cães estava em português ("Número total de Cães") misturado com o resto em inglês. */}
          <Stat value={String(day.totalDogs)} label="Total dogs" />
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
            {/* Sem "tap to see the dogs": o cartão JÁ se comporta como cartão de painel clicável. */}
            <Text numberOfLines={2} style={styles.statHint}>Dogs going on today&apos;s walk</Text>
          </Pressable>
          <RevenueStat revenueCents={day.revenueCents} onSave={day.onSaveRevenue} />
        </View>

        {/* ATENÇÃO (dono, 05/10/2026): a seção só existe quando há o que resolver, e leva DIRETO ao
            lugar da ação — nada de "Assign them in the Total Pack sheet". */}
        {semCaminhante > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Review dogs without a walker" onPress={() => setFolhaAberta(true)} style={styles.attention}>
            <View style={styles.attentionTop}>
              <Text style={styles.attentionTitle}>Needs attention</Text>
              <Text style={styles.attentionSeta}>›</Text>
            </View>
            <Text numberOfLines={2} style={styles.attentionText}>
              ⚠ {semCaminhante} dog{semCaminhante === 1 ? '' : 's'} still need{semCaminhante === 1 ? 's' : ''} a pack assignment
            </Text>
          </Pressable>
        ) : null}

        {/*
          ATENÇÃO (23/09/2026): quem o cliente pediu para TIRAR foi o QUADRADO "Routes" da fileira de
          indicadores — este cartão ("Today's progress") foi pedido por ele em 22/09 e FICA.
          A BARRA (dono, 05/10/2026) faz o progresso ser lido de relance, sem contar cabeça.
        */}
        <Pressable accessibilityRole="button" accessibilityLabel="See today's progress" style={styles.progressCard} onPress={onOpenProgress}>
          <View style={styles.progressTop}>
            <Text style={styles.progressTitle}>{`${dayNav.prefix}'s progress`}</Text>
            <Text style={styles.link}>See all ›</Text>
          </View>
          <View style={styles.progressRow}>
            <Text style={styles.muted}>
              {progress.total === 0
                ? dayNav.isToday
                  ? 'Nothing scheduled for today'
                  : 'Nothing scheduled for this day'
                : `${progress.done} of ${progress.total} dogs done`}
            </Text>
            {progress.total > 0 ? <Text style={styles.progressPct}>{pct}%</Text> : null}
          </View>
          {progress.total > 0 ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
          ) : null}
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
          onOpenPack={() => setFolhaAberta(true)}
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
                  {/* `flex:1`+`minWidth:0` no bloco do nome: o badge de status não pode espremer o
                      nome do motorista (num iPhone estreito o texto quebrava letra por letra). */}
                  <View style={styles.driverTextBlock}>
                    <Text numberOfLines={1} style={styles.driverName}>{route.driverName}</Text>
                    <Text numberOfLines={1} style={styles.muted}>
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
                <Text numberOfLines={1} style={styles.routeNext}>{route.nextLabel ?? 'All stops done'}</Text>
                {/* O cliente pediu para ABRIR a lista de pick-ups daquele motorista (áudio de
                    01/10/2026): a seta é o convite ao toque, e sem a prop o cartão fica como era. */}
                {onOpenRoute ? <Text style={styles.routeSeta}>›</Text> : null}
              </View>
            </Pressable>
          ))
        )}

        {/*
          NAVEGAÇÃO SECUNDÁRIA (dono, 05/10/2026): "See another day" e "Weekly summary" eram cartões
          grandes competindo com a operação. Viram DUAS LINHAS compactas, com ícone da mesma família
          (glifos de texto, como o resto do app) e seta — nada de bloco de destaque.
        */}
        <View style={styles.secondaryCard}>
          <Pressable accessibilityRole="button" accessibilityLabel="See another day" style={styles.secondaryRow} onPress={day.onOpenDaySummary}>
            <Text style={styles.secondaryIcon}>▤</Text>
            <Text numberOfLines={1} style={styles.secondaryText}>See another day</Text>
            <Text style={styles.secondarySeta}>›</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Weekly summary — Sunday to Saturday"
            style={[styles.secondaryRow, styles.secondaryRowLast]}
            onPress={onOpenWeekSummary}
          >
            <Text style={styles.secondaryIcon}>▦</Text>
            <View style={styles.secondaryBlock}>
              <Text numberOfLines={1} style={styles.secondaryText}>Weekly summary</Text>
              <Text numberOfLines={1} style={styles.secondaryHint}>{weekSummaryHint}</Text>
            </View>
            <Text style={styles.secondarySeta}>›</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Quick actions</Text>
        {/* Ícones da MESMA família (glifo de texto), um por ação; rótulo curto com `numberOfLines={2}`
            e largura mínima — assim "New reservation" quebra na PALAVRA, nunca "reservatio n". */}
        <View style={styles.quickRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Add from contacts" style={styles.quickCard} onPress={onOpenClients}>
            <Text style={styles.quickIcon}>＋</Text><Text numberOfLines={2} style={styles.quickText}>Add contact</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="New reservation" style={styles.quickCard} onPress={onNewReservation}>
            <Text style={styles.quickIcon}>▦</Text><Text numberOfLines={2} style={styles.quickText}>New reservation</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Driver hours" style={styles.quickCard} onPress={onOpenDriverHours}>
            <Text style={styles.quickIcon}>◷</Text><Text numberOfLines={2} style={styles.quickText}>Driver hours</Text>
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
 * Faturamento (dono, 05/10/2026): REVELAÇÃO PROGRESSIVA. Em repouso o quadrado mostra só o valor
 * (`$1,234.56` + `Revenue`) e o toque abre o campo — antes o `TextInput` vivia aberto com a instrução
 * "Faturamento · tap to type" dentro de um cartão de painel. Grava do mesmo jeito: centavos, ao sair
 * do campo.
 */
function RevenueStat({ revenueCents, onSave }: { revenueCents: number | null; onSave: (cents: number | null) => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(formatCents(revenueCents));
  useEffect(() => setTexto(formatCents(revenueCents)), [revenueCents]);

  const enviar = () => {
    const centavos = parseMoneyToCents(texto);
    if (centavos !== revenueCents) onSave(centavos);
    setTexto(formatCents(centavos));
    setEditando(false);
  };

  if (!editando) {
    const valor = revenueCents === null || revenueCents === undefined ? '0.00' : formatCents(revenueCents);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit the revenue of the day"
        onPress={() => setEditando(true)}
        style={[styles.stat, styles.statReceita]}
      >
        <Text numberOfLines={1} style={styles.statValueReceita}>{`$${valor}`}</Text>
        <Text style={styles.muted}>Revenue</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.stat, styles.statReceita]}>
      <Text style={styles.moeda}>$</Text>
      <TextInput
        accessibilityLabel="Revenue of the day"
        value={texto}
        onChangeText={setTexto}
        onBlur={enviar}
        onSubmitEditing={enviar}
        autoFocus
        keyboardType="numbers-and-punctuation"
        placeholder="0.00"
        placeholderTextColor={colors.muted}
        style={styles.receitaCampo}
      />
      <Text style={styles.muted}>Revenue</Text>
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
  screen:{flex:1,backgroundColor:colors.forest700},content:{paddingBottom:28},scroll:{flex:1,backgroundColor:colors.cream},hero:{backgroundColor:colors.forest700,paddingHorizontal:18,paddingTop:6,paddingBottom:22,borderBottomLeftRadius:radii.hero,borderBottomRightRadius:radii.hero},brandRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},brandBlock:{flexDirection:'row',alignItems:'center',gap:10},logo:{width:30,height:30,borderRadius:9,borderWidth:1,borderColor:colors.gold},brand:{color:'white',fontFamily:'serif',fontSize:15,fontWeight:'700',letterSpacing:.4},avatar:{width:32,height:32,borderRadius:16,backgroundColor:'#F0DB9C',alignItems:'center',justifyContent:'center'},avatarText:{color:colors.forest700,fontWeight:'800'},date:{color:'#D7E1D4',fontSize:12,letterSpacing:.7,textAlign:'center'},
  /** Navegação por dia: setas nas pontas, data no meio (o gestor também pode arrastar). */
  dayNavRow:{flexDirection:'row',alignItems:'center',gap:8,marginTop:8},
  dayArrow:{width:44,height:44,borderRadius:22,borderWidth:1,borderColor:'rgba(255,255,255,.35)',alignItems:'center',justifyContent:'center'},
  dayArrowOff:{opacity:.3},
  dayArrowText:{color:'white',fontSize:22,fontWeight:'700',lineHeight:24},
  dayCenter:{flex:1,alignItems:'center'},
  dayPill:{marginTop:3,borderWidth:1,borderColor:colors.gold,borderRadius:20,paddingHorizontal:12,paddingVertical:3,minHeight:44,justifyContent:'center'},
  dayPillText:{color:colors.gold,fontSize:12,fontWeight:'800'},greeting:{color:'white',fontFamily:'serif',fontSize:22,fontWeight:'700',lineHeight:27,marginTop:4,maxWidth:'100%'},statsRow:{flexDirection:'row',gap:8,paddingHorizontal:18,marginTop:-12},statsRow2:{flexDirection:'row',gap:8,paddingHorizontal:18,marginTop:8},stat:{flex:1,backgroundColor:colors.paper,borderRadius:radii.medium,padding:12,shadowColor:colors.forest900,shadowOpacity:.08,shadowRadius:14,shadowOffset:{width:0,height:6},elevation:2},statValue:{color:colors.forest700,fontFamily:'serif',fontWeight:'800',fontSize:23},muted:{color:colors.muted,fontSize:12},sectionTitleRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20,marginTop:24,marginBottom:11},sectionTitle:{fontFamily:'serif',fontWeight:'800',fontSize:18,color:colors.ink,marginHorizontal:20,marginTop:22,marginBottom:11},link:{color:colors.forest700,fontWeight:'800'},routeCard:{backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,borderRadius:radii.large,padding:12,marginHorizontal:18,marginBottom:8},routeCardPressed:{opacity:.75},routeSeta:{color:colors.forest700,fontWeight:'800',fontSize:16},routeTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},driverBlock:{flexDirection:'row',alignItems:'center',gap:9,flex:1,minWidth:0},driverTextBlock:{flex:1,minWidth:0},routeNext:{color:colors.muted,fontSize:12,flex:1},driverAvatar:{width:32,height:32,borderRadius:10,backgroundColor:colors.sage,alignItems:'center',justifyContent:'center'},driverInitial:{color:colors.forest700,fontWeight:'900'},driverName:{fontWeight:'800',color:colors.ink,fontSize:13.5},statusPill:{backgroundColor:'#E3F1DF',borderRadius:20,paddingHorizontal:9,paddingVertical:4},statusText:{color:'#2E6334',fontSize:11,fontWeight:'800'},routeBottom:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:6},dogs:{fontSize:18},quickRow:{flexDirection:'row',flexWrap:'wrap',gap:8,paddingHorizontal:18},quickCard:{flexGrow:1,flexBasis:'30%',minWidth:104,backgroundColor:colors.paper,borderRadius:radii.medium,borderWidth:1,borderColor:colors.line,paddingHorizontal:10,paddingVertical:12,minHeight:76,alignItems:'center',justifyContent:'center'},quickIcon:{color:colors.forest700,fontSize:22,fontWeight:'600'},quickText:{color:colors.ink,fontWeight:'800',fontSize:12.5,marginTop:6,textAlign:'center'},
  sectionTitleInline:{fontFamily:'serif',fontWeight:'800',fontSize:18,color:colors.ink},
  emptyTitle:{fontFamily:'serif',fontWeight:'800',fontSize:15,color:colors.forest900,marginBottom:5},
  statDestaque:{backgroundColor:colors.gold},
  statValueDestaque:{color:colors.forest900,fontFamily:'serif',fontWeight:'800',fontSize:23},
  statLabelDestaque:{color:colors.forest900,fontSize:11,fontWeight:'700'},
  /** Legenda do indicador (ex.: o que o "Total Pack" conta). */
  statHint:{color:colors.forest900,fontSize:12,lineHeight:15,opacity:.75,marginTop:2},
  /** Faturamento: campo digitável dentro do quadrado. */
  statReceita:{backgroundColor:colors.paper},
  moeda:{color:colors.forest700,fontFamily:'serif',fontWeight:'800',fontSize:13,marginBottom:2},
  receitaCampo:{color:colors.forest700,fontFamily:'serif',fontWeight:'800',fontSize:19,padding:0,margin:0},
  progressCard:{backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,borderRadius:radii.large,padding:12,marginHorizontal:18,marginTop:12},
  progressTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  progressRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:2},
  progressPct:{color:colors.forest700,fontWeight:'900',fontSize:12},
  /** BARRA do progresso: o gestor entende em 2 s sem contar cabeça (dono, 05/10/2026). */
  progressTrack:{height:6,borderRadius:3,backgroundColor:colors.line,marginTop:8,overflow:'hidden'},
  progressFill:{height:6,borderRadius:3,backgroundColor:colors.forest700},
  progressTitle:{fontFamily:'serif',fontWeight:'800',fontSize:16,color:colors.ink,marginBottom:3},
  statusPillLate:{backgroundColor:'#FBEAE6'},
  statusTextLate:{color:colors.urgency},
  /** ATENÇÃO (dono, 05/10/2026): o cartão só aparece quando há cão no pack sem caminhante. */
  attention:{backgroundColor:'#FBEDED',borderWidth:1,borderColor:colors.urgency,borderRadius:radii.medium,paddingHorizontal:12,paddingVertical:10,marginHorizontal:18,marginTop:12},
  attentionTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  attentionTitle:{color:colors.urgency,fontWeight:'900',fontSize:12,letterSpacing:.4,textTransform:'uppercase'},
  attentionText:{color:colors.urgency,fontSize:12.5,fontWeight:'700',marginTop:3},
  attentionSeta:{color:colors.urgency,fontWeight:'900',fontSize:16},
  /** Total Pack ganha mais largura: é o número que puxa ação (o faturamento é leitura). */
  statPack:{flex:1.4,backgroundColor:colors.gold},
  statValueReceita:{color:colors.forest700,fontFamily:'serif',fontWeight:'800',fontSize:19},
  /** Navegação secundária: DUAS linhas compactas num cartão só (dono, 05/10/2026). */
  secondaryCard:{backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,borderRadius:radii.medium,marginHorizontal:18,marginTop:14,overflow:'hidden'},
  secondaryRow:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:12,paddingVertical:11,minHeight:44,borderBottomWidth:1,borderBottomColor:colors.line},
  secondaryRowLast:{borderBottomWidth:0},
  secondaryIcon:{color:colors.forest700,fontSize:15,fontWeight:'700'},
  secondaryText:{color:colors.forest700,fontWeight:'800',fontSize:13.5},
  secondaryHint:{color:colors.muted,fontSize:11.5,marginTop:1},
  secondaryBlock:{flex:1,minWidth:0},
  secondarySeta:{color:colors.forest700,fontWeight:'800',fontSize:16},
});
