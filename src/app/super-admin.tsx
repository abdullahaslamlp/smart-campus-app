// SafePass Super Admin portal — platform owner / school-group super admins.
// Every action goes through token-checked sa_* RPCs; the server enforces role + scope.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  useWindowDimensions,
} from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../../supabase';
import { loadSession, saveSession } from '../lib/tenant';
import { setAdminSession } from './admin';

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = 'active' | 'paused' | 'archived';
type Role = 'owner' | 'super' | 'branch';

interface SuperSession { token: string; adminId: string; username: string; fullName: string | null; role: Role }

interface BranchRow {
  id: string; name: string; code: string; status: Status;
  lat: number; lng: number; geofence_radius: number; created_at: string;
  students: number; active_dismissals: number; received: number; parents: number; drivers: number;
  admins: string[];
}
interface SchoolRow {
  id: string; name: string; slug: string; status: Status; created_at: string;
  can_manage: boolean; branches: BranchRow[];
}
interface AdminRow {
  id: string; username: string; full_name: string | null; role: Role; is_active: boolean;
  created_at: string; is_self: boolean;
  scopes: { type: 'school' | 'branch'; id: string; name: string }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SESSION_KEY = 'superSession_v1';
const SLATE = '#466179', SLATE_DARK = '#2d3f50', WHITE = '#ffffff', SURFACE = '#f4f7fb';
const BORDER = '#c3c7cd', MUTED = '#767779', TEXT = '#1a1c1d', RED = '#c0392b';
const POLL_MS = 20000;

const ERRORS: [string, string][] = [
  ['session_expired', 'Your session has expired. Please sign in again.'],
  ['forbidden', 'You do not have permission to do that.'],
  ['archive_first', 'Archive it first — only archived schools or campuses can be permanently deleted.'],
  ['confirm_mismatch', 'The confirmation text does not match.'],
  ['invalid_branch_code', 'Campus code must be 2–32 characters: A–Z, 0–9, "-" or "_".'],
  ['invalid_slug', 'School slug must be 2–48 characters: a–z, 0–9 or "-".'],
  ['invalid_school_name', 'Please enter a school name.'],
  ['invalid_branch_name', 'Please enter a campus name.'],
  ['invalid_location', 'Please enter a valid latitude and longitude.'],
  ['invalid_radius', 'Geofence radius must be between 50 and 500 metres.'],
  ['invalid_username', 'Username must be 3–32 characters: a–z, 0–9, "_" or ".".'],
  ['weak_password', 'Password must be at least 8 characters.'],
  ['branch_admin_needs_branches', 'Pick at least one campus for a campus admin.'],
  ['super_admin_needs_scope', 'Pick at least one school or campus for a super admin.'],
  ['cannot_deactivate_self', 'You cannot deactivate your own account.'],
  ['branches_code_key', 'That campus code is already in use.'],
  ['schools_slug_key', 'That school slug is already in use.'],
  ['admin_accounts_username_key', 'That admin username is already taken.'],
];
const errText = (e: any) => {
  const m: string = e?.message || String(e);
  return ERRORS.find(([k]) => m.includes(k))?.[1] ?? m;
};

const effectiveStatus = (school: SchoolRow, b: BranchRow): Status =>
  school.status !== 'active' ? school.status : b.status;

const slugify = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function confirmAction(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise(res => Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
    { text: 'Confirm', style: 'destructive', onPress: () => res(true) },
  ]));
}

