// Building blocks for the campus admin and super admin portals:
// sidebar / bottom-nav shell, responsive data table, dialogs, filters, KPI tiles.
import { ReactNode, useState } from 'react';
import {
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ellipsis, LucideIcon, Search, X } from 'lucide-react-native';
import { Button, ICON_STROKE, Mark, Notice, color, radius, space, type } from './ui';

/** Below this window width the sidebar becomes a bottom tab bar and tables become cards. */
export const WIDE_BREAKPOINT = 1100;

export function useIsWide() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' ? width >= WIDE_BREAKPOINT : width >= 1024;
}

// ─── Shell ────────────────────────────────────────────────────────────────────
export interface NavItem {
  id: string;
  label: string;
  Icon: LucideIcon;
  group: string;
  /** Shown in the phone bottom bar; everything else goes under "More". */
  primary?: boolean;
}
export interface FooterAction { label: string; Icon: LucideIcon; onPress: () => void }

export function AdminShell({ context, contextSub, user, nav, active, onNavigate, footer, banner, children }: {
  context: string;          // e.g. "School — Branch1"
  contextSub: string;       // e.g. "Campus admin"
  user: string;             // signed-in username
  nav: NavItem[];
  active: string;
  onNavigate: (id: string) => void;
  footer: FooterAction[];
  banner?: ReactNode;
  children: ReactNode;
}) {
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const [moreOpen, setMoreOpen] = useState(false);
  const groups = [...new Set(nav.map(n => n.group))];
  const primary = nav.filter(n => n.primary);
  const secondary = nav.filter(n => !n.primary);
  const moreActive = secondary.some(n => n.id === active);

  const content = (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={{ padding: wide ? space.xl : space.lg, paddingBottom: wide ? space.xxl * 2 : 110 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ width: '100%', maxWidth: 1180, alignSelf: 'center', gap: space.lg }}>
        {banner}
        {children}
      </View>
    </ScrollView>
  );

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: color.bg }}>
        <View style={shell.sidebar}>
          <View style={shell.brand}>
            <Mark size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.heading, { fontSize: 16 }]} numberOfLines={1}>{context}</Text>
              <Text style={type.small} numberOfLines={1}>{contextSub}</Text>
            </View>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: space.sm, gap: space.lg }}>
            {groups.map(g => (
              <View key={g} style={{ gap: 2 }}>
                <Text style={shell.groupLabel}>{g}</Text>
                {nav.filter(n => n.group === g).map(n => <SideItem key={n.id} item={n} active={n.id === active} onPress={() => onNavigate(n.id)} />)}
              </View>
            ))}
          </ScrollView>
          <View style={shell.sideFooter}>
            {footer.map(f => (
              <Pressable key={f.label} onPress={f.onPress} accessibilityRole="button" style={({ pressed, hovered }: any) => [shell.sideItem, (pressed || hovered) && { backgroundColor: color.sunken }]}>
                <f.Icon size={18} color={color.muted} strokeWidth={ICON_STROKE} />
                <Text style={shell.sideLabel}>{f.label}</Text>
              </Pressable>
            ))}
            <Text style={[type.small, { paddingHorizontal: space.md, paddingTop: space.sm }]} numberOfLines={1}>Signed in as {user}</Text>
          </View>
        </View>
        {content}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={[shell.topBar, { paddingTop: Math.max(insets.top, space.md) }]}>
        <Mark size={28} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.heading} numberOfLines={1}>{context}</Text>
          <Text style={type.small} numberOfLines={1}>{contextSub}</Text>
        </View>
      </View>
      {content}
      <View style={[shell.tabBar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        {primary.map(n => <TabItem key={n.id} label={n.label} Icon={n.Icon} active={n.id === active} onPress={() => onNavigate(n.id)} />)}
        <TabItem label="More" Icon={Ellipsis} active={moreActive} onPress={() => setMoreOpen(true)} />
      </View>
      {moreOpen ? (
        <Dialog title="More" onClose={() => setMoreOpen(false)} compact>
          <View style={{ gap: 2 }}>
            {secondary.map(n => (
              <Pressable key={n.id} onPress={() => { setMoreOpen(false); onNavigate(n.id); }} accessibilityRole="button"
                style={({ pressed }) => [shell.sheetItem, (pressed || n.id === active) && { backgroundColor: color.accentSoft }]}>
                <n.Icon size={20} color={n.id === active ? color.accent : color.muted} strokeWidth={ICON_STROKE} />
                <Text style={[type.body, { color: color.ink }, n.id === active && { fontWeight: '600' }]}>{n.label}</Text>
              </Pressable>
            ))}
            <View style={{ height: 1, backgroundColor: color.border, marginVertical: space.sm }} />
            {footer.map(f => (
              <Pressable key={f.label} onPress={() => { setMoreOpen(false); f.onPress(); }} accessibilityRole="button"
                style={({ pressed }) => [shell.sheetItem, pressed && { backgroundColor: color.sunken }]}>
                <f.Icon size={20} color={color.muted} strokeWidth={ICON_STROKE} />
                <Text style={[type.body, { color: color.ink }]}>{f.label}</Text>
              </Pressable>
            ))}
            <Text style={[type.small, { padding: space.md }]}>Signed in as {user}</Text>
          </View>
        </Dialog>
      ) : null}
    </View>
  );
}

