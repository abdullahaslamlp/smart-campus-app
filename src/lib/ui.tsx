// SafePass design system: tokens + small shared components used by the
// landing, login and parent / driver screens.
import { ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput,
  TextInputProps, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowRight, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock, Eye, EyeOff, Info,
  LocateFixed, LucideIcon, MapPin, Pause, Search, TriangleAlert,
} from 'lucide-react-native';
import { BranchInfo, BranchOption, PAUSED_MESSAGE, searchBranches } from './tenant';

export type { LucideIcon };

/** Default stroke for every icon: thin enough to sit next to 13–15px text. */
export const ICON_STROKE = 2;

// ─── Tokens ───────────────────────────────────────────────────────────────────
export const color = {
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  sunken: '#F0F2F5',
  border: '#E3E6EB',
  borderStrong: '#CDD2D9',
  ink: '#16202B',
  text: '#2B3642',
  muted: '#667280',
  faint: '#98A1AC',
  accent: '#1F4E79',
  accentPressed: '#183E61',
  accentSoft: '#E8EFF6',
  danger: '#B42318',
  dangerSoft: '#FDEEEC',
  warn: '#8A5A00',
  warnSoft: '#FFF5DB',
  // dismissal statuses
  waiting: '#5B6673', waitingSoft: '#EEF0F3',
  sent: '#1D5FA8', sentSoft: '#E6F0FB',
  done: '#16794A', doneSoft: '#E5F4EC',
};

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const type = StyleSheet.create({
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700', color: color.ink, letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', color: color.ink, letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: color.ink },
  body: { fontSize: 15, lineHeight: 22, color: color.text },
  small: { fontSize: 13, lineHeight: 18, color: color.muted },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: color.text },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: color.muted, letterSpacing: 0.3 },
});

const tabular = Platform.select<any>({ web: { fontVariant: ['tabular-nums'] }, default: { fontVariant: ['tabular-nums'] } });

// ─── Layout ───────────────────────────────────────────────────────────────────
/** Full-height page with a centred content column. */
export function Page({ children, maxWidth = 560, style, scroll = true, bottomInset = 0 }: {
  children: ReactNode; maxWidth?: number; style?: StyleProp<ViewStyle>; scroll?: boolean; bottomInset?: number;
}) {
  const inner = <View style={[{ width: '100%', maxWidth, alignSelf: 'center' }, style]}>{children}</View>;
  if (!scroll) return <View style={styles.page}>{inner}</View>;
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl + bottomInset }}
      keyboardShouldPersistTaps="handled">
      {inner}
    </ScrollView>
  );
}

/** Top app bar: title block on the left, actions on the right. */
export function AppBar({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.appBar, { paddingTop: Math.max(insets.top, space.md) }]}>
      <View style={styles.appBarInner}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.heading} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={type.small} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  return <View style={[styles.card, padded && { padding: space.lg }, style]}>{children}</View>;
}

export function SectionHeader({ title, aside }: { title: string; aside?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={type.heading}>{title}</Text>
      {aside ? <Text style={type.small}>{aside}</Text> : null}
    </View>
  );
}