// ─── Small module-level components (stable identity keeps input focus) ──────
function Field({ label, value, onChange, placeholder, secret, hint, autoCapitalize = 'none' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  secret?: boolean; hint?: string; autoCapitalize?: 'none' | 'characters' | 'words';
}) {
  return (
    <View style={{ gap: 4, flex: 1, minWidth: 160 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input} value={value} onChangeText={onChange} placeholder={placeholder}
        placeholderTextColor="#aaa" secureTextEntry={secret} autoCapitalize={autoCapitalize}
        autoCorrect={false}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const c = status === 'active' ? { bg: '#D1FAE5', fg: '#065F46' }
    : status === 'paused' ? { bg: '#FEF3C7', fg: '#92400E' } : { bg: '#E5E7EB', fg: '#374151' };
  return (
    <View style={[s.badge, { backgroundColor: c.bg }]}>
      <Text style={[s.badgeText, { color: c.fg }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

function Btn({ label, onPress, tone = 'default', disabled }: {
  label: string; onPress: () => void; tone?: 'default' | 'primary' | 'warn' | 'danger'; disabled?: boolean;
}) {
  const bg = tone === 'primary' ? SLATE : tone === 'warn' ? '#FEF3C7' : tone === 'danger' ? '#FDECEA' : '#E8F0F8';
  const fg = tone === 'primary' ? WHITE : tone === 'warn' ? '#92400E' : tone === 'danger' ? RED : SLATE;
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <View style={s.kpi}>
      <Text style={{ fontSize: 20 }}>{icon}</Text>
      <Text style={s.kpiValue}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </View>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <View style={s.overlay}>
      <ScrollView contentContainerStyle={s.overlayInner}>
        <View style={s.modal}>
          <View style={s.modalHead}>
            <Text style={s.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={{ fontSize: 18, color: MUTED }}>✕</Text></Pressable>
          </View>
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Modal state types ────────────────────────────────────────────────────────
type ModalState =
  | { kind: 'newSchool' }
  | { kind: 'newBranch'; school: SchoolRow }
  | { kind: 'delete'; target: 'school' | 'branch'; id: string; name: string; confirmWord: string; detail: string }
  | { kind: 'newAdmin' }
  | { kind: 'password'; admin: AdminRow }
  | null;

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SuperAdmin() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const narrow = width < 760;

  const [session, setSession] = useState<SuperSession | null>(() => loadSession<SuperSession>(SESSION_KEY));
  const [tab, setTab] = useState<'schools' | 'admins'>('schools');
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

  // ── login form ──
  const [lUser, setLUser] = useState('');
  const [lPw, setLPw] = useState('');
  const [lErr, setLErr] = useState('');
  const [lBusy, setLBusy] = useState(false);

  const updateSession = (next: SuperSession | null) => { saveSession(SESSION_KEY, next); setSession(next); };

  const logout = useCallback(async (silent = false) => {
    const tok = session?.token;
    updateSession(null);
    setSchools([]); setAdmins([]);
    if (tok && !silent) await supabase.rpc('admin_logout', { p_token: tok });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // Token-checked RPC call; an expired session signs the user out.
  const call = useCallback(async (fn: string, args: Record<string, any> = {}) => {
    if (!session) throw new Error('session_expired');
    const { data, error } = await supabase.rpc(fn, { p_token: session.token, ...args });
    if (error) {
      if (error.message.includes('session_expired')) {
        updateSession(null);
        setLErr('Your session has expired. Please sign in again.');
      }
      throw error;
    }
    return data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const [ov, ad] = await Promise.all([call('sa_overview'), call('sa_list_admins')]);
      setSchools(ov?.schools ?? []);
      setAdmins(ad ?? []);
    } catch (e: any) {
      if (!String(e?.message).includes('session_expired')) setBanner({ tone: 'err', text: errText(e) });
    }
  }, [session, call]);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [session, refresh]);

  // Run a mutating action with busy state, banner and refresh.
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setBanner(null);
    try {
      await fn();
      setBanner({ tone: 'ok', text: ok });
      await refresh();
      return true;
    } catch (e: any) {
      setBanner({ tone: 'err', text: errText(e) });
      return false;
    } finally { setBusy(false); }
  };

  // ── Login ──
  const handleLogin = async () => {
    if (!lUser.trim() || !lPw) { setLErr('Please enter your username and password.'); return; }
    setLErr(''); setLBusy(true);
    try {
      const { data, error } = await supabase.rpc('login_admin', { p_username: lUser, p_password: lPw });
      if (error) { setLErr('Connection error. Please try again.'); return; }
      if (!data?.ok) {
        setLErr(data?.error === 'bad_password' ? 'Incorrect password.'
          : data?.error === 'not_found' ? 'No admin account with that username.'
          : data?.error === 'inactive' ? 'This admin account has been deactivated.'
          : 'Sign-in failed.');
        return;
      }
      if (data.role === 'branch') {
        await supabase.rpc('admin_logout', { p_token: data.token });
        setLErr('This is a campus admin account. Please use the Admin Portal instead.');
        return;
      }
      updateSession({ token: data.token, adminId: data.admin_id, username: data.username, fullName: data.full_name, role: data.role });
      setLPw('');
    } catch (e: any) {
      setLErr('An unexpected error occurred.');
    } finally { setLBusy(false); }
  };

  // ── Actions ──
  const setSchoolStatus = async (sc: SchoolRow, status: Status) => {
    const verb = status === 'paused' ? 'Pause' : status === 'archived' ? 'Archive' : sc.status === 'archived' ? 'Restore' : 'Resume';
    const msg = status === 'active'
      ? `All campuses of "${sc.name}" will be reachable again (campuses paused individually stay paused).`
      : status === 'paused'
        ? `Every campus of "${sc.name}" will be blocked immediately for admins, parents and drivers. All data is kept.`
        : `"${sc.name}" will be hidden from campus search and every login blocked. All data is kept and it can be restored.`;
    if (!(await confirmAction(`${verb} school?`, msg))) return;
    act(() => call('sa_set_school_status', { p_school_id: sc.id, p_status: status }), `${sc.name}: ${verb.toLowerCase()}d.`);
  };

  const setBranchStatus = async (sc: SchoolRow, b: BranchRow, status: Status) => {
    const verb = status === 'paused' ? 'Pause' : status === 'archived' ? 'Archive' : b.status === 'archived' ? 'Restore' : 'Resume';
    const msg = status === 'active'
      ? `${sc.name} — ${b.name} will accept logins again${sc.status !== 'active' ? ' (the school itself is still ' + sc.status + ')' : ''}.`
      : status === 'paused'
        ? `${sc.name} — ${b.name} will be blocked immediately for its admins, parents and drivers. All data is kept.`
        : `${sc.name} — ${b.name} will be hidden from campus search and every login blocked. All data is kept and it can be restored.`;
    if (!(await confirmAction(`${verb} campus?`, msg))) return;
    act(() => call('sa_set_branch_status', { p_branch_id: b.id, p_status: status }), `${b.name}: ${verb.toLowerCase()}d.`);
  };

  const openDashboard = async (b: BranchRow) => {
    setBusy(true);
    try {
      const r = await call('sa_open_branch', { p_branch_id: b.id });
      if (!session || !r) return;
      setAdminSession({
        adminId: session.adminId, username: session.username, fullName: session.fullName,
        role: session.role, branches: [r], branchId: r.branch_id, token: session.token,
      });
      router.push('/admin');
    } catch (e: any) {
      setBanner({ tone: 'err', text: errText(e) });
    } finally { setBusy(false); }
  };

  // ── KPIs ──
  const kpis = useMemo(() => {
    const branches = schools.flatMap(sc => sc.branches.map(b => ({ sc, b, st: effectiveStatus(sc, b) })));
    return {
      schools: schools.length,
      active: branches.filter(x => x.st === 'active').length,
      paused: branches.filter(x => x.st === 'paused').length,
      archived: branches.filter(x => x.st === 'archived').length,
      students: branches.reduce((n, x) => n + Number(x.b.students), 0),
      live: branches.reduce((n, x) => n + Number(x.b.active_dismissals), 0),
    };
  }, [schools]);

  const visibleSchools = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter(sc => sc.name.toLowerCase().includes(q) || sc.slug.includes(q)
      || sc.branches.some(b => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q)));
  }, [schools, search]);

  // ─── Login screen ──────────────────────────────────────────────────────────
  if (!session) {
    return (
      <View style={s.loginRoot}>
        <View style={s.loginCard}>
          <View style={s.logo}><Text style={{ fontSize: 32 }}>🏛️</Text></View>
          <Text style={s.loginTitle}>Super Admin</Text>
          <Text style={s.loginSub}>SafePass platform management</Text>
          {lErr ? <View style={s.errBox}><Text style={s.errText}>⚠️ {lErr}</Text></View> : null}
          <View style={{ alignSelf: 'stretch', gap: 12 }}>
            <Field label="Username" value={lUser} onChange={setLUser} placeholder="owner" />
            <View style={{ gap: 4 }}>
              <Text style={s.label}>Password</Text>
              <TextInput style={s.input} value={lPw} onChangeText={setLPw} secureTextEntry
                placeholder="Password" placeholderTextColor="#aaa" onSubmitEditing={handleLogin} />
            </View>
          </View>
          <Pressable style={s.loginBtn} onPress={handleLogin} disabled={lBusy}>
            {lBusy ? <ActivityIndicator color={WHITE} /> : <Text style={s.loginBtnText}>Sign In →</Text>}
          </Pressable>
          <Pressable onPress={() => router.replace('/')}><Text style={s.link}>← Back to Home</Text></Pressable>
        </View>
      </View>
    );
  }

  // ─── Portal ────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, narrow && { paddingHorizontal: 12 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
          <View style={s.headLogo}><Text style={{ fontSize: 18 }}>🏛️</Text></View>
          <View style={{ flexShrink: 1 }}>
            <Text style={s.headTitle}>SafePass Super Admin</Text>
            <Text style={s.headSub} numberOfLines={1}>
              {session.fullName || session.username} · {session.role === 'owner' ? 'Platform owner' : 'Super admin'}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn label="↻" onPress={refresh} />
          <Btn label="Sign out" tone="danger" onPress={() => logout()} />
        </View>
      </View>

      {/* Tabs */}
      <View style={[s.tabs, narrow && { paddingHorizontal: 12 }]}>
        {(['schools', 'admins'] as const).map(t => (
          <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'schools' ? '🏫 Schools & Campuses' : '🔑 Admin Accounts'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: narrow ? 12 : 24, paddingBottom: 64, gap: 16 }}>
        {banner ? (
          <Pressable onPress={() => setBanner(null)}
            style={[s.banner, banner.tone === 'ok' ? s.bannerOk : s.bannerErr]}>
            <Text style={[s.bannerText, { color: banner.tone === 'ok' ? '#065F46' : RED }]}>
              {banner.tone === 'ok' ? '✅ ' : '⚠️ '}{banner.text}
            </Text>
          </Pressable>
        ) : null}

        {loading && schools.length === 0 ? (
          <ActivityIndicator color={SLATE} size="large" style={{ marginTop: 48 }} />
        ) : tab === 'schools' ? (
          <>
            {/* KPIs */}
            <View style={s.kpiRow}>
              <Kpi icon="🏫" label="Schools" value={kpis.schools} />
              <Kpi icon="🟢" label="Active campuses" value={kpis.active} />
              <Kpi icon="⏸️" label="Paused campuses" value={kpis.paused} />
              <Kpi icon="🗄️" label="Archived" value={kpis.archived} />
              <Kpi icon="👥" label="Students" value={kpis.students} />
              <Kpi icon="🚶" label="Live dismissals" value={kpis.live} />
            </View>

            {/* Toolbar */}
            <View style={s.toolbar}>
              <TextInput style={[s.input, { flex: 1, minWidth: 200 }]} value={search} onChangeText={setSearch}
                placeholder="Search schools, campuses or codes…" placeholderTextColor="#aaa" />
              {session.role === 'owner' && <Btn label="+ New School" tone="primary" onPress={() => setModal({ kind: 'newSchool' })} />}
            </View>

            {visibleSchools.length === 0 ? (
              <View style={s.empty}><Text style={s.emptyText}>No schools found.</Text></View>
            ) : visibleSchools.map(sc => (
              <View key={sc.id} style={s.card}>
                <View style={s.cardHead}>
                  <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={s.schoolName}>{sc.name}</Text>
                      <StatusBadge status={sc.status} />
                    </View>
                    <Text style={s.meta}>slug: {sc.slug} · {sc.branches.length} campus{sc.branches.length === 1 ? '' : 'es'}</Text>
                  </View>
                  {sc.can_manage && (
                    <View style={s.actions}>
                      {sc.status !== 'archived' && <Btn label="+ Campus" onPress={() => setModal({ kind: 'newBranch', school: sc })} disabled={busy} />}
                      {sc.status === 'active' && <Btn label="Pause school" tone="warn" onPress={() => setSchoolStatus(sc, 'paused')} disabled={busy} />}
                      {sc.status === 'paused' && <Btn label="Resume school" tone="primary" onPress={() => setSchoolStatus(sc, 'active')} disabled={busy} />}
                      {sc.status !== 'archived'
                        ? <Btn label="Archive" onPress={() => setSchoolStatus(sc, 'archived')} disabled={busy} />
                        : <Btn label="Restore" tone="primary" onPress={() => setSchoolStatus(sc, 'active')} disabled={busy} />}
                      {sc.status === 'archived' && (
                        <Btn label="Delete permanently" tone="danger" disabled={busy} onPress={() => setModal({
                          kind: 'delete', target: 'school', id: sc.id, name: sc.name, confirmWord: sc.slug,
                          detail: `${sc.branches.length} campus(es), ${sc.branches.reduce((n, b) => n + Number(b.students), 0)} students, `
                            + `${sc.branches.reduce((n, b) => n + Number(b.parents), 0)} parent accounts and `
                            + `${sc.branches.reduce((n, b) => n + Number(b.drivers), 0)} transporters`,
                        })} />
                      )}
                    </View>
                  )}
                </View>

                {sc.branches.map(b => {
                  const st = effectiveStatus(sc, b);
                  return (
                    <View key={b.id} style={s.branch}>
                      <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Text style={s.branchName}>{b.name}</Text>
                          <Text style={s.code}>{b.code}</Text>
                          <StatusBadge status={st} />
                          {st !== b.status ? <Text style={s.meta}>(school {sc.status})</Text> : null}
                        </View>
                        <Text style={s.meta}>
                          {b.students} students · {b.active_dismissals} dispatched · {b.received} received · {b.parents} parents · {b.drivers} drivers
                        </Text>
                        <Text style={s.meta}>
                          📍 {Number(b.lat).toFixed(5)}, {Number(b.lng).toFixed(5)} · {b.geofence_radius}m
                          {b.admins.length ? ` · admins: ${b.admins.join(', ')}` : ' · no campus admin'}
                        </Text>
                        <Text style={s.meta}>Parent link: /parent-login?branch={b.code} · Driver link: /driver-login?branch={b.code}</Text>
                      </View>
                      <View style={s.actions}>
                        <Btn label="Open dashboard" tone="primary" onPress={() => openDashboard(b)} disabled={busy} />
                        {b.status === 'active' && <Btn label="Pause" tone="warn" onPress={() => setBranchStatus(sc, b, 'paused')} disabled={busy} />}
                        {b.status === 'paused' && <Btn label="Resume" tone="primary" onPress={() => setBranchStatus(sc, b, 'active')} disabled={busy} />}
                        {b.status !== 'archived'
                          ? <Btn label="Archive" onPress={() => setBranchStatus(sc, b, 'archived')} disabled={busy} />
                          : <Btn label="Restore" tone="primary" onPress={() => setBranchStatus(sc, b, 'active')} disabled={busy} />}
                        {b.status === 'archived' && (
                          <Btn label="Delete permanently" tone="danger" disabled={busy} onPress={() => setModal({
                            kind: 'delete', target: 'branch', id: b.id, name: `${sc.name} — ${b.name}`, confirmWord: b.code,
                            detail: `${b.students} students, ${b.parents} parent accounts and ${b.drivers} transporters`,
                          })} />
                        )}
                      </View>
                    </View>
                  );
                })}
                {sc.branches.length === 0 && <Text style={[s.meta, { padding: 16 }]}>No campuses you can manage in this school.</Text>}
              </View>
            ))}
          </>
        ) : (
          <AdminsTab
            admins={admins} session={session} busy={busy}
            onNew={() => setModal({ kind: 'newAdmin' })}
            onPassword={a => setModal({ kind: 'password', admin: a })}
            onToggle={async a => {
              const verb = a.is_active ? 'Deactivate' : 'Activate';
              if (!(await confirmAction(`${verb} ${a.username}?`, a.is_active
                ? 'They will be signed out and unable to sign in until reactivated.' : 'They will be able to sign in again.'))) return;
              act(() => call('sa_update_admin', { p_admin_id: a.id, p_is_active: !a.is_active }), `${a.username}: ${verb.toLowerCase()}d.`);
            }}
          />
        )}
      </ScrollView>

      {/* Modals */}
      {modal?.kind === 'newSchool' && (
        <CampusForm
          title="New School" withSchool busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async v => {
            const ok = await act(() => call('sa_create_school', {
              p_name: v.schoolName, p_slug: v.slug, p_branch_name: v.name, p_branch_code: v.code,
              p_lat: v.lat, p_lng: v.lng, p_radius: v.radius,
              p_admin_username: v.adminUser || null, p_admin_password: v.adminPw || null,
            }), `School "${v.schoolName}" created with campus ${v.code}.`);
            if (ok) setModal(null);
          }}
        />
      )}
      {modal?.kind === 'newBranch' && (
        <CampusForm
          title={`New Campus — ${modal.school.name}`} busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async v => {
            const ok = await act(() => call('sa_create_branch', {
              p_school_id: modal.school.id, p_name: v.name, p_code: v.code,
              p_lat: v.lat, p_lng: v.lng, p_radius: v.radius,
              p_admin_username: v.adminUser || null, p_admin_password: v.adminPw || null,
            }), `Campus ${v.code} created.`);
            if (ok) setModal(null);
          }}
        />
      )}
      {modal?.kind === 'delete' && (
        <DeleteForm modal={modal} busy={busy} onClose={() => setModal(null)}
          onSubmit={async typed => {
            const ok = await act(() => modal.target === 'school'
              ? call('sa_delete_school', { p_school_id: modal.id, p_confirm: typed })
              : call('sa_delete_branch', { p_branch_id: modal.id, p_confirm: typed }),
              `${modal.name} was permanently deleted.`);
            if (ok) setModal(null);
          }} />
      )}
      {modal?.kind === 'newAdmin' && (
        <AdminForm schools={schools} role={session.role} busy={busy} onClose={() => setModal(null)}
          onSubmit={async v => {
            const ok = await act(() => call('sa_create_admin', {
              p_username: v.username, p_password: v.password, p_full_name: v.fullName, p_role: v.role,
              p_school_ids: v.schoolIds, p_branch_ids: v.branchIds,
            }), `Admin "${v.username}" created.`);
            if (ok) setModal(null);
          }} />
      )}
      {modal?.kind === 'password' && (
        <PasswordForm admin={modal.admin} busy={busy} onClose={() => setModal(null)}
          onSubmit={async pw => {
            const ok = await act(() => call('sa_update_admin', { p_admin_id: modal.admin.id, p_new_password: pw }),
              `Password updated for ${modal.admin.username}.`);
            if (ok) setModal(null);
          }} />
      )}
    </View>
  );
}

// ─── Admins tab ───────────────────────────────────────────────────────────────
function AdminsTab({ admins, session, busy, onNew, onPassword, onToggle }: {
  admins: AdminRow[]; session: SuperSession; busy: boolean;
  onNew: () => void; onPassword: (a: AdminRow) => void; onToggle: (a: AdminRow) => void;
}) {
  const roleLabel = (r: Role) => r === 'owner' ? 'Platform owner' : r === 'super' ? 'Super admin' : 'Campus admin';
  return (
    <View style={{ gap: 12 }}>
      <View style={s.toolbar}>
        <Text style={[s.schoolName, { flex: 1 }]}>Admin Accounts</Text>
        <Btn label="+ New Admin" tone="primary" onPress={onNew} />
      </View>
      {admins.map(a => (
        <View key={a.id} style={[s.card, { padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }]}>
          <View style={{ flex: 1, minWidth: 220, gap: 3 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Text style={s.branchName}>{a.username}</Text>
              {a.is_self && <Text style={s.code}>YOU</Text>}
              <View style={[s.badge, { backgroundColor: a.is_active ? '#D1FAE5' : '#E5E7EB' }]}>
                <Text style={[s.badgeText, { color: a.is_active ? '#065F46' : '#374151' }]}>{a.is_active ? 'ACTIVE' : 'INACTIVE'}</Text>
              </View>
            </View>
            <Text style={s.meta}>{a.full_name ? `${a.full_name} · ` : ''}{roleLabel(a.role)}</Text>
            <Text style={s.meta}>
              {a.role === 'owner' ? 'Access: every school' : a.scopes.length
                ? 'Access: ' + a.scopes.map(x => (x.type === 'school' ? '🏫 ' : '📍 ') + x.name).join(', ')
                : 'Access: none'}
            </Text>
          </View>
          <View style={s.actions}>
            <Btn label={a.is_self ? 'Change my password' : 'Reset password'} onPress={() => onPassword(a)} disabled={busy} />
            {!a.is_self && (
              <Btn label={a.is_active ? 'Deactivate' : 'Activate'} tone={a.is_active ? 'warn' : 'primary'}
                onPress={() => onToggle(a)} disabled={busy} />
            )}
          </View>
        </View>
      ))}
      {session.role !== 'owner' && (
        <Text style={s.meta}>As a super admin you can create and manage campus admins for the campuses you control.</Text>
      )}
    </View>
  );
}

// ─── Forms ────────────────────────────────────────────────────────────────────
interface CampusValues {
  schoolName: string; slug: string; name: string; code: string;
  lat: number; lng: number; radius: number; adminUser: string; adminPw: string;
}

function CampusForm({ title, withSchool, busy, onClose, onSubmit }: {
  title: string; withSchool?: boolean; busy: boolean;
  onClose: () => void; onSubmit: (v: CampusValues) => void;
}) {
  const [schoolName, setSchoolName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('150');
  const [adminUser, setAdminUser] = useState('');
  const [adminPw, setAdminPw] = useState('');
  const [err, setErr] = useState('');
  const [gps, setGps] = useState(false);

  const useMyLocation = async () => {
    setGps(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { setErr('Location permission was denied.'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      setLat(loc.coords.latitude.toFixed(6)); setLng(loc.coords.longitude.toFixed(6));
    } catch (e: any) { setErr(e.message); } finally { setGps(false); }
  };

  const submit = () => {
    const la = Number(lat), lo = Number(lng), r = Number(radius);
    if (withSchool && !schoolName.trim()) return setErr('Please enter a school name.');
    if (!name.trim() || !code.trim()) return setErr('Campus name and code are required.');
    if (!lat.trim() || !lng.trim() || Number.isNaN(la) || Number.isNaN(lo)) return setErr('Enter the gate latitude and longitude.');
    if (Number.isNaN(r) || r < 50 || r > 500) return setErr('Radius must be 50–500 m.');
    if (adminUser.trim() && adminPw.length < 8) return setErr('Admin password must be at least 8 characters.');
    setErr('');
    onSubmit({
      schoolName: schoolName.trim(), slug: slug || slugify(schoolName), name: name.trim(),
      code: code.trim().toUpperCase(), lat: la, lng: lo, radius: Math.round(r),
      adminUser: adminUser.trim().toLowerCase(), adminPw,
    });
  };

  return (
    <ModalShell title={title} onClose={onClose}>
      {err ? <View style={s.errBox}><Text style={s.errText}>⚠️ {err}</Text></View> : null}
      {withSchool && (
        <View style={s.formRow}>
          <Field label="School name" value={schoolName} autoCapitalize="words"
            onChange={v => { setSchoolName(v); if (!slugTouched) setSlug(slugify(v)); }} placeholder="e.g. City School" />
          <Field label="Slug" value={slug} onChange={v => { setSlugTouched(true); setSlug(slugify(v)); }}
            placeholder="city-school" hint="Unique, lowercase" />
        </View>
      )}
      <View style={s.formRow}>
        <Field label={withSchool ? 'First campus name' : 'Campus name'} value={name} onChange={setName}
          autoCapitalize="words" placeholder="e.g. Gulberg Campus" />
        <Field label="Campus code" value={code} onChange={v => setCode(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
          autoCapitalize="characters" placeholder="CS-GULBERG" hint="Used in login links" />
      </View>
      <View style={s.formRow}>
        <Field label="Gate latitude" value={lat} onChange={setLat} placeholder="31.475213" />
        <Field label="Gate longitude" value={lng} onChange={setLng} placeholder="74.305118" />
        <Field label="Geofence radius (m)" value={radius} onChange={setRadius} placeholder="150" hint="50–500" />
      </View>
      <View style={{ alignItems: 'flex-start' }}>
        <Btn label={gps ? 'Locating…' : '📍 Use my current location'} onPress={useMyLocation} disabled={gps} />
      </View>
      <Text style={[s.label, { marginTop: 4 }]}>Campus admin (optional)</Text>
      <View style={s.formRow}>
        <Field label="Username" value={adminUser} onChange={setAdminUser} placeholder="gulberg_admin" />
        <Field label="Password" value={adminPw} onChange={setAdminPw} secret placeholder="min 8 characters" />
      </View>
      <View style={s.modalFoot}>
        <Btn label="Cancel" onPress={onClose} />
        <Btn label={busy ? 'Saving…' : 'Create'} tone="primary" onPress={submit} disabled={busy} />
      </View>
    </ModalShell>
  );
}

function DeleteForm({ modal, busy, onClose, onSubmit }: {
  modal: Extract<ModalState, { kind: 'delete' }>; busy: boolean;
  onClose: () => void; onSubmit: (typed: string) => void;
}) {
  const [typed, setTyped] = useState('');
  return (
    <ModalShell title={`Permanently delete ${modal.target}`} onClose={onClose}>
      <View style={s.errBox}>
        <Text style={s.errText}>
          This permanently deletes {modal.name} and all its data: {modal.detail}. This cannot be undone.
        </Text>
      </View>
      <Field label={`Type "${modal.confirmWord}" to confirm`} value={typed} onChange={setTyped} placeholder={modal.confirmWord} />
      <View style={s.modalFoot}>
        <Btn label="Cancel" onPress={onClose} />
        <Btn label={busy ? 'Deleting…' : 'Delete permanently'} tone="danger"
          disabled={busy || typed !== modal.confirmWord} onPress={() => onSubmit(typed)} />
      </View>
    </ModalShell>
  );
}

function AdminForm({ schools, role, busy, onClose, onSubmit }: {
  schools: SchoolRow[]; role: Role; busy: boolean; onClose: () => void;
  onSubmit: (v: { username: string; fullName: string; password: string; role: Role; schoolIds: string[]; branchIds: string[] }) => void;
}) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [newRole, setNewRole] = useState<Role>('branch');
  const [schoolIds, setSchoolIds] = useState<string[]>([]);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const roles: Role[] = role === 'owner' ? ['branch', 'super', 'owner'] : ['branch'];

  const submit = () => {
    if (!username.trim() || password.length < 8) return setErr('Username and a password of at least 8 characters are required.');
    if (newRole === 'branch' && branchIds.length === 0) return setErr('Pick at least one campus.');
    if (newRole === 'super' && schoolIds.length + branchIds.length === 0) return setErr('Pick at least one school or campus.');
    setErr('');
    onSubmit({
      username: username.trim().toLowerCase(), fullName: fullName.trim(), password, role: newRole,
      schoolIds: newRole === 'super' ? schoolIds : [], branchIds: newRole === 'owner' ? [] : branchIds,
    });
  };

  return (
    <ModalShell title="New Admin Account" onClose={onClose}>
      {err ? <View style={s.errBox}><Text style={s.errText}>⚠️ {err}</Text></View> : null}
      <View style={s.formRow}>
        <Field label="Username" value={username} onChange={setUsername} placeholder="e.g. cityschool_super" />
        <Field label="Full name" value={fullName} onChange={setFullName} autoCapitalize="words" placeholder="optional" />
      </View>
      <Field label="Password" value={password} onChange={setPassword} secret placeholder="min 8 characters" />
      <Text style={s.label}>Role</Text>
      <View style={s.chips}>
        {roles.map(r => (
          <Pressable key={r} onPress={() => setNewRole(r)} style={[s.chip, newRole === r && s.chipOn]}>
            <Text style={[s.chipText, newRole === r && s.chipTextOn]}>
              {r === 'branch' ? 'Campus admin' : r === 'super' ? 'Super admin' : 'Platform owner'}
            </Text>
          </Pressable>
        ))}
      </View>
      {newRole === 'super' && (
        <>
          <Text style={s.label}>Whole schools (every campus, including future ones)</Text>
          <View style={s.chips}>
            {schools.filter(sc => sc.can_manage).map(sc => (
              <Pressable key={sc.id} onPress={() => toggle(schoolIds, setSchoolIds, sc.id)}
                style={[s.chip, schoolIds.includes(sc.id) && s.chipOn]}>
                <Text style={[s.chipText, schoolIds.includes(sc.id) && s.chipTextOn]}>🏫 {sc.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {newRole !== 'owner' && (
        <>
          <Text style={s.label}>{newRole === 'super' ? 'Individual campuses' : 'Campuses'}</Text>
          <View style={s.chips}>
            {schools.flatMap(sc => sc.branches.filter(b => b.status !== 'archived').map(b => (
              <Pressable key={b.id} onPress={() => toggle(branchIds, setBranchIds, b.id)}
                style={[s.chip, branchIds.includes(b.id) && s.chipOn]}>
                <Text style={[s.chipText, branchIds.includes(b.id) && s.chipTextOn]}>📍 {sc.name} — {b.name}</Text>
              </Pressable>
            )))}
          </View>
        </>
      )}
      {newRole === 'owner' && <Text style={s.meta}>Platform owners can manage every school, create schools and other owners.</Text>}
      <View style={s.modalFoot}>
        <Btn label="Cancel" onPress={onClose} />
        <Btn label={busy ? 'Saving…' : 'Create admin'} tone="primary" onPress={submit} disabled={busy} />
      </View>
    </ModalShell>
  );
}

function PasswordForm({ admin, busy, onClose, onSubmit }: {
  admin: AdminRow; busy: boolean; onClose: () => void; onSubmit: (pw: string) => void;
}) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    if (pw.length < 8) return setErr('Password must be at least 8 characters.');
    if (pw !== pw2) return setErr('Passwords do not match.');
    setErr(''); onSubmit(pw);
  };
  return (
    <ModalShell title={admin.is_self ? 'Change my password' : `Reset password — ${admin.username}`} onClose={onClose}>
      {err ? <View style={s.errBox}><Text style={s.errText}>⚠️ {err}</Text></View> : null}
      <Field label="New password" value={pw} onChange={setPw} secret placeholder="min 8 characters" />
      <Field label="Repeat password" value={pw2} onChange={setPw2} secret />
      <View style={s.modalFoot}>
        <Btn label="Cancel" onPress={onClose} />
        <Btn label={busy ? 'Saving…' : 'Save password'} tone="primary" onPress={submit} disabled={busy} />
      </View>
    </ModalShell>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SURFACE },
  loginRoot: { flex: 1, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', padding: 16 },
  loginCard: {
    backgroundColor: WHITE, borderRadius: 20, padding: 32, width: '100%', maxWidth: 420, gap: 14,
    alignItems: 'center', borderWidth: 1, borderColor: BORDER,
  },
  logo: { width: 68, height: 68, borderRadius: 34, backgroundColor: SLATE_DARK, alignItems: 'center', justifyContent: 'center' },
  loginTitle: { fontSize: 26, fontWeight: '800', color: SLATE_DARK },
  loginSub: { fontSize: 13, color: MUTED },
  loginBtn: { alignSelf: 'stretch', backgroundColor: SLATE_DARK, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  loginBtnText: { color: WHITE, fontSize: 16, fontWeight: '700' },
  link: { color: SLATE, fontWeight: '600', fontSize: 14 },

  header: {
    backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: 24,
    paddingTop: Platform.OS === 'web' ? 12 : 48, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  headLogo: { width: 38, height: 38, borderRadius: 19, backgroundColor: SLATE_DARK, alignItems: 'center', justifyContent: 'center' },
  headTitle: { fontSize: 17, fontWeight: '800', color: SLATE_DARK },
  headSub: { fontSize: 12, color: MUTED },
  tabs: { flexDirection: 'row', gap: 4, paddingHorizontal: 24, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER },
  tab: { paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: SLATE },
  tabText: { fontSize: 14, fontWeight: '600', color: MUTED },
  tabTextActive: { color: SLATE_DARK, fontWeight: '800' },

  banner: { borderRadius: 10, padding: 12, borderLeftWidth: 4 },
  bannerOk: { backgroundColor: '#ECFDF5', borderLeftColor: '#10B981' },
  bannerErr: { backgroundColor: '#FDECEA', borderLeftColor: RED },
  bannerText: { fontSize: 13, fontWeight: '700' },

  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpi: { flexGrow: 1, flexBasis: 140, backgroundColor: WHITE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 2 },
  kpiValue: { fontSize: 26, fontWeight: '800', color: SLATE_DARK },
  kpiLabel: { fontSize: 11, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },

  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  card: { backgroundColor: WHITE, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16, alignItems: 'center', backgroundColor: '#FAFBFD', borderBottomWidth: 1, borderBottomColor: '#E6E9EE' },
  schoolName: { fontSize: 18, fontWeight: '800', color: SLATE_DARK },
  branch: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16, borderTopWidth: 1, borderTopColor: '#F0F2F5', alignItems: 'center' },
  branchName: { fontSize: 15, fontWeight: '800', color: TEXT },
  code: { fontSize: 11, fontWeight: '800', color: SLATE, backgroundColor: '#E8F0F8', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  meta: { fontSize: 12, color: MUTED },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  btnText: { fontSize: 13, fontWeight: '700' },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: MUTED, fontSize: 14 },

  label: { fontSize: 11, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { fontSize: 11, color: '#999' },
  input: {
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: TEXT, backgroundColor: '#FAFAFA',
  },
  errBox: { alignSelf: 'stretch', backgroundColor: '#FDECEA', borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: RED },
  errText: { color: RED, fontSize: 13, fontWeight: '600' },

  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,30,40,0.45)' },
  overlayInner: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { backgroundColor: WHITE, borderRadius: 18, padding: 20, width: '100%', maxWidth: 620, gap: 12 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: SLATE_DARK, flexShrink: 1 },
  modalFoot: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1.5, borderColor: BORDER, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: SLATE, backgroundColor: '#E8F0F8' },
  chipText: { fontSize: 12, color: MUTED, fontWeight: '600' },
  chipTextOn: { color: SLATE_DARK, fontWeight: '800' },
});
