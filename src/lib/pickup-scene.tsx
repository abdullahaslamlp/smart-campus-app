// The pickup scene shown to parents and drivers.
//
//   * the school sits in a circle in the middle, inside a green dashed "pickup zone"
//   * the person's vehicle is placed outside the school but inside the zone, at a spot
//     that follows their real distance (outside the zone ring when they are too far)
//   * each child is an emoji that hops up and down every few seconds, and stands in one of
//     three places: in the school, at the gate, or with the parent / driver
import { ReactNode, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { School } from 'lucide-react-native';
import { color, radius, space, type } from './ui';

export type KidStatus = 'waiting' | 'dispatched' | 'arrived' | 'received';
export interface SceneKid { id: string; name: string; status: KidStatus }

const PALETTE = {
  sky: '#E3F1FF',
  zoneFill: 'rgba(52,178,107,0.16)', zoneLine: '#34B26B',
  school: '#2F6FE4', schoolSoft: '#E3EEFF',
  gate: '#F08A24', gateSoft: '#FFEBD2', gateInk: '#A5560A',
  withYou: '#16A05B', withYouSoft: '#DDF5E7', withYouInk: '#12724A',
};

// Stable emoji per child (same child, same emoji, whatever the order).
const kidEmoji = (name: string) => ((name.charCodeAt(0) || 0) + name.length) % 2 ? '👧' : '👦';

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setReduce(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
}

/** Hops up and down for a moment, then rests for a few seconds. Each emoji has its own rhythm. */
function Hop({ seed, children }: { seed: number; children: ReactNode }) {
  const y = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) return;
    const native = Platform.OS !== 'web';
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const hop = () => {
      if (stopped) return;
      Animated.sequence([
        Animated.timing(y, { toValue: -10, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: native }),
        Animated.timing(y, { toValue: 0, duration: 320, easing: Easing.bounce, useNativeDriver: native }),
      ]).start(() => { if (!stopped) timer = setTimeout(hop, 2200 + ((seed * 937) % 2600)); });
    };
    timer = setTimeout(hop, 300 + seed * 420);
    return () => { stopped = true; clearTimeout(timer); y.stopAnimation(); };
  }, [reduce, seed, y]);
  return <Animated.View style={{ transform: [{ translateY: y }] }}>{children}</Animated.View>;
}