/** The SafePass mark: a small ink square with a check. */
export function Mark({ size = 36 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Check size={size * 0.58} color="#FFFFFF" strokeWidth={3} />
    </View>
  );
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export function Button({ label, onPress, variant = 'primary', loading, disabled, size = 'md', style, full, icon: Icon }: {
  label: string; onPress?: () => void; variant?: ButtonVariant; loading?: boolean; disabled?: boolean;
  size?: 'sm' | 'md' | 'lg'; style?: StyleProp<ViewStyle>; full?: boolean; icon?: LucideIcon;
}) {
  const v = buttonVariants[variant];
  const h = size === 'lg' ? 52 : size === 'sm' ? 34 : 44;
  const off = disabled || loading;
  const fg = disabled ? color.faint : v.fg;
  const fontSize = size === 'sm' ? 13 : size === 'lg' ? 16 : 15;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        { height: h, paddingHorizontal: size === 'sm' ? space.md : space.lg, backgroundColor: v.bg, borderColor: v.border },
        full && { alignSelf: 'stretch' },
        pressed && !off && { backgroundColor: v.pressed },
        disabled && !loading && { backgroundColor: color.sunken, borderColor: color.sunken },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} size="small" /> : (
        <>
          {Icon ? <Icon size={fontSize + 2} color={fg} strokeWidth={ICON_STROKE} /> : null}
          <Text style={[styles.buttonText, { color: fg, fontSize }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string; pressed: string }> = {
  primary: { bg: color.accent, fg: '#FFFFFF', border: color.accent, pressed: color.accentPressed },
  success: { bg: color.done, fg: '#FFFFFF', border: color.done, pressed: '#11603A' },
  secondary: { bg: color.surface, fg: color.ink, border: color.borderStrong, pressed: color.sunken },
  ghost: { bg: 'transparent', fg: color.accent, border: 'transparent', pressed: color.accentSoft },
  danger: { bg: 'transparent', fg: color.danger, border: 'transparent', pressed: color.dangerSoft },
};

// ─── Inputs ───────────────────────────────────────────────────────────────────
export function TextField({ label, hint, error, style, trailing, leading: Leading, ...input }: TextInputProps & {
  label: string; hint?: string; error?: string; trailing?: ReactNode; leading?: LucideIcon;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>{label}</Text>
      <View style={[styles.inputWrap, focused && styles.inputFocused, !!error && { borderColor: color.danger }]}>
        {Leading ? (
          <View style={{ paddingLeft: space.md }} pointerEvents="none">
            <Leading size={18} color={focused ? color.accent : color.faint} strokeWidth={ICON_STROKE} />
          </View>
        ) : null}
        <TextInput
          placeholderTextColor={color.faint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={label}
          {...input}
          onFocus={e => { setFocused(true); input.onFocus?.(e); }}
          onBlur={e => { setFocused(false); input.onBlur?.(e); }}
          style={[styles.input, !!Leading && { paddingLeft: space.sm }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any), style]}
        />
        {trailing}
      </View>
      {error ? <Text style={[type.small, { color: color.danger }]}>{error}</Text>
        : hint ? <Text style={type.small}>{hint}</Text> : null}
    </View>
  );
}

export function PasswordField(props: TextInputProps & { label: string; hint?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      secureTextEntry={!visible}
      autoComplete="current-password"
      trailing={(
        <Pressable onPress={() => setVisible(v => !v)} hitSlop={8} style={styles.inputAction}
          accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'}>
          {visible
            ? <EyeOff size={18} color={color.muted} strokeWidth={ICON_STROKE} />
            : <Eye size={18} color={color.muted} strokeWidth={ICON_STROKE} />}
        </Pressable>
      )}
    />
  );
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
/** True for "text", 3, and mixed JSX text like {`all ${n}`} or `all {n} children` (an array of primitives). */
function isTextLike(node: ReactNode): boolean {
  const prim = (x: unknown) => typeof x === 'string' || typeof x === 'number';
  return prim(node) || (Array.isArray(node) && node.length > 0 && node.every(prim));
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'error' | 'warn' | 'success'; title?: string; children?: ReactNode }) {
  const t = {
    info: { bg: color.accentSoft, fg: color.accent, Icon: Info },
    error: { bg: color.dangerSoft, fg: color.danger, Icon: CircleAlert },
    warn: { bg: color.warnSoft, fg: color.warn, Icon: TriangleAlert },
    success: { bg: color.doneSoft, fg: color.done, Icon: CircleCheck },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <t.Icon size={18} color={t.fg} strokeWidth={ICON_STROKE} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[type.label, { color: t.fg }]}>{title}</Text> : null}
        {isTextLike(children) ? <Text style={[type.small, { color: t.fg }]}>{children}</Text> : children}
      </View>
    </View>
  );
}

export type DismissalStatus = 'waiting' | 'dispatched' | 'arrived' | 'received';

export const statusMeta: Record<DismissalStatus, { label: string; fg: string; bg: string; Icon: LucideIcon }> = {
  waiting: { label: 'In class', fg: color.waiting, bg: color.waitingSoft, Icon: Clock },
  dispatched: { label: 'Sent to gate', fg: color.sent, bg: color.sentSoft, Icon: ArrowRight },
  arrived: { label: 'At gate', fg: color.sent, bg: color.sentSoft, Icon: MapPin },
  received: { label: 'Picked up', fg: color.done, bg: color.doneSoft, Icon: Check },
};

export function StatusPill({ status }: { status: DismissalStatus }) {
  const m = statusMeta[status] ?? statusMeta.waiting;
  return (
    <View style={[styles.pill, { backgroundColor: m.bg }]}>
      <m.Icon size={13} color={m.fg} strokeWidth={2.5} />
      <Text style={[styles.pillText, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color.sunken, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.36, fontWeight: '600', color: color.text }}>{initials}</Text>
    </View>
  );
}

/** One row of the children / route list. */
export function StudentRow({ name, meta, status, last }: { name: string; meta: string; status: DismissalStatus; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <Avatar name={name} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { fontWeight: '600', color: color.ink }]} numberOfLines={1}>{name}</Text>
        <Text style={type.small} numberOfLines={1}>{meta}</Text>
      </View>
      <StatusPill status={status} />
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl, backgroundColor: color.bg }}>
      <ActivityIndicator color={color.accent} />
      {label ? <Text style={type.small}>{label}</Text> : null}
    </View>
  );
}

