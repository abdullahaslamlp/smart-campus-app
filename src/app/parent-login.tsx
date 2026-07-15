import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../supabase';

const SLATE = '#466179';
const SLATE_DARK = '#2d3f50';
const SLATE_LIGHT = '#b0cce8';
const WHITE = '#ffffff';
const SURFACE = '#f4f7fb';
const BORDER = '#c3c7cd';
const RED = '#c0392b';

// ─── Simple session store (web: sessionStorage; native: module-level var) ──────
export let parentSession: { parentId: string; fullName: string } | null = null;

export function setParentSession(s: typeof parentSession) {
  parentSession = s;
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    if (s) sessionStorage.setItem('parentSession', JSON.stringify(s));
    else sessionStorage.removeItem('parentSession');
  }
}

export function getParentSession(): typeof parentSession {
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    const raw = sessionStorage.getItem('parentSession');
    if (raw) return JSON.parse(raw);
  }
  return parentSession;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ParentLogin() {
  const router = useRouter();
  const [parentId, setParentId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    // ── Whitebox: basic client-side validation ──
    const trimId = parentId.trim().toLowerCase();
    const trimPw = password.trim();
    if (!trimId || !trimPw) {
      setError('Please enter both your Parent ID and password.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      // ── Query parent_accounts table ──
      const { data, error: dbErr } = await supabase
        .from('parent_accounts')
        .select('parent_id, full_name, password, is_active')
        .eq('parent_id', trimId)
        .single();

      // ── Whitebox: handle DB errors separately from "not found" ──
      if (dbErr) {
        if (dbErr.code === 'PGRST116') {
          // No row found
          setError('No account found with that Parent ID.');
        } else {
          setError('Connection error. Please try again.');
          console.error('[login]', dbErr.message);
        }
        return;
      }

      // ── Greybox: account must be active ──
      if (!data.is_active) {
        setError('Your account has been deactivated. Contact the school office.');
        return;
      }

      // ── Blackbox: password check ──
      if (data.password !== trimPw) {
        setError('Incorrect password. Please try again.');
        return;
      }

      // ── Success: store session and navigate ──
      setParentSession({ parentId: data.parent_id, fullName: data.full_name });
      router.replace('/parent-app');

    } catch (e: any) {
      setError('An unexpected error occurred.');
      console.error('[login]', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.ring1} />
      <View style={styles.ring2} />

      <View style={styles.card}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={{ fontSize: 32 }}>📱</Text>
          </View>
          <Text style={styles.title}>Parent Login</Text>
          <Text style={styles.subtitle}>Enter your credentials issued by the school</Text>
        </View>

        {/* Error banner */}
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠️  {error}</Text>
          </View>
        ) : null}

        {/* Fields */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Parent ID</Text>
          {Platform.OS === 'web' ? (
            // @ts-ignore
            <input
              style={styles.inputWeb as any}
              placeholder="e.g. parent_001"
              value={parentId}
              onChange={(e: any) => setParentId(e.target.value)}
              autoComplete="username"
            />
          ) : (
            <TextInput
              style={styles.input}
              placeholder="e.g. parent_001"
              value={parentId}
              onChangeText={setParentId}
              autoCapitalize="none"
              placeholderTextColor="#aaa"
            />
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <input
                style={{ ...styles.inputWeb, flex: 1 } as any}
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e: any) => setPassword(e.target.value)}
                onKeyDown={(e: any) => e.key === 'Enter' && handleLogin()}
                autoComplete="current-password"
              />
            ) : (
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholderTextColor="#aaa"
              />
            )}
            <Pressable style={styles.eyeBtn} onPress={() => setShowPassword(p => !p)}>
              <Text style={{ fontSize: 18 }}>{showPassword ? '🙈' : '👁️'}</Text>
            </Pressable>
          </View>
        </View>

        {/* Login button */}
        <Pressable
          style={({ pressed }) => [styles.loginBtn, (loading || pressed) && { opacity: 0.8 }]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={WHITE} />
            : <Text style={styles.loginBtnText}>Login →</Text>
          }
        </Pressable>

        {/* Back */}
        <Pressable style={styles.backBtn} onPress={() => router.replace('/')}>
          <Text style={styles.backBtnText}>← Back to Home</Text>
        </Pressable>

        <Text style={styles.helpText}>
          Forgot your credentials? Contact your school's front office.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', padding: 24 },
  ring1: { position: 'absolute', width: 500, height: 500, borderRadius: 250, borderWidth: 1, borderColor: SLATE_LIGHT, opacity: 0.3 },
  ring2: { position: 'absolute', width: 800, height: 800, borderRadius: 400, borderWidth: 1, borderColor: SLATE_LIGHT, opacity: 0.15 },
  card: {
    backgroundColor: WHITE, borderRadius: 20, padding: 36,
    width: '100%', maxWidth: 440, gap: 16,
    shadowColor: '#000', shadowOpacity: 0.09, shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  header: { alignItems: 'center', gap: 8, marginBottom: 4 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: SLATE, alignItems: 'center', justifyContent: 'center',
    shadowColor: SLATE, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  title: { fontSize: 28, fontWeight: '800', color: SLATE_DARK },
  subtitle: { fontSize: 13, color: '#767779', textAlign: 'center' },
  errorBanner: { backgroundColor: '#fdecea', borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: RED },
  errorText: { fontSize: 13, color: RED, fontWeight: '600' },
  fieldGroup: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: '#767779', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    color: '#1a1c1d', backgroundColor: '#fafafa',
  },
  inputWeb: {
    borderWidth: 1.5, borderStyle: 'solid', borderColor: BORDER, borderRadius: 10,
    paddingLeft: 14, paddingRight: 14, height: 46, fontSize: 15,
    color: '#1a1c1d', backgroundColor: '#fafafa', fontFamily: 'inherit',
    width: '100%', boxSizing: 'border-box', outline: 'none',
  } as any,
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyeBtn: { padding: 8 },
  loginBtn: {
    backgroundColor: SLATE, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginTop: 4,
    shadowColor: SLATE, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  loginBtnText: { color: WHITE, fontSize: 17, fontWeight: '700' },
  backBtn: { alignItems: 'center', paddingVertical: 4 },
  backBtnText: { color: SLATE, fontSize: 14, fontWeight: '600' },
  helpText: { fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 18 },
});
