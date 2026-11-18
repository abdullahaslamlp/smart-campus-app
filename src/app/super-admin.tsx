// SafePass Super Admin portal — platform owner / school-group super admins.
// Every action goes through token-checked sa_* RPCs; the server enforces role + scope.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import {
  Archive, ArchiveRestore, ExternalLink, KeyRound, LogOut, LucideIcon, MapPin, Pause, Play, Plus, RefreshCw, School, Trash2,
  Users, Activity, CirclePause, Building2,
} from 'lucide-react-native';
import { supabase } from '../../supabase';
import { loadSession, saveSession } from '../lib/tenant';
import { AuthLayout, Button, Card, Loading, Notice, PasswordField, TextField, color, radius, space, type } from '../lib/ui';
import { AdminShell, ChipGroup, ConfirmDialog, ConfirmOptions, Dialog, Kpi, KpiRow, NavItem, PageHeader, Pill, SearchInput, Segmented, Toast } from '../lib/admin-ui';
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

// ─── Adapters over the shared UI kit (module level keeps inputs focused) ──────
function Field({ label, value, onChange, placeholder, secret, hint, autoCapitalize = 'none' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  secret?: boolean; hint?: string; autoCapitalize?: 'none' | 'characters' | 'words';
}) {
  return (
    <View style={{ flex: 1, minWidth: 160 }}>
      {secret
        ? <PasswordField label={label} value={value} onChangeText={onChange} placeholder={placeholder} hint={hint} />
        : <TextField label={label} value={value} onChangeText={onChange} placeholder={placeholder} hint={hint} autoCapitalize={autoCapitalize} />}
    </View>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const c = status === 'active' ? { fg: color.done, bg: color.doneSoft, label: 'Active' }
    : status === 'paused' ? { fg: color.warn, bg: color.warnSoft, label: 'Paused' }
      : { fg: color.muted, bg: color.waitingSoft, label: 'Archived' };
  return <Pill label={c.label} fg={c.fg} bg={c.bg} />;
}

function Btn({ label, onPress, tone = 'default', disabled, icon, size = 'sm' }: {
  label: string; onPress: () => void; tone?: 'default' | 'primary' | 'warn' | 'danger' | 'destructive';
  disabled?: boolean; icon?: LucideIcon; size?: 'sm' | 'md';
}) {
  const variant = tone === 'primary' ? 'primary' : tone === 'danger' ? 'danger' : tone === 'destructive' ? 'destructive' : 'secondary';
  return <Button label={label} onPress={onPress} disabled={disabled} variant={variant} size={size} icon={icon} />;
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Dialog title={title} onClose={onClose}>{children}</Dialog>;
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

  const [session, setSession] = useState<SuperSession | null>(() => loadSession<SuperSession>(SESSION_KEY));
  const [tab, setTab] = useState<'schools' | 'admins'>('schools');
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [confirmState, setConfirmState] = useState<{ opts: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  // ── login form ──
  const [lUser, setLUser] = useState('');
  const [lPw, setLPw] = useState('');
  const [lErr, setLErr] = useState('');
  const [lBusy, setLBusy] = useState(false);

  const confirmAction = (title: string, message: string, tone: 'default' | 'danger' = 'default') =>
    new Promise<boolean>(resolve => setConfirmState({ opts: { title, message, tone, confirmLabel: title.replace(/\?$/, '') }, resolve }));
  const answerConfirm = (ok: boolean) => { confirmState?.resolve(ok); setConfirmState(null); };

  // Notices clear themselves.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), banner.tone === 'ok' ? 3500 : 9000);
    return () => clearTimeout(t);
  }, [banner]);

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
      setSyncedAt(new Date());
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
    if (!lUser.trim() || !lPw) { setLErr('Enter your username and password.'); return; }
    setLErr(''); setLBusy(true);
    try {
      const { data, error } = await supabase.rpc('login_admin', { p_username: lUser, p_password: lPw });
      if (error) { setLErr('Couldn’t reach the server. Check your connection and try again.'); return; }
      if (!data?.ok) {
        setLErr(data?.error === 'bad_password' ? 'Incorrect password.'
          : data?.error === 'not_found' ? 'No admin account with that username.'
          : data?.error === 'inactive' ? 'This admin account has been deactivated.'
          : 'Sign-in failed.');
        return;
      }
      if (data.role === 'branch') {
        await supabase.rpc('admin_logout', { p_token: data.token });
        setLErr('This is a campus admin account. Use the staff sign-in instead.');
        return;
      }
      updateSession({ token: data.token, adminId: data.admin_id, username: data.username, fullName: data.full_name, role: data.role });
      setLPw('');
    } catch (e: any) {
      setLErr('Something went wrong. Please try again.');
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

  // ─── Sign-in ──────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <AuthLayout title="Super admin sign in" subtitle="Manage schools, campuses and admin accounts across the platform."
        onBack={() => router.replace('/')}>
        {lErr ? <Notice tone="error">{lErr}</Notice> : null}
        <TextField label="Username" placeholder="e.g. owner" value={lUser} onChangeText={setLUser} autoComplete="username" returnKeyType="next" />
        <PasswordField label="Password" value={lPw} onChangeText={setLPw} onSubmitEditing={handleLogin} returnKeyType="go" />
        <Button label="Sign in" size="lg" full loading={lBusy} onPress={handleLogin} />
      </AuthLayout>
    );
  }

  const roleLabel = session.role === 'owner' ? 'Platform owner' : 'Super admin';
  const nav: NavItem[] = [
    { id: 'schools', label: 'Schools & campuses', Icon: School, group: 'Platform', primary: true },
    { id: 'admins', label: 'Admin accounts', Icon: KeyRound, group: 'Platform', primary: true },
  ];
  const syncText = syncedAt ? `Updated ${syncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Loading…';
  const refreshButton = <Button label="Refresh" size="sm" variant="secondary" icon={RefreshCw} onPress={refresh} />;

  const statusActions = (
    kind: 'school' | 'branch', status: Status, label: string,
    onSet: (st: Status) => void, onDelete: () => void,
  ) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {status === 'active' ? <Btn size="md" label={`Pause ${label}`} icon={Pause} onPress={() => onSet('paused')} disabled={busy} /> : null}
      {status === 'paused' ? <Btn size="md" label={`Resume ${label}`} icon={Play} tone="primary" onPress={() => onSet('active')} disabled={busy} /> : null}
      {status !== 'archived'
        ? <Btn size="md" label="Archive" icon={Archive} onPress={() => onSet('archived')} disabled={busy} />
        : <Btn size="md" label="Restore" icon={ArchiveRestore} tone="primary" onPress={() => onSet('active')} disabled={busy} />}
      {status === 'archived' ? <Btn size="md" label="Delete permanently" icon={Trash2} tone="danger" onPress={onDelete} disabled={busy} /> : null}
    </View>
  );

  const renderSchools = () => (
    <>
      <PageHeader title="Schools & campuses" description={`${syncText} · refreshes every ${POLL_MS / 1000} seconds`}
        actions={(<>{refreshButton}{session.role === 'owner' ? <Button label="New school" size="sm" icon={Plus} onPress={() => setModal({ kind: 'newSchool' })} /> : null}</>)} />
      <KpiRow>
        <Kpi label="Schools" value={kpis.schools} Icon={School} />
        <Kpi label="Active campuses" value={kpis.active} Icon={Building2} tone="done" />
        <Kpi label="Paused campuses" value={kpis.paused} Icon={CirclePause} tone={kpis.paused ? 'warn' : 'default'} hint={`${kpis.archived} archived`} />
        <Kpi label="Students" value={kpis.students} Icon={Users} />
        <Kpi label="Dismissals in progress" value={kpis.live} Icon={Activity} tone="sent" hint="Sent to gate" />
      </KpiRow>
      <SearchInput value={search} onChange={setSearch} placeholder="Search schools, campuses or codes" />

      {visibleSchools.length === 0 ? (
        <Card><Text style={type.body}>{schools.length === 0 ? 'No schools yet.' : 'No schools match your search.'}</Text></Card>
      ) : visibleSchools.map(sc => (
        <Card key={sc.id} padded={false}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, padding: space.lg, backgroundColor: '#FAFBFC', borderBottomWidth: 1, borderBottomColor: color.border, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
            <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                <Text style={type.heading}>{sc.name}</Text>
                <StatusBadge status={sc.status} />
              </View>
              <Text style={type.small}>{sc.slug} · {sc.branches.length} campus{sc.branches.length === 1 ? '' : 'es'}</Text>
            </View>
            {sc.can_manage ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {sc.status !== 'archived' ? <Btn size="md" label="Add campus" icon={Plus} onPress={() => setModal({ kind: 'newBranch', school: sc })} disabled={busy} /> : null}
                {statusActions('school', sc.status, 'school', st => setSchoolStatus(sc, st), () => setModal({
                  kind: 'delete', target: 'school', id: sc.id, name: sc.name, confirmWord: sc.slug,
                  detail: `${sc.branches.length} campus(es), ${sc.branches.reduce((n, b) => n + Number(b.students), 0)} students, `
                    + `${sc.branches.reduce((n, b) => n + Number(b.parents), 0)} parent accounts and `
                    + `${sc.branches.reduce((n, b) => n + Number(b.drivers), 0)} transporters`,
                }))}
              </View>
            ) : null}
          </View>

          {sc.branches.map((b, i) => {
            const st = effectiveStatus(sc, b);
            return (
              <View key={b.id} style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, padding: space.lg, alignItems: 'center' }, i > 0 && { borderTopWidth: 1, borderTopColor: color.border }]}>
                <View style={{ flex: 1, minWidth: 240, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                    <Text style={[type.body, { fontWeight: '600', color: color.ink }]}>{b.name}</Text>
                    <Text style={[type.small, { fontVariant: ['tabular-nums'] }]}>{b.code}</Text>
                    <StatusBadge status={st} />
                    {st !== b.status ? <Text style={type.small}>(school is {sc.status})</Text> : null}
                  </View>
                  <Text style={type.small}>
                    {b.students} students · {b.active_dismissals} at gate · {b.received} picked up · {b.parents} parents · {b.drivers} drivers
                  </Text>
                  <Text style={type.small}>
                    {Number(b.lat).toFixed(5)}, {Number(b.lng).toFixed(5)} · {b.geofence_radius} m · {b.admins.length ? `Admins: ${b.admins.join(', ')}` : 'No campus admin yet'}
                  </Text>
                  <Text style={type.small}>Login links: /parent-login?branch={b.code} · /driver-login?branch={b.code}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  <Btn size="md" label="Open dashboard" icon={ExternalLink} tone="primary" onPress={() => openDashboard(b)} disabled={busy} />
                  {statusActions('branch', b.status, 'campus', status => setBranchStatus(sc, b, status), () => setModal({
                    kind: 'delete', target: 'branch', id: b.id, name: `${sc.name} — ${b.name}`, confirmWord: b.code,
                    detail: `${b.students} students, ${b.parents} parent accounts and ${b.drivers} transporters`,
                  }))}
                </View>
              </View>
            );
          })}
          {sc.branches.length === 0 ? <Text style={[type.small, { padding: space.lg }]}>No campuses you can manage in this school.</Text> : null}
        </Card>
      ))}
    </>
  );

  const renderAdmins = () => {
    const roleName = (r: Role) => (r === 'owner' ? 'Platform owner' : r === 'super' ? 'Super admin' : 'Campus admin');
    return (
      <>
        <PageHeader title="Admin accounts"
          description={session.role === 'owner' ? 'Owners, super admins and campus admins.' : 'Campus admins for the campuses you manage, plus your own account.'}
          actions={(<>{refreshButton}<Button label="New admin" size="sm" icon={Plus} onPress={() => setModal({ kind: 'newAdmin' })} /></>)} />
        {admins.map(a => (
          <Card key={a.id} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 240, gap: 3 }}>
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={[type.body, { fontWeight: '600', color: color.ink }]}>{a.username}</Text>
                {a.is_self ? <Pill label="You" fg={color.accent} bg={color.accentSoft} /> : null}
                <Pill label={a.is_active ? 'Active' : 'Inactive'} fg={a.is_active ? color.done : color.muted} bg={a.is_active ? color.doneSoft : color.waitingSoft} />
              </View>
              <Text style={type.small}>{a.full_name ? `${a.full_name} · ` : ''}{roleName(a.role)}</Text>
              <Text style={type.small}>
                {a.role === 'owner' ? 'Access: every school'
                  : a.scopes.length ? `Access: ${a.scopes.map(x => x.name).join(', ')}` : 'Access: none'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Btn size="md" label={a.is_self ? 'Change my password' : 'Reset password'} icon={KeyRound} onPress={() => setModal({ kind: 'password', admin: a })} disabled={busy} />
              {!a.is_self ? (
                <Btn size="md" label={a.is_active ? 'Deactivate' : 'Activate'} tone={a.is_active ? 'danger' : 'primary'} disabled={busy}
                  onPress={async () => {
                    const verb = a.is_active ? 'Deactivate' : 'Activate';
                    if (!(await confirmAction(`${verb} ${a.username}?`, a.is_active
                      ? 'They will be signed out and unable to sign in until reactivated.' : 'They will be able to sign in again.', a.is_active ? 'danger' : 'default'))) return;
                    act(() => call('sa_update_admin', { p_admin_id: a.id, p_is_active: !a.is_active }), `${a.username}: ${verb.toLowerCase()}d.`);
                  }} />
              ) : null}
            </View>
          </Card>
        ))}
      </>
    );
  };

  // ─── Portal ───────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1 }}>
      <AdminShell
        context="SafePass" contextSub={roleLabel} user={session.username}
        nav={nav} active={tab} onNavigate={id => setTab(id as 'schools' | 'admins')}
        footer={[{ label: 'Sign out', Icon: LogOut, onPress: () => logout() }]}
      >
        {loading && schools.length === 0 ? <Loading label="Loading schools…" /> : tab === 'schools' ? renderSchools() : renderAdmins()}
      </AdminShell>

      {banner ? <Toast tone={banner.tone === 'ok' ? 'success' : 'error'} text={banner.text} onClose={() => setBanner(null)} /> : null}
      {confirmState ? <ConfirmDialog options={confirmState.opts} onResult={answerConfirm} /> : null}

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
      {err ? <Notice tone="error">{err}</Notice> : null}
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
        <Btn label={gps ? 'Locating…' : 'Use my current location'} icon={MapPin} onPress={useMyLocation} disabled={gps} />
      </View>
      <Text style={[type.label, { marginTop: 4 }]}>Campus admin (optional)</Text>
      <View style={s.formRow}>
        <Field label="Username" value={adminUser} onChange={setAdminUser} placeholder="gulberg_admin" />
        <Field label="Password" value={adminPw} onChange={setAdminPw} secret placeholder="min 8 characters" />
      </View>
      <View style={s.modalFoot}>
        <Btn size="md" label="Cancel" onPress={onClose} />
        <Btn size="md" label={busy ? 'Saving…' : 'Create'} tone="primary" onPress={submit} disabled={busy} />
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
      <Notice tone="error" title="This can’t be undone">
        {`This permanently deletes ${modal.name} and all its data: ${modal.detail}.`}
      </Notice>
      <Field label={`Type "${modal.confirmWord}" to confirm`} value={typed} onChange={setTyped} placeholder={modal.confirmWord} />
      <View style={s.modalFoot}>
        <Btn size="md" label="Cancel" onPress={onClose} />
        <Btn size="md" label={busy ? 'Deleting…' : 'Delete permanently'} tone="destructive"
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
  const roleName = (r: Role) => (r === 'branch' ? 'Campus admin' : r === 'super' ? 'Super admin' : 'Platform owner');

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
      {err ? <Notice tone="error">{err}</Notice> : null}
      <View style={s.formRow}>
        <Field label="Username" value={username} onChange={setUsername} placeholder="e.g. cityschool_super" />
        <Field label="Full name" value={fullName} onChange={setFullName} autoCapitalize="words" placeholder="optional" />
      </View>
      <Field label="Password" value={password} onChange={setPassword} secret placeholder="min 8 characters" />
      <Segmented label="Role" options={roles.map(roleName)} value={roleName(newRole)}
        onChange={v => setNewRole(roles.find(r => roleName(r) === v) ?? 'branch')} />
      {newRole === 'super' && (
        <ChipGroup label="Whole schools (every campus, including future ones)"
          options={schools.filter(sc => sc.can_manage).map(sc => ({ key: sc.id, label: sc.name }))}
          selected={schoolIds} onToggle={id => toggle(schoolIds, setSchoolIds, id)} />
      )}
      {newRole !== 'owner' && (
        <ChipGroup label={newRole === 'super' ? 'Individual campuses' : 'Campuses'}
          options={schools.flatMap(sc => sc.branches.filter(b => b.status !== 'archived').map(b => ({ key: b.id, label: `${sc.name} — ${b.name}` })))}
          selected={branchIds} onToggle={id => toggle(branchIds, setBranchIds, id)} />
      )}
      {newRole === 'owner' && <Text style={type.small}>Platform owners can manage every school, create schools and other owners.</Text>}
      <View style={s.modalFoot}>
        <Btn size="md" label="Cancel" onPress={onClose} />
        <Btn size="md" label={busy ? 'Saving…' : 'Create admin'} tone="primary" onPress={submit} disabled={busy} />
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
      {err ? <Notice tone="error">{err}</Notice> : null}
      <Field label="New password" value={pw} onChange={setPw} secret placeholder="min 8 characters" />
      <Field label="Repeat password" value={pw2} onChange={setPw2} secret />
      <View style={s.modalFoot}>
        <Btn size="md" label="Cancel" onPress={onClose} />
        <Btn size="md" label={busy ? 'Saving…' : 'Save password'} tone="primary" onPress={submit} disabled={busy} />
      </View>
    </ModalShell>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  modalFoot: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: space.sm },
});