function Kids({ kids, size, max, seedBase, tone }: { kids: SceneKid[]; size: number; max: number; seedBase: number; tone: string }) {
  const shown = kids.slice(0, max);
  const extra = kids.length - shown.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' }}>
      {shown.map((k, i) => (
        <Hop key={k.id} seed={seedBase + i}>
          <Text style={{ fontSize: size, lineHeight: size + 6 }}>{kidEmoji(k.name)}</Text>
        </Hop>
      ))}
      {extra > 0 ? <Text style={{ fontSize: Math.round(size * 0.62), fontWeight: '700', color: tone, marginLeft: 2, marginBottom: 2 }}>+{extra}</Text> : null}
    </View>
  );
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function PickupScene({ distance, radiusM, kids, vehicle, who }: {
  distance: number | null;
  radiusM: number;
  kids: SceneKid[];
  /** The person's vehicle emoji, e.g. 🚗 or 🚐. */
  vehicle: string;
  who: 'parent' | 'driver';
}) {
  const [w, setW] = useState(320);
  const S = Math.max(260, Math.min(w, 380));
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.34;     // pickup zone
  const r0 = S * 0.125;   // school circle

  const inSchool = kids.filter(k => k.status === 'waiting');
  const atGate = kids.filter(k => k.status === 'dispatched' || k.status === 'arrived');
  const withYou = kids.filter(k => k.status === 'received');
  const located = distance != null;
  const inZone = located && distance <= radiusM;

  // The vehicle sits at the bottom-right; the gate is at the top-right of the school.
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const youAngle = rad(52);
  const gateAngle = rad(-32);
  const maxR = S / 2 - 34;
  const youR = !located ? R + 12
    : distance <= radiusM ? lerp(r0 + 34, R - 4, Math.min(distance / radiusM, 1))
      : lerp(R + 6, maxR, Math.min((distance / radiusM - 1) / 0.6, 1));
  const you = { x: cx + youR * Math.cos(youAngle), y: cy + youR * Math.sin(youAngle) };
  const gate = { x: cx + (r0 + 40) * Math.cos(gateAngle), y: cy + (r0 + 40) * Math.sin(gateAngle) };

  const at = (p: { x: number; y: number }, width: number, height: number) =>
    ({ position: 'absolute' as const, left: p.x - width / 2, top: p.y - height / 2, width, height, alignItems: 'center' as const, justifyContent: 'center' as const });

  const them = who === 'parent' ? 'your children' : 'the children on your route';
  const line = kids.length === 0 ? 'No children are linked yet.'
    : withYou.length === kids.length ? `All ${them} are with you. Safe journey!`
      : atGate.length > 0 ? `${atGate.length} ${plural(atGate.length, 'child is', 'children are')} at the gate, ready to be collected.`
        : !located ? 'Update your location to see where you are.'
          : inZone ? 'You are in the pickup zone.'
            : `You are ${distance} m away. The pickup zone starts at ${radiusM} m.`;

  const a11y = `${inSchool.length} in school, ${atGate.length} at the gate, ${withYou.length} with you. ${line}`;

  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ width: '100%', alignItems: 'center', gap: space.md }}>
      <View accessible accessibilityLabel={a11y} style={[styles.scene, { width: S, height: S }]}>
        {/* pickup zone */}
        <View style={{ position: 'absolute', left: cx - R, top: cy - R, width: R * 2, height: R * 2, borderRadius: R,
          backgroundColor: PALETTE.zoneFill, borderWidth: 2, borderColor: PALETTE.zoneLine, borderStyle: 'dashed' }} />
        <View style={[at({ x: cx, y: cy - R }, 120, 22), { zIndex: 1 }]}>
          <View style={styles.zoneTag}><Text style={styles.zoneTagText}>Pickup zone · {radiusM} m</Text></View>
        </View>

        {/* school */}
        <View style={{ position: 'absolute', left: cx - r0, top: cy - r0, width: r0 * 2, height: r0 * 2, borderRadius: r0,
          backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: PALETTE.school, alignItems: 'center', justifyContent: 'center', gap: 2, ...shadow }}>
          <School size={Math.round(r0 * 0.62)} color={PALETTE.school} strokeWidth={2.2} />
          {inSchool.length > 0 ? <Kids kids={inSchool} size={Math.round(r0 * 0.32)} max={3} seedBase={0} tone={PALETTE.school} /> : null}
        </View>
        <View style={[at({ x: cx, y: cy + r0 + 12 }, 90, 18)]}>
          <Text style={[styles.label, { color: PALETTE.school }]}>School</Text>
        </View>

        {/* gate */}
        <View style={at(gate, 92, 58)}>
          {atGate.length > 0 ? <Kids kids={atGate} size={20} max={3} seedBase={10} tone={PALETTE.gateInk} /> : null}
          <View style={styles.gatePill}><Text style={styles.gatePillText}>Gate</Text></View>
        </View>

        {/* you */}
        <View style={[at(you, 96, 92), { opacity: located ? 1 : 0.55 }]}>
          {withYou.length > 0 ? <Kids kids={withYou} size={20} max={3} seedBase={20} tone={PALETTE.withYouInk} /> : null}
          <View style={[styles.vehicle, { borderColor: inZone ? PALETTE.withYou : PALETTE.gate }]}>
            <Text style={{ fontSize: 24, lineHeight: 30 }}>{vehicle}</Text>
          </View>
          <View style={[styles.youPill, { backgroundColor: inZone ? PALETTE.withYouSoft : PALETTE.gateSoft }]}>
            <Text style={[styles.youPillText, { color: inZone ? PALETTE.withYouInk : PALETTE.gateInk }]}>
              {located ? `You · ${distance} m` : 'Not located'}
            </Text>
          </View>
        </View>
      </View>

      <Text style={[type.body, { textAlign: 'center', color: color.ink, fontWeight: '600', maxWidth: S }]}>{line}</Text>

      <View style={[styles.legend, { width: S }]}>
        <Chip bg={PALETTE.schoolSoft} fg={PALETTE.school} icon="🏫" label="In school" n={inSchool.length} />
        <Chip bg={PALETTE.gateSoft} fg={PALETTE.gateInk} icon="🚪" label="At the gate" n={atGate.length} />
        <Chip bg={PALETTE.withYouSoft} fg={PALETTE.withYouInk} icon={vehicle} label="With you" n={withYou.length} />
      </View>
    </View>
  );
}

function Chip({ bg, fg, icon, label, n }: { bg: string; fg: string; icon: string; label: string; n: number }) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={{ fontSize: 18, lineHeight: 22 }}>{icon}</Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color: fg, fontVariant: ['tabular-nums'] }}>{n}</Text>
      <Text style={{ fontSize: 11, fontWeight: '600', color: fg }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const shadow = Platform.select<any>({
  web: { boxShadow: '0 4px 14px rgba(47,111,228,0.28)' },
  default: { elevation: 5, shadowColor: PALETTE.school, shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});

const styles = StyleSheet.create({
  scene: { backgroundColor: PALETTE.sky, borderRadius: 28, overflow: 'hidden' },
  zoneTag: { backgroundColor: '#FFFFFF', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: PALETTE.zoneLine },
  zoneTagText: { fontSize: 10, fontWeight: '700', color: PALETTE.withYouInk },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  gatePill: { backgroundColor: PALETTE.gate, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  gatePillText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
  vehicle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 3, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  youPill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },
  youPillText: { fontSize: 10, fontWeight: '800' },
  legend: { flexDirection: 'row', gap: space.sm },
  chip: { flex: 1, borderRadius: radius.lg, paddingVertical: space.sm, alignItems: 'center', gap: 0 },
});
