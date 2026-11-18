import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bus, ChevronRight, School, Users } from 'lucide-react-native';
import { ICON_STROKE, LucideIcon, Mark, color, radius, space, type } from '../lib/ui';

const PORTALS: { href: string; title: string; body: string; Icon: LucideIcon }[] = [
  {
    href: '/parent-login',
    title: 'Parents',
    body: 'Check in when you reach the school and confirm pickup.',
    Icon: Users,
  },
  {
    href: '/driver-login',
    title: 'Drivers and transporters',
    body: 'Vans, rickshaws and carpools collecting several children.',
    Icon: Bus,
  },
  {
    href: '/admin',
    title: 'School staff',
    body: 'Run the dismissal queue, manage students and accounts.',
    Icon: School,
  },
];

export default function LandingPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={[
        styles.scroll,
        { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl },
      ]}
    >
      <View style={[styles.shell, wide && styles.shellWide]}>
        {/* Intro */}
        <View style={[styles.intro, wide && { flex: 1, paddingRight: space.xxl }]}>
          <View style={styles.brand}>
            <Mark size={32} />
            <Text style={styles.wordmark}>SafePass</Text>
          </View>
          <Text style={[type.display, wide && { fontSize: 40, lineHeight: 46 }]}>
            Calmer school pickups.
          </Text>
          <Text style={[type.body, { color: color.muted, maxWidth: 440 }]}>
            Parents and drivers check in when they arrive. Staff send each child to the right gate,
            and everyone sees when they have been picked up.
          </Text>
        </View>

        {/* Portal list */}
        <View style={[styles.panel, wide && { width: 420 }]}>
          <Text style={[type.overline, { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm }]}>
            Sign in as
          </Text>
          {PORTALS.map((p, i) => (
            <Pressable
              key={p.href}
              onPress={() => router.push(p.href as any)}
              accessibilityRole="link"
              style={({ pressed, hovered }: any) => [
                styles.portal,
                i > 0 && styles.portalDivider,
                (pressed || hovered) && { backgroundColor: color.sunken },
              ]}
            >
              <View style={styles.portalIcon}>
                <p.Icon size={20} color={color.accent} strokeWidth={ICON_STROKE} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.heading}>{p.title}</Text>
                <Text style={type.small}>{p.body}</Text>
              </View>
              <ChevronRight size={20} color={color.faint} strokeWidth={ICON_STROKE} />
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={[type.small, styles.footer]}>
        Accounts are issued by your school. If you don’t have one, contact the school office.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg },
  shell: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: space.xl },
  shellWide: { maxWidth: 1040, flexDirection: 'row', alignItems: 'center' },
  intro: { gap: space.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  wordmark: { fontSize: 18, fontWeight: '700', color: color.ink, letterSpacing: -0.2 },
  panel: {
    backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border,
    overflow: 'hidden',
  },
  portal: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.lg,
  },
  portalDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.borderStrong },
  portalIcon: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  footer: { textAlign: 'center', marginTop: space.xl, maxWidth: 480, alignSelf: 'center' },
});
