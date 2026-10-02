import { sufixoDe } from '@/features/driver/etaMessage';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

export type TimeWheelProps = {
  testID?: string;
  value: string | null;
  onChange: (hhmm: string) => void;
  onDone: () => void;
};

const ITEM_HEIGHT = 42;
const VISIBLE_SIDE_ITEMS = 2;
const PADDING = ITEM_HEIGHT * VISIBLE_SIDE_ITEMS;

const HOURS = Array.from({ length: 12 }, (_, hour) => String(hour || 12).padStart(2, '0'));
const PERIODS = ['AM', 'PM'];
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));

function indexOf(value: string | null, options: string[], fallback: number): number {
  if (!value) return fallback;
  const found = options.indexOf(value.slice(0, 2));
  return found >= 0 ? found : fallback;
}

function Wheel({ testID, options, selected, onSelect, hourLabels = false }: { hourLabels?: boolean; testID: string; options: string[]; selected: string; onSelect: (value: string) => void }) {
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(() => indexOf(selected, options, 0));
  const valueRef = useRef(selected);
  valueRef.current = selected;

  useEffect(() => {
    const index = indexOf(valueRef.current, options, 0);
    setActiveIndex(index);
    scrollRef.current?.scrollTo?.({ y: index * ITEM_HEIGHT, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const raw = Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    const index = Math.max(0, Math.min(options.length - 1, raw));
    setActiveIndex(index);
    onSelect(options[index]);
  };

  return (
    <View style={styles.wheel}>
      <ScrollView
        testID={testID}
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        snapToAlignment="center"
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={onMomentumEnd}
        contentContainerStyle={styles.wheelContent}
      >
        {options.map((option, index) => {
          const active = index === activeIndex;
          return (
            <View key={option} style={[styles.item, active && styles.itemActive]} pointerEvents="none">
              <Text style={[styles.itemText, active && styles.itemTextActive]}>{hourLabels ? String(Number(option)) : option}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** 12-hour scrolling time wheel (hour + 5-minute steps + AM/PM) — plain React Native, renders anywhere. */
export function TimeWheel({ testID, value, onChange, onDone }: TimeWheelProps) {
  const [hour, setHour] = useState(() => String((Number(value?.slice(0, 2) ?? 8) % 12) || 12).padStart(2, '0'));
  const [period, setPeriod] = useState(() => sufixoDe(Number(value?.slice(0, 2) ?? 8) * 60));
  const [minute, setMinute] = useState(() => (value && value.length >= 5 ? value.slice(3, 5) : '00'));

  const emit = (nextHour: string, nextMinute: string, nextPeriod: string) => {
    const hour24 = Number(nextHour) % 12 + (nextPeriod === 'PM' ? 12 : 0);
    onChange(`${String(hour24).padStart(2, '0')}:${nextMinute}`);
  };
  const pickPeriod = (nextPeriod: string) => {
    setPeriod(nextPeriod as 'AM' | 'PM');
    emit(hour, minute, nextPeriod);
  };
  const pickHour = (nextHour: string) => {
    setHour(nextHour);
    emit(nextHour, minute, period);
  };
  const pickMinute = (nextMinute: string) => {
    setMinute(nextMinute);
    emit(hour, nextMinute, period);
  };

  return (
    <View style={styles.box} testID={testID}>
      <View style={styles.row}>
        <Wheel testID={`${testID}-hours`} hourLabels options={HOURS} selected={hour} onSelect={pickHour} />
        <Text style={styles.colon}>:</Text>
        <Wheel testID={`${testID}-minutes`} options={MINUTES} selected={minute} onSelect={pickMinute} />
        <Wheel testID={`${testID}-period`} options={PERIODS} selected={period} onSelect={pickPeriod} />
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onDone} style={styles.doneButton}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, paddingTop: 8, marginTop: 8, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', height: ITEM_HEIGHT + PADDING * 2, overflow: 'hidden' },
  wheel: { width: 92 },
  wheelContent: { paddingVertical: PADDING },
  item: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  itemActive: { backgroundColor: colors.sage, borderRadius: 12, marginHorizontal: 6 },
  itemText: { color: colors.muted, fontSize: 15, fontWeight: '700', opacity: 0.45, fontVariant: ['tabular-nums'] },
  itemTextActive: { color: colors.forest900, fontSize: 21, fontWeight: '900', opacity: 1 },
  colon: { color: colors.muted, fontSize: 24, fontWeight: '800', marginHorizontal: 2 },
  actions: { width: '100%', padding: 10 },
  doneButton: { backgroundColor: colors.gold, borderRadius: 12, padding: 10, alignItems: 'center' },
  doneText: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
});
