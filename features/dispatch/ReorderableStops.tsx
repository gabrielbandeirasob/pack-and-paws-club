import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View, type ViewProps } from 'react-native';
import { colors } from '@/features/theme/tokens';
import type { Perna } from './orderPins';

type Stop = { dogId: string; dogName: string };
type Drag = { dogId: string; from: number; to: number; dy: number };

/** Presentation only: every crossed position uses the existing serialized reorder callback. */
export function ReorderableStops<T extends Stop>({ stops, leg, enabled, onMove, children }: {
  stops: T[];
  leg: Perna;
  enabled: boolean;
  onMove: (dogId: string, direction: -1 | 1) => void;
  children: (stop: T, index: number, handle: ReactNode, accessibility: ViewProps) => ReactNode;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const active = useRef<Drag | null>(null);
  const heights = useRef(new Map<string, number>());
  const latest = useRef({ stops, enabled, onMove });
  latest.current = { stops, enabled, onMove };
  const height = (id: string) => heights.current.get(id) ?? 80;
  const cancel = () => { active.current = null; setDrag(null); };
  useEffect(() => { if (!enabled) cancel(); }, [enabled]);
  const start = (dogId: string) => {
    if (!latest.current.enabled) return;
    const from = latest.current.stops.findIndex(s => s.dogId === dogId);
    if (from < 0) return;
    active.current = { dogId, from, to: from, dy: 0 };
    setDrag(active.current);
  };
  const move = (dy: number) => {
    const current = active.current;
    if (!current || !latest.current.enabled) return;
    const list = latest.current.stops;
    const from = list.findIndex(s => s.dogId === current.dogId);
    if (from < 0) { cancel(); return; }
    let to = from;
    let distance = 0;
    const direction = dy < 0 ? -1 : 1;
    while (to + direction >= 0 && to + direction < list.length) {
      const nextHeight = height(list[to + direction].dogId);
      if (Math.abs(dy) < distance + nextHeight / 2) break;
      distance += nextHeight;
      to += direction;
    }
    const bound = list.slice(dy < 0 ? 0 : from + 1, dy < 0 ? from : list.length)
      .reduce((sum, stop) => sum + height(stop.dogId), 0);
    active.current = { ...current, from, to, dy: Math.sign(dy) * Math.min(Math.abs(dy), bound) };
    setDrag(active.current);
  };
  const finish = () => {
    const current = active.current;
    cancel();
    if (!current || !latest.current.enabled) return;
    const direction = current.to > current.from ? 1 : -1;
    // Do not await: the screen updates its ref synchronously and coalesces writes in reorderQueue.
    for (let i = 0; i < Math.abs(current.to - current.from); i++) latest.current.onMove(current.dogId, direction);
  };
  return <View>{stops.map((stop, index) => {
    const lifted = drag?.dogId === stop.dogId;
    let offset = lifted ? drag.dy : 0;
    if (drag && !lifted) {
      if (index > drag.from && index <= drag.to) offset = -height(drag.dogId);
      if (index < drag.from && index >= drag.to) offset = height(drag.dogId);
    }
    return <DraggableRow key={stop.dogId} stop={stop} leg={leg} enabled={enabled}
      offset={offset} lifted={!!lifted} onHeight={value => heights.current.set(stop.dogId, value)}
      onStart={() => start(stop.dogId)} onMove={move} onFinish={finish} onCancel={cancel}
      onAction={direction => {
        if (enabled && index + direction >= 0 && index + direction < stops.length) onMove(stop.dogId, direction);
      }}>
      {(handle, accessibility) => children(stop, index, handle, accessibility)}
    </DraggableRow>;
  })}</View>;
}

function DraggableRow({ stop, leg, enabled, offset, lifted, onHeight, onStart, onMove, onFinish, onCancel, onAction, children }: {
  stop: Stop; leg: Perna; enabled: boolean; offset: number; lifted: boolean;
  onHeight: (height: number) => void; onStart: () => void; onMove: (dy: number) => void;
  onFinish: () => void; onCancel: () => void; onAction: (direction: -1 | 1) => void;
  children: (handle: ReactNode, accessibility: ViewProps) => ReactNode;
}) {
  const latest = useRef({ enabled, onStart, onMove, onFinish, onCancel });
  latest.current = { enabled, onStart, onMove, onFinish, onCancel };
  const translate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (lifted || offset === 0) { translate.stopAnimation(); translate.setValue(offset); return; }
    const animation = Animated.timing(translate, { toValue: offset, duration: 120, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [offset, lifted, translate]);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => latest.current.enabled,
    onMoveShouldSetPanResponder: () => latest.current.enabled,
    onPanResponderGrant: () => latest.current.onStart(),
    onPanResponderMove: (_, gesture) => latest.current.onMove(gesture.dy),
    onPanResponderRelease: () => latest.current.onFinish(),
    onPanResponderTerminate: () => latest.current.onCancel(),
    onPanResponderTerminationRequest: () => false,
  })).current;
  const accessibility: ViewProps = {
    testID: `reorder-${leg}-${stop.dogId}`,
    accessible: true,
    accessibilityLabel: stop.dogName,
    accessibilityHint: enabled ? 'Drag the handle to reorder, or use Move up and Move down.' : undefined,
    accessibilityActions: enabled ? [{ name: 'moveUp', label: 'Move up' }, { name: 'moveDown', label: 'Move down' }] : [],
    onAccessibilityAction: event => {
      if (event.nativeEvent.actionName === 'moveUp') onAction(-1);
      if (event.nativeEvent.actionName === 'moveDown') onAction(1);
    },
  };
  // Keep the options button outside the accessible name/content group, so VoiceOver can reach both.
  return <Animated.View testID={`reorder-layout-${leg}-${stop.dogId}`}
    onLayout={event => onHeight(event.nativeEvent.layout.height)}
    style={[{ transform: [{ translateY: translate }] }, lifted && styles.lifted]}>
    {children(enabled ? <View testID={`drag-${leg}-${stop.dogId}`} {...responder.panHandlers}
      style={styles.handle} accessible={false}><Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.grip}>≡</Text></View> : null, accessibility)}
  </Animated.View>;
}
const styles = StyleSheet.create({
  handle: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  grip: { color: colors.forest700, fontSize: 24 },
  lifted: { zIndex: 10, elevation: 6, backgroundColor: colors.sage, shadowColor: colors.forest900, shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
});