// ─── Distance panel (parent + driver) ────────────────────────────────────────
export function DistancePanel({ distance, radius: r, locating, onLocate, onSimulate, footnote }: {
  distance: number | null; radius: number; locating?: boolean;
  onLocate: () => void; onSimulate?: (m: number) => void; footnote?: string;
}) {
  const inRange = distance != null && distance <= r;
  // Bar spans 0 → 3× radius; the tick marks the geofence edge.
  const span = r * 3;
  const fill = distance == null ? 0 : Math.max(0.02, 1 - Math.min(distance, span) / span);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <MapPin size={14} color={color.muted} strokeWidth={ICON_STROKE} />
        <Text style={type.overline}>Distance to school gate</Text>
      </View>
      {distance == null ? (
        <Text style={[type.title, { color: color.faint, marginTop: space.sm }]}>Not located yet</Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: space.xs }}>
          <Text style={[styles.bigNumber, tabular, { color: color.ink }]}>{distance.toLocaleString()}</Text>
          <Text style={[type.heading, { color: color.muted, fontWeight: '500' }]}>m</Text>
        </View>
      )}
      <Text style={[type.small, { color: inRange ? color.done : color.muted, marginTop: 2 }]}>
        {distance == null
          ? `Update your location when you arrive. Check-in opens within ${r} m.`
          : inRange ? `Within the ${r} m pickup zone.` : `Check-in opens within ${r} m.`}
      </Text>

      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.trackFill, { width: `${fill * 100}%`, backgroundColor: inRange ? color.done : color.accent }]} />
        <View style={[styles.trackTick, { left: `${(2 / 3) * 100}%` }]} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.lg }}>
        <Button label={locating ? 'Locating…' : 'Update location'} variant="secondary" size="sm" onPress={onLocate}
          loading={locating} icon={LocateFixed} />
        {onSimulate ? (
          <View style={styles.simGroup}>
            <Text style={[type.small, { color: color.faint }]}>Demo:</Text>
            <Pressable onPress={() => onSimulate(r + 70)} hitSlop={6}><Text style={styles.simLink}>Outside</Text></Pressable>
            <Pressable onPress={() => onSimulate(Math.round(r * 0.3))} hitSlop={6}><Text style={styles.simLink}>Inside</Text></Pressable>
          </View>
        ) : null}
      </View>
      {footnote ? <Text style={[type.small, { marginTop: space.md }]}>{footnote}</Text> : null}
    </Card>
  );
}

// ─── Bottom action bar ────────────────────────────────────────────────────────
export function ActionBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: space.sm }}>{children}</View>
    </View>
  );
}