function SideItem({ item, active, onPress }: { item: NavItem; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={({ pressed, hovered }: any) => [shell.sideItem, active ? { backgroundColor: color.accentSoft } : (pressed || hovered) && { backgroundColor: color.sunken }]}>
      <item.Icon size={18} color={active ? color.accent : color.muted} strokeWidth={ICON_STROKE} />
      <Text style={[shell.sideLabel, active && { color: color.accent, fontWeight: '600' }]}>{item.label}</Text>
    </Pressable>
  );
}

function TabItem({ label, Icon, active, onPress }: { label: string; Icon: LucideIcon; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }} style={shell.tab}>
      <Icon size={22} color={active ? color.accent : color.muted} strokeWidth={ICON_STROKE} />
      <Text style={[shell.tabLabel, active && { color: color.accent, fontWeight: '600' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// ─── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.md }}>
      <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
        <Text style={type.title}>{title}</Text>
        {description ? <Text style={type.small}>{description}</Text> : null}
      </View>
      {actions ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{actions}</View> : null}
    </View>
  );
}

// ─── KPI tiles ────────────────────────────────────────────────────────────────
export function KpiRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>{children}</View>;
}

export function Kpi({ label, value, hint, Icon, tone = 'default' }: {
  label: string; value: string | number; hint?: string; Icon?: LucideIcon; tone?: 'default' | 'sent' | 'done' | 'warn';
}) {
  const fg = tone === 'sent' ? color.sent : tone === 'done' ? color.done : tone === 'warn' ? color.warn : color.ink;
  return (
    <View style={kpi.tile}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={type.small}>{label}</Text>
        {Icon ? <Icon size={16} color={color.faint} strokeWidth={ICON_STROKE} /> : null}
      </View>
      <Text style={[kpi.value, { color: fg }]}>{value}</Text>
      {hint ? <Text style={type.small} numberOfLines={1}>{hint}</Text> : null}
    </View>
  );
}

