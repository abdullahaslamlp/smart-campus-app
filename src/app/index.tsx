import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';

const SLATE = '#466179';
const SLATE_DARK = '#2d3f50';
const SLATE_LIGHT = '#b0cce8';
const WHITE = '#ffffff';
const SURFACE = '#f4f7fb';

export default function LandingPage() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      {/* Background gradient rings */}
      <View style={styles.ring1} />
      <View style={styles.ring2} />

      <View style={styles.card}>
        {/* Logo */}
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Text style={{ fontSize: 40 }}>🛡️</Text>
          </View>
          <Text style={styles.appName}>SafePass</Text>
          <Text style={styles.tagline}>Smart Campus Dismissal System</Text>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Portal choices */}
        <Text style={styles.chooseLabel}>Select your portal</Text>

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
          onPress={() => router.push('/admin')}
        >
          <Text style={styles.primaryBtnIcon}>🖥️</Text>
          <View>
            <Text style={styles.primaryBtnTitle}>Admin Portal</Text>
            <Text style={styles.primaryBtnSub}>School staff &amp; administrators</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
          onPress={() => router.push('/parent-login')}
        >
          <Text style={styles.secondaryBtnIcon}>📱</Text>
          <View>
            <Text style={styles.secondaryBtnTitle}>Parent Login</Text>
            <Text style={styles.secondaryBtnSub}>Check in your child for dismissal</Text>
          </View>
          <Text style={[styles.chevron, { color: SLATE }]}>›</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, { borderColor: '#10B981', backgroundColor: '#f0fdf4' }, pressed && styles.btnPressed]}
          onPress={() => router.push('/driver-login' as any)}
        >
          <Text style={styles.secondaryBtnIcon}>🛺</Text>
          <View>
            <Text style={[styles.secondaryBtnTitle, { color: '#065F46' }]}>Transporter / Driver</Text>
            <Text style={styles.secondaryBtnSub}>Rickshaw, Van & Carpool pickup</Text>
          </View>
          <Text style={[styles.chevron, { color: '#065F46' }]}>›</Text>
        </Pressable>

        <Text style={styles.footer}>
          Parent & Transporter accounts are issued by your school administrator.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  ring1: {
    position: 'absolute',
    width: 600,
    height: 600,
    borderRadius: 300,
    borderWidth: 1,
    borderColor: SLATE_LIGHT,
    opacity: 0.3,
  },
  ring2: {
    position: 'absolute',
    width: 900,
    height: 900,
    borderRadius: 450,
    borderWidth: 1,
    borderColor: SLATE_LIGHT,
    opacity: 0.15,
  },
  card: {
    backgroundColor: WHITE,
    borderRadius: 24,
    padding: 40,
    width: '100%',
    maxWidth: 480,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    gap: 16,
  },
  logoWrap: { alignItems: 'center', gap: 8, marginBottom: 4 },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: SLATE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: SLATE,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  appName: { fontSize: 36, fontWeight: '800', color: SLATE_DARK, letterSpacing: -0.5 },
  tagline: { fontSize: 14, color: '#767779', fontWeight: '500', textAlign: 'center' },
  divider: { height: 1, backgroundColor: '#e8e8ea', alignSelf: 'stretch', marginVertical: 4 },
  chooseLabel: { fontSize: 13, fontWeight: '700', color: '#767779', textTransform: 'uppercase', letterSpacing: 1, alignSelf: 'flex-start' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SLATE,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    alignSelf: 'stretch',
    shadowColor: SLATE,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryBtnIcon: { fontSize: 28 },
  primaryBtnTitle: { fontSize: 18, fontWeight: '700', color: WHITE },
  primaryBtnSub: { fontSize: 12, color: SLATE_LIGHT, marginTop: 2 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    alignSelf: 'stretch',
    borderWidth: 2,
    borderColor: SLATE_LIGHT,
  },
  secondaryBtnIcon: { fontSize: 28 },
  secondaryBtnTitle: { fontSize: 18, fontWeight: '700', color: SLATE_DARK },
  secondaryBtnSub: { fontSize: 12, color: '#767779', marginTop: 2 },
  btnPressed: { opacity: 0.75 },
  chevron: { marginLeft: 'auto' as any, fontSize: 24, color: WHITE, fontWeight: '300' },
  footer: { fontSize: 12, color: '#aaa', textAlign: 'center', marginTop: 8, lineHeight: 18 },
});