// ─── Campus picker ────────────────────────────────────────────────────────────
export function CampusPicker({ value, onChange }: { value: BranchOption | null; onChange: (b: BranchOption | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BranchOption[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('loading');

  useEffect(() => {
    if (value) return;
    let cancelled = false;
    setState('loading');
    const t = setTimeout(async () => {
      try {
        const r = await searchBranches(query);
        if (!cancelled) { setResults(r); setState('idle'); }
      } catch {
        if (!cancelled) setState('error');
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, value]);

  if (value) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={type.label}>School</Text>
        <View style={[styles.inputWrap, { paddingVertical: space.md, paddingHorizontal: space.md }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.body, { fontWeight: '600', color: color.ink }]} numberOfLines={1}>{value.school_name}</Text>
            <Text style={type.small} numberOfLines={1}>{value.branch_name}</Text>
          </View>
          <Pressable onPress={() => onChange(null)} hitSlop={8} accessibilityRole="button">
            <Text style={[type.small, { color: color.accent, fontWeight: '600' }]}>Change</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: space.sm }}>
      <TextField label="School" placeholder="Search by school or campus name" value={query} onChangeText={setQuery}
        leading={Search} />
      <ScrollView style={styles.listBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {state === 'loading' && results.length === 0 ? (
          <View style={{ padding: space.lg }}><ActivityIndicator color={color.accent} /></View>
        ) : state === 'error' ? (
          <Text style={[type.small, { padding: space.lg }]}>Couldn’t load schools. Check your connection.</Text>
        ) : results.length === 0 ? (
          <Text style={[type.small, { padding: space.lg }]}>No schools match “{query}”.</Text>
        ) : results.map((r, i) => (
          <Pressable key={r.branch_id} onPress={() => onChange(r)} accessibilityRole="button"
            style={({ pressed }) => [styles.listItem, i > 0 && styles.listItemDivider, pressed && { backgroundColor: color.sunken }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.body, { fontWeight: '600', color: color.ink }]} numberOfLines={1}>{r.school_name}</Text>
              <Text style={type.small} numberOfLines={1}>{r.branch_name}</Text>
            </View>
            {r.status === 'paused' ? <Text style={[type.small, { color: color.warn, fontWeight: '600' }]}>Paused</Text> : null}
            <ChevronRight size={18} color={color.faint} strokeWidth={ICON_STROKE} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Sign-in layout ───────────────────────────────────────────────────────────
export function AuthLayout({ title, subtitle, onBack, footer, children }: {
  title: string; subtitle?: string; onBack: () => void; footer?: string; children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={{
        flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg,
        paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: space.xl }}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="link"
          style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -4 }}>
          <ChevronLeft size={18} color={color.accent} strokeWidth={ICON_STROKE} />
          <Text style={[type.small, { color: color.accent, fontWeight: '600' }]}>Back</Text>
        </Pressable>
        <View style={{ gap: space.sm }}>
          <Mark size={36} />
          <Text style={[type.title, { marginTop: space.md }]}>{title}</Text>
          {subtitle ? <Text style={[type.body, { color: color.muted }]}>{subtitle}</Text> : null}
        </View>
        <View style={{ gap: space.lg }}>{children}</View>
        {footer ? <Text style={type.small}>{footer}</Text> : null}
      </View>
    </ScrollView>
  );
}

// ─── Paused campus ────────────────────────────────────────────────────────────
export function PausedNotice({ branch, onExit }: { branch: BranchInfo | null; onExit: () => void }) {
  return (
    <View style={[styles.page, { justifyContent: 'center', padding: space.lg }]}>
      <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: space.lg }}>
        <View style={styles.pauseGlyph}>
          <Pause size={22} color={color.warn} fill={color.warn} strokeWidth={ICON_STROKE} />
        </View>
        <View style={{ gap: space.sm }}>
          <Text style={type.title}>{branch ? 'This campus is paused' : 'Couldn’t open your campus'}</Text>
          {branch ? <Text style={type.small}>{branch.school_name} · {branch.name}</Text> : null}
          <Text style={type.body}>
            {branch
              ? PAUSED_MESSAGE
              : 'Check your internet connection and try again. If it keeps happening, contact the school office.'}
          </Text>
        </View>
        <Button label="Back to start" variant="secondary" onPress={onExit} full />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  appBar: { backgroundColor: color.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.borderStrong, paddingHorizontal: space.lg, paddingBottom: space.md },
  appBarInner: { width: '100%', maxWidth: 560, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.md },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.sm, paddingHorizontal: 2 },

  button: { borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.sm },
  buttonText: { fontWeight: '600' },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.borderStrong,
    borderRadius: radius.md, backgroundColor: color.surface, minHeight: 46,
  },
  inputFocused: { borderColor: color.accent, ...Platform.select<any>({ web: { boxShadow: `0 0 0 3px ${color.accentSoft}` }, default: {} }) },
  input: { flex: 1, minWidth: 0, paddingHorizontal: space.md, paddingVertical: 11, fontSize: 15, color: color.ink },
  inputAction: { paddingHorizontal: space.md, height: '100%', justifyContent: 'center' },

  notice: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md - 2, gap: space.sm },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontSize: 12, fontWeight: '600' },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.borderStrong },

  bigNumber: { fontSize: 44, lineHeight: 50, fontWeight: '700', letterSpacing: -1 },
  track: { height: 6, borderRadius: 3, backgroundColor: color.sunken, marginTop: space.lg, overflow: 'visible' },
  trackFill: { height: 6, borderRadius: 3 },
  trackTick: { position: 'absolute', top: -3, width: 2, height: 12, borderRadius: 1, backgroundColor: color.muted },
  simGroup: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginLeft: 'auto' },
  simLink: { fontSize: 13, color: color.muted, textDecorationLine: 'underline' },

  actionBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.borderStrong,
    paddingHorizontal: space.lg, paddingTop: space.md,
  },

  listBox: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.surface, maxHeight: 248, overflow: 'hidden' },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md - 2 },
  listItemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },

  pauseGlyph: { width: 48, height: 48, borderRadius: radius.lg, backgroundColor: color.warnSoft, alignItems: 'center', justifyContent: 'center' },
});