// ─── Filters ──────────────────────────────────────────────────────────────────
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[search.wrap, focused && { borderColor: color.accent }]}>
      <Search size={16} color={focused ? color.accent : color.faint} strokeWidth={ICON_STROKE} />
      <TextInput
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={color.faint}
        accessibilityLabel={placeholder} autoCapitalize="none" autoCorrect={false}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={[search.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
          <X size={16} color={color.muted} strokeWidth={ICON_STROKE} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function ChipRow({ options, value, onChange, label }: {
  options: { key: string; label: string }[]; value: string; onChange: (k: string) => void; label?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {label ? <Text style={[type.small, { width: 56 }]}>{label}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }} style={{ flex: 1 }}>
        {options.map(o => {
          const on = o.key === value;
          return (
            <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={[chip.base, on && chip.on]}>
              <Text style={[chip.text, on && chip.textOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Choose one of a few options inside a form. */
export function Segmented({ options, value, onChange, label }: {
  options: string[]; value: string; onChange: (v: string) => void; label: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map(o => (
          <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="button" accessibilityState={{ selected: o === value }}
            style={[chip.base, o === value && chip.on, { paddingVertical: 8, paddingHorizontal: 14 }]}>
            <Text style={[chip.text, o === value && chip.textOn]}>{o}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Data table (rows on wide screens, cards on phones) ──────────────────────
export interface Column<T> {
  key: string;
  title: string;
  /** 'primary' = main line of a card; 'badge' = shown beside it; 'actions' = row buttons. */
  role?: 'primary' | 'badge' | 'actions';
  flex?: number;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({ columns, rows, keyOf, loading, empty, minWidth = 700 }: {
  columns: Column<T>[]; rows: T[]; keyOf: (row: T) => string; loading?: boolean;
  empty: { title: string; body?: string; action?: ReactNode }; minWidth?: number;
}) {
  const wide = useIsWide();

  if (loading) {
    return <View style={table.frame}><Text style={[type.small, { padding: space.xl, textAlign: 'center' }]}>Loading…</Text></View>;
  }
  if (rows.length === 0) {
    return (
      <View style={table.frame}>
        <View style={{ padding: space.xl, alignItems: 'center', gap: space.sm }}>
          <Text style={type.heading}>{empty.title}</Text>
          {empty.body ? <Text style={[type.small, { textAlign: 'center', maxWidth: 360 }]}>{empty.body}</Text> : null}
          {empty.action}
        </View>
      </View>
    );
  }

  if (!wide) {
    const primary = columns.find(c => c.role === 'primary') ?? columns[0];
    const badge = columns.find(c => c.role === 'badge');
    const actions = columns.find(c => c.role === 'actions');
    const rest = columns.filter(c => c !== primary && c !== badge && c !== actions);
    return (
      <View style={{ gap: space.sm }}>
        {rows.map(row => (
          <View key={keyOf(row)} style={table.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>{primary.render(row)}</View>
              {badge ? badge.render(row) : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs }}>
              {rest.map(c => (
                <View key={c.key} style={{ flexDirection: 'row', gap: 6, alignItems: 'baseline', maxWidth: '100%' }}>
                  <Text style={type.small}>{c.title}</Text>
                  <View style={{ flexShrink: 1 }}>{c.render(row)}</View>
                </View>
              ))}
            </View>
            {actions ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.xs, marginTop: space.xs }}>{actions.render(row)}</View> : null}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={table.frame}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth, width: '100%' }}>
          <View style={table.head}>
            {columns.map(c => (
              <View key={c.key} style={{ flex: c.flex ?? 1, minWidth: 0, paddingRight: space.md }}>
                <Text style={table.th}>{c.role === 'actions' ? '' : c.title}</Text>
              </View>
            ))}
          </View>
          {rows.map((row, i) => (
            <View key={keyOf(row)} style={[table.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.borderStrong }]}>
              {columns.map(c => (
                <View key={c.key} style={[{ flex: c.flex ?? 1, minWidth: 0, paddingRight: space.md, justifyContent: 'center' },
                  c.role === 'actions' && { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: space.xs, paddingRight: 0 }]}>
                  {c.render(row)}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Plain table text cell. */
export function Cell({ children, muted, strong, mono }: { children: ReactNode; muted?: boolean; strong?: boolean; mono?: boolean }) {
  return (
    <Text numberOfLines={2} style={[type.body, { fontSize: 14, lineHeight: 20 }, muted && { color: color.muted }, strong && { fontWeight: '600', color: color.ink },
      mono && ({ fontVariant: ['tabular-nums'] } as any)]}>
      {children}
    </Text>
  );
}

// ─── Pill + multi-select chips ────────────────────────────────────────────────
export function Pill({ label, fg, bg, Icon }: { label: string; fg: string; bg: string; Icon?: LucideIcon }) {
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: bg }}>
      {Icon ? <Icon size={13} color={fg} strokeWidth={2.5} /> : null}
      <Text style={{ fontSize: 12, fontWeight: '600', color: fg }}>{label}</Text>
    </View>
  );
}

export function ChipGroup({ options, selected, onToggle, label, empty }: {
  options: { key: string; label: string }[]; selected: string[]; onToggle: (key: string) => void; label: string; empty?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>{label}</Text>
      {options.length === 0 ? <Text style={type.small}>{empty ?? 'Nothing to choose from.'}</Text> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {options.map(o => {
            const on = selected.includes(o.key);
            return (
              <Pressable key={o.key} onPress={() => onToggle(o.key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                style={[chip.base, on && chip.on]}>
                <Text style={[chip.text, on && chip.textOn]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
export function Toast({ tone, text, onClose }: { tone: 'error' | 'success'; text: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[toastStyle.wrap, { top: Math.max(insets.top, space.md) + 4 }]}>
      <Pressable onPress={onClose} accessibilityRole="alert" style={toastStyle.card}>
        <Notice tone={tone}>{text}</Notice>
      </Pressable>
    </View>
  );
}

// ─── Icon button (row actions) ────────────────────────────────────────────────
export function IconButton({ Icon, label, onPress, tone = 'default', disabled }: {
  Icon: LucideIcon; label: string; onPress: () => void; tone?: 'default' | 'danger'; disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      {...(Platform.OS === 'web' ? ({ title: label } as any) : {})}
      style={({ pressed, hovered }: any) => [icon.btn, (pressed || hovered) && { backgroundColor: tone === 'danger' ? color.dangerSoft : color.sunken }, disabled && { opacity: 0.4 }]}>
      <Icon size={17} color={tone === 'danger' ? color.danger : color.muted} strokeWidth={ICON_STROKE} />
    </Pressable>
  );
}

// ─── Dialog ───────────────────────────────────────────────────────────────────
export function Dialog({ title, subtitle, onClose, children, footer, compact }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; compact?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={dlg.overlay} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={[dlg.inner, { paddingTop: Math.max(insets.top, space.lg), paddingBottom: Math.max(insets.bottom, space.lg) }]} keyboardShouldPersistTaps="handled">
        <View style={[dlg.card, compact && { maxWidth: 420 }]}>
          <View style={dlg.head}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={type.heading}>{title}</Text>
              {subtitle ? <Text style={type.small}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={color.muted} strokeWidth={ICON_STROKE} />
            </Pressable>
          </View>
          <View style={{ gap: space.lg }}>{children}</View>
          {footer ? <View style={dlg.foot}>{footer}</View> : null}
        </View>
      </ScrollView>
    </View>
  );
}

export interface ConfirmOptions {
  title: string; message: string; confirmLabel?: string; tone?: 'default' | 'danger';
}

export function ConfirmDialog({ options, onResult }: { options: ConfirmOptions; onResult: (ok: boolean) => void }) {
  return (
    <Dialog
      title={options.title} compact onClose={() => onResult(false)}
      footer={(
        <>
          <Button label="Cancel" variant="secondary" onPress={() => onResult(false)} />
          <Button label={options.confirmLabel ?? 'Confirm'} variant={options.tone === 'danger' ? 'destructive' : 'primary'} onPress={() => onResult(true)} />
        </>
      )}
    >
      <Text style={type.body}>{options.message}</Text>
    </Dialog>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const shell = StyleSheet.create({
  sidebar: { width: 248, backgroundColor: color.surface, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: color.borderStrong },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  groupLabel: { fontSize: 11, fontWeight: '600', color: color.faint, letterSpacing: 0.4, textTransform: 'uppercase', paddingHorizontal: space.lg, paddingBottom: 4 },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.sm, paddingHorizontal: space.md, paddingVertical: 9, borderRadius: radius.md },
  sideLabel: { fontSize: 14, color: color.text },
  sideFooter: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border, paddingVertical: space.sm },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md, backgroundColor: color.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.borderStrong },
  tabBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.borderStrong, paddingTop: space.sm },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 2 },
  tabLabel: { fontSize: 11, color: color.muted },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md, borderRadius: radius.md },
});

const kpi = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: 150, backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, padding: space.lg, gap: 4 },
  value: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
});

const search = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.md, backgroundColor: color.surface, paddingHorizontal: space.md, minHeight: 40, minWidth: 220, flexGrow: 1 },
  input: { flex: 1, minWidth: 0, paddingVertical: 8, fontSize: 14, color: color.ink },
});

const chip = StyleSheet.create({
  base: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surface },
  on: { backgroundColor: color.accent, borderColor: color.accent },
  text: { fontSize: 13, color: color.text, fontWeight: '500' },
  textOn: { color: '#FFFFFF' },
});

const table = StyleSheet.create({
  frame: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, overflow: 'hidden' },
  head: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.sm + 2, backgroundColor: '#FAFBFC', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.borderStrong },
  th: { fontSize: 12, fontWeight: '600', color: color.muted },
  row: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 52 },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, padding: space.md + 2, gap: space.sm },
});

const toastStyle = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 60, paddingHorizontal: space.lg },
  card: { width: '100%', maxWidth: 520, borderRadius: radius.md, backgroundColor: color.surface,
    ...Platform.select<any>({ web: { boxShadow: '0 6px 20px rgba(22,32,43,0.16)' }, default: { elevation: 6 } }) },
});

const icon = StyleSheet.create({
  btn: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});

const dlg = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(22,32,43,0.45)', zIndex: 50 },
  inner: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: { width: '100%', maxWidth: 520, backgroundColor: color.surface, borderRadius: radius.lg, padding: space.xl - 4, gap: space.lg },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  foot: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
});
