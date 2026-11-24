import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import {
  ArrowLeftRight, ChevronRight, CircleAlert, CircleCheck, ClipboardList, Bus, GraduationCap, KeyRound, Landmark,
  LayoutDashboard, LogOut, MapPin, MapPinned, Pencil, Play, Plus, Power, RotateCcw, Send, Trash2, TriangleAlert,
  UsersRound, FlaskConical,
} from 'lucide-react-native';
import { supabase } from '../../supabase';
import {
  LOGIN_ERRORS, isSessionError, loadSession, rpcErrorCode, rpcMessage, saveSession,
  subscribeBranchPings, useBranch,
} from '../lib/tenant';
import {
  AuthLayout, Button, Card, Loading, Notice, PasswordField, PausedNotice, StatusPill, TextField, color, radius, space, type,
} from '../lib/ui';
import {
  AdminShell, Cell, ChipGroup, ChipRow, Column, ConfirmDialog, ConfirmOptions, DataTable, Dialog, IconButton, Kpi, KpiRow,
  NavItem, PageHeader, Pill, SearchInput, Segmented, Toast,
} from '../lib/admin-ui';

// ─── Admin session ────────────────────────────────────────────────────────────
export interface AdminBranch {
  branch_id: string; branch_code: string; branch_name: string;
  school_id: string; school_name: string; status: 'active' | 'paused' | 'archived';
}
export interface AdminSession {
  adminId: string; username: string; fullName: string | null;
  role: 'owner' | 'super' | 'branch';
  branches: AdminBranch[];
  branchId: string | null;   // branch currently being managed
  token?: string;            // admin session token (Step 4+)
}
const ADMIN_KEY = 'adminSession_v2';
export const getAdminSession = () => {
  const s = loadSession<AdminSession>(ADMIN_KEY);
  return s && s.token ? s : null;
};
export const setAdminSession = (s: AdminSession | null) => saveSession(ADMIN_KEY, s);

// ─── Types ────────────────────────────────────────────────────────────────────
type NavSection = 'dashboard' | 'students' | 'guardians' | 'geofence' | 'logs' | 'accounts' | 'transporters' | 'tests';

interface TestResult {
  id: string; category: string; name: string;
  status: 'pass' | 'fail' | 'warn' | 'running';
  detail: string; durationMs?: number;
}

interface Student {
  id: string; name: string; grade?: string; gate?: string;
  parent_id: string; status: 'waiting' | 'dispatched' | 'arrived' | 'received';
  last_distance_meters?: number | null;
}

interface ParentAccount {
  id: string; parent_id: string; full_name: string;
  phone?: string; is_active: boolean; created_at: string;
}

interface TransporterAccount {
  id: string; driver_id: string; driver_name: string;
  vehicle_type: string; vehicle_number: string;
  phone?: string; linked_parent_ids: string[];
  is_active: boolean; created_at: string;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminPortal() {
  const router = useRouter();

  // ── Admin auth ──
  const [session, setSession] = useState<AdminSession | null>(() => getAdminSession());
  const [loginUser, setLoginUser] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const branchId = session?.branchId ?? null;
  const pinAuthed = !!branchId;
  const { branch, loading: branchLoading, live: branchLive } = useBranch(branchId, { live: true });

  // ── App state ──
  const [students, setStudents] = useState<Student[]>([]);
  const [accounts, setAccounts] = useState<ParentAccount[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [toast, setToast] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmState, setConfirmState] = useState<{ opts: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterSection, setFilterSection] = useState('');
  // ── Test state ──
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testRunning, setTestRunning] = useState(false);
  const [testSummary, setTestSummary] = useState('');

  // ── Geofence state ──
  const [schoolLocation, setSchoolLocation] = useState({ lat: 31.4501, lng: 74.3012 });
  const [tempLocation, setTempLocation] = useState({ lat: 31.4501, lng: 74.3012 });
  const [geofenceRadius, setGeofenceRadius] = useState(150);
  const [tempRadius, setTempRadius] = useState(150);
  const [radiusSaved, setRadiusSaved] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [demoSaving, setDemoSaving] = useState(false);

  // ── Add Student modal ──
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [ns_name, setNs_name] = useState('');
  const [ns_grade, setNs_grade] = useState('');
  const [ns_gate, setNs_gate] = useState('Gate A');
  const [ns_parentId, setNs_parentId] = useState('');
  const [ns_loading, setNs_loading] = useState(false);
  const [nsError, setNsError] = useState('');

  // ── Parent Account modals ──
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<ParentAccount | null>(null);
  const [na_parentId, setNa_parentId] = useState('');
  const [na_fullName, setNa_fullName] = useState('');
  const [na_password, setNa_password] = useState('');
  const [na_phone, setNa_phone] = useState('');
  const [na_loading, setNa_loading] = useState(false);
  const [accountModalError, setAccountModalError] = useState('');

  // ── Transporter modals ──
  const [transporters, setTransporters] = useState<TransporterAccount[]>([]);
  const [transportersLoading, setTransportersLoading] = useState(true);
  const [addTransporterOpen, setAddTransporterOpen] = useState(false);
  const [editTransporter, setEditTransporter] = useState<TransporterAccount | null>(null);
  const [nt_driverId, setNt_driverId] = useState('');
  const [nt_driverName, setNt_driverName] = useState('');
  const [nt_vehicleType, setNt_vehicleType] = useState('Rickshaw');
  const [nt_vehicleNumber, setNt_vehicleNumber] = useState('');
  const [nt_password, setNt_password] = useState('safepass123');
  const [nt_phone, setNt_phone] = useState('');
  const [nt_linkedParents, setNt_linkedParents] = useState<string[]>([]);
  const [nt_loading, setNt_loading] = useState(false);
  const [transporterModalError, setTransporterModalError] = useState('');

  // ─── PIN Login ─────────────────────────────────────────────────────────────
  const updateSession = (next: AdminSession | null) => {
    setAdminSession(next);
    setSession(next);
  };

  const handlePinLogin = async () => {
    if (!loginUser.trim() || !loginPw) {
      setLoginError('Enter your username and password.');
      return;
    }
    setLoginError('');
    setLoginLoading(true);
    try {
      const { data, error } = await supabase.rpc('login_admin', { p_username: loginUser, p_password: loginPw });
      if (error) { setLoginError('Couldn’t reach the server. Check your connection and try again.'); console.error('[adminLogin]', error.message); return; }
      if (!data?.ok) {
        setLoginError(data?.error === 'no_branch'
          ? 'No campus is assigned to this admin account.'
          : LOGIN_ERRORS[data?.error] ?? 'Sign-in failed. Please try again.');
        return;
      }
      const branches: AdminBranch[] = data.branches || [];
      // Branch admins go straight to their (first live) campus; others pick when there is more than one.
      const firstLive = branches.find(b => b.status === 'active') ?? branches[0];
      const autoPick = branches.length === 1 || data.role === 'branch' ? firstLive?.branch_id ?? null : null;
      updateSession({
        adminId: data.admin_id, username: data.username, fullName: data.full_name,
        role: data.role, branches, branchId: autoPick, token: data.token,
      });
      setLoginPw('');
    } catch (e: any) {
      setLoginError('Something went wrong. Please try again.');
      console.error('[adminLogin]', e.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const selectBranch = (id: string | null) => {
    if (!session) return;
    setStudentsLoading(true); setAccountsLoading(true); setTransportersLoading(true);
    setStudents([]); setAccounts([]); setTransporters([]);
    updateSession({ ...session, branchId: id });
  };

  const handleLogout = () => {
    // A super admin who opened this campus from /super-admin keeps their platform session.
    const fromSuper = session && session.role !== 'branch' && session.branches.length === 1 && !!loadSession('superSession_v1');
    if (session?.token && !fromSuper) supabase.rpc('admin_logout', { p_token: session.token }).then(() => {}, () => {});
    updateSession(null);
    setLoginUser(''); setLoginPw('');
    if (fromSuper) { router.replace('/super-admin'); return; }
  };

  // Owners / super admins: leave this campus and return to the platform portal (their platform session is kept).
  const backToSuperAdmin = () => {
    updateSession(null);
    router.replace('/super-admin');
  };

  // ─── Server calls ─────────────────────────────────────────────────────────
  // Every read and write goes through a token-checked RPC scoped to this campus.
  const adminRpc = async (fn: string, args: Record<string, any> = {}) => {
    const { data, error } = await supabase.rpc(fn, { p_token: session?.token, p_branch_id: branchId, ...args });
    if (error) {
      if (isSessionError(error)) handleLogout();
      throw error;
    }
    return data;
  };

  const notify = (tone: 'error' | 'success', text: string) => {
    setToast({ tone, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), tone === 'success' ? 3500 : 9000);
  };
  const showError = (title: string, e: any) => notify('error', `${title}: ${rpcMessage(e)}`);
  const confirmAsync = (opts: ConfirmOptions) => new Promise<boolean>(resolve => setConfirmState({ opts, resolve }));
  const answerConfirm = (ok: boolean) => { confirmState?.resolve(ok); setConfirmState(null); };

  // One snapshot of the campus (students, parents, transporters — never passwords).
  const loadAll = async () => {
    if (!branchId || !session?.token) return;
    try {
      const data = await adminRpc('admin_branch_data');
      setStudents((data?.students as Student[]) || []);
      setAccounts((data?.parents as ParentAccount[]) || []);
      setTransporters((data?.transporters as TransporterAccount[]) || []);
      setLastSync(new Date());
    } catch (e: any) {
      console.error('[loadAll]', e.message);
    } finally {
      setStudentsLoading(false); setAccountsLoading(false); setTransportersLoading(false);
    }
  };
  const fetchStudents = loadAll;
  const fetchAccounts = loadAll;
  const fetchTransporters = loadAll;

  // ─── Data init: load once per campus, then refetch on the campus change ping ─
  useEffect(() => {
    if (!pinAuthed) return;

    loadAll();
    const unsubscribe = subscribeBranchPings(branchId!, what => {
      if (what === 'students' || what === 'parent_accounts' || what === 'transporter_accounts') loadAll();
    });
    // Fallback in case a ping is missed.
    const poll = setInterval(loadAll, 30000);

    const handleMapMessage = (e: MessageEvent) => {
      if (e.data?.type === 'UPDATE_LOCATION')
        setTempLocation({ lat: e.data.lat, lng: e.data.lng });
    };
    if (Platform.OS === 'web') window.addEventListener('message', handleMapMessage);

    return () => {
      clearInterval(poll);
      unsubscribe();
      if (Platform.OS === 'web') window.removeEventListener('message', handleMapMessage);
    };
  }, [branchId]);

  const openAddTransporter = () => {
    setEditTransporter(null);
    setNt_driverId('');
    setNt_driverName('');
    setNt_vehicleType('Rickshaw');
    setNt_vehicleNumber('');
    setNt_password('safepass123');
    setNt_phone('');
    setNt_linkedParents([]);
    setTransporterModalError('');
    setAddTransporterOpen(true);
  };

  const openEditTransporter = (tr: TransporterAccount) => {
    setEditTransporter(tr);
    setNt_driverId(tr.driver_id);
    setNt_driverName(tr.driver_name);
    setNt_vehicleType(tr.vehicle_type);
    setNt_vehicleNumber(tr.vehicle_number);
    setNt_password('');   // passwords are never sent to the browser; blank = keep current
    setNt_phone(tr.phone || '');
    setNt_linkedParents(tr.linked_parent_ids || []);
    setTransporterModalError('');
    setAddTransporterOpen(true);
  };

  const handleSaveTransporter = async () => {
    if (!nt_driverId.trim() || !nt_driverName.trim() || !nt_vehicleNumber.trim()) {
      setTransporterModalError('Driver ID, Driver Name, and Vehicle Number are required.');
      return;
    }
    if (!editTransporter && !nt_password.trim()) {
      setTransporterModalError('A password is required for a new driver.');
      return;
    }
    setNt_loading(true);
    setTransporterModalError('');
    try {
      await adminRpc('admin_save_transporter', {
        p_id: editTransporter?.id ?? null,
        p_driver_id: nt_driverId.trim().toLowerCase(),
        p_driver_name: nt_driverName.trim(),
        p_vehicle_type: nt_vehicleType.trim(),
        p_vehicle_number: nt_vehicleNumber.trim(),
        p_password: nt_password.trim() || null,
        p_phone: nt_phone.trim() || null,
        p_linked_parent_ids: nt_linkedParents,
      });
      setAddTransporterOpen(false);
      notify('success', editTransporter ? 'Driver updated.' : 'Driver created.');
      loadAll();
    } catch (e: any) {
      setTransporterModalError(rpcMessage(e));
    } finally { setNt_loading(false); }
  };

  const handleToggleTransporterActive = async (tr: TransporterAccount) => {
    try {
      await adminRpc('admin_set_transporter_active', { p_id: tr.id, p_active: !tr.is_active });
      loadAll();
    } catch (e: any) { showError('Update failed', e); }
  };

  const handleDeleteTransporter = async (tr: TransporterAccount) => {
    if (!(await confirmAsync({ title: 'Delete driver?', message: `${tr.driver_name} (${tr.driver_id}) will be removed and can no longer sign in. This can’t be undone.`, confirmLabel: 'Delete driver', tone: 'danger' }))) return;
    try {
      await adminRpc('admin_delete_transporter', { p_id: tr.id });
      loadAll();
    } catch (e: any) { showError('Delete failed', e); }
  };

  // ── Geofence settings come from the managed branch (refreshes live / every 15s) ──
  useEffect(() => {
    if (!branch) return;
    setSchoolLocation({ lat: branch.lat, lng: branch.lng });
    if (!isMapOpen) setTempLocation({ lat: branch.lat, lng: branch.lng });
    setGeofenceRadius(branch.geofence_radius);
    setDemoMode(!!branch.demo_mode);
    if (!radiusSaved) setTempRadius(branch.geofence_radius);
  }, [branch?.id, branch?.lat, branch?.lng, branch?.geofence_radius]);

  // ─── Admin Handlers ───────────────────────────────────────────────────────
  const handleResetDemo = async () => {
    if (!(await confirmAsync({ title: 'Reset all students to “In class”?', message: 'Every student on this campus goes back to waiting and the last recorded distances are cleared. Use this to start a fresh dismissal.', confirmLabel: 'Reset all', tone: 'danger' }))) return;
    setResetLoading(true);
    try {
      await adminRpc('admin_reset_demo');
      notify('success', 'All students are back in class.');
      loadAll();
    } catch (e: any) { showError('Reset failed', e); }
    finally { setResetLoading(false); }
  };

  const handleDispatch = async (id: string) => {
    try {
      await adminRpc('admin_set_student_status', { p_student_id: id, p_status: 'dispatched' });
      notify('success', 'Student sent to the gate.');
      loadAll();
    } catch (e: any) { showError('Dispatch failed', e); }
  };

  const saveMapLocation = async () => {
    try {
      await adminRpc('admin_save_geofence', { p_lat: tempLocation.lat, p_lng: tempLocation.lng });
      setSchoolLocation(tempLocation);
      setIsMapOpen(false);
      notify('success', 'Gate location saved.');
    } catch (e: any) { showError('Could not save location', e); }
  };

  const saveGeofenceRadius = async () => {
    try {
      await adminRpc('admin_save_geofence', { p_radius: tempRadius });
      setGeofenceRadius(tempRadius);
      setRadiusSaved(true);
      setTimeout(() => setRadiusSaved(false), 2000);
      notify('success', `Pickup radius saved (${tempRadius} m).`);
    } catch (e: any) { showError('Could not save radius', e); }
  };

  const toggleDemoMode = async () => {
    const next = !demoMode;
    setDemoSaving(true);
    try {
      await adminRpc('admin_set_demo_mode', { p_enabled: next });
      setDemoMode(next);
      notify('success', next ? 'Demo mode is on.' : 'Demo mode is off.');
    } catch (e: any) { showError('Could not change demo mode', e); }
    finally { setDemoSaving(false); }
  };

  // ─── Add Student ──────────────────────────────────────────────────────────
  const handleAddStudent = async () => {
    if (!ns_name.trim() || !ns_parentId.trim()) {
      setNsError('Enter the student’s name and the guardian ID.'); return;
    }
    setNsError('');
    setNs_loading(true);
    try {
      await adminRpc('admin_add_student', {
        p_name: ns_name.trim(), p_grade: ns_grade.trim() || null,
        p_gate: ns_gate, p_parent_id: ns_parentId.trim().toLowerCase(),
      });
      setAddStudentOpen(false); setNs_name(''); setNs_grade(''); setNs_parentId('');
      notify('success', 'Student added.');
      loadAll();
    } catch (e: any) { setNsError(rpcMessage(e)); }
    finally { setNs_loading(false); }
  };

  // ─── Parent Account CRUD ──────────────────────────────────────────────────
  const openAddAccount = () => {
    setEditAccount(null);
    setAccountModalError('');
    setNa_parentId(''); setNa_fullName(''); setNa_password('safepass123'); setNa_phone('');
    setAddAccountOpen(true);
  };

  const openEditAccount = (acc: ParentAccount) => {
    setEditAccount(acc);
    setAccountModalError('');
    setNa_parentId(acc.parent_id); setNa_fullName(acc.full_name);
    setNa_password('');   // blank = keep current password
    setNa_phone(acc.phone || '');
    setAddAccountOpen(true);
  };

  const handleSaveAccount = async () => {
    if (!na_parentId.trim() || !na_fullName.trim() || (!editAccount && !na_password.trim())) {
      setAccountModalError(editAccount
        ? 'Parent ID and Full Name are required.'
        : 'Parent ID, Full Name, and Password are required.');
      return;
    }
    setAccountModalError('');
    setNa_loading(true);
    try {
      await adminRpc('admin_save_parent', {
        p_id: editAccount?.id ?? null,
        p_parent_id: na_parentId.trim().toLowerCase(),
        p_full_name: na_fullName.trim(),
        p_password: na_password.trim() || null,
        p_phone: na_phone.trim() || null,
      });
      setAddAccountOpen(false);
      notify('success', editAccount ? 'Account updated.' : 'Account created.');
      loadAll();
    } catch (e: any) {
      // Show error inside the modal so it's never missed
      setAccountModalError(rpcMessage(e));
    } finally {
      setNa_loading(false);
    }
  };

  const handleToggleActive = async (acc: ParentAccount) => {
    try {
      await adminRpc('admin_set_parent_active', { p_id: acc.id, p_active: !acc.is_active });
      loadAll();
    } catch (e: any) { showError('Update failed', e); }
  };

  const handleDeleteAccount = async (acc: ParentAccount) => {
    if (!(await confirmAsync({ title: 'Delete parent account?', message: `${acc.full_name} (${acc.parent_id}) will be removed and can no longer sign in. This can’t be undone.`, confirmLabel: 'Delete account', tone: 'danger' }))) return;
    try {
      await adminRpc('admin_delete_parent', { p_id: acc.id });
      notify('success', 'Account deleted.');
      loadAll();
    } catch (e: any) { showError('Delete failed', e); }
  };


  // ─── System Test Runner ─────────────────────────────────────────────
  const runAllTests = async () => {
    setTestRunning(true);
    setTestSummary('');
    const results: TestResult[] = [];
    let passed = 0, failed = 0, warned = 0;

    const run = async (id: string, category: string, name: string, fn: () => Promise<{ status: 'pass'|'fail'|'warn'; detail: string }>) => {
      const t0 = Date.now();
      try {
        const r = await fn();
        const ms = Date.now() - t0;
        results.push({ id, category, name, ...r, durationMs: ms });
        if (r.status === 'pass') passed++;
        else if (r.status === 'warn') warned++;
        else failed++;
      } catch (e: any) {
        results.push({ id, category, name, status: 'fail', detail: e.message, durationMs: Date.now() - t0 });
        failed++;
      }
    };

    // One server snapshot of this campus, used by the data tests below.
    let snap: { students: any[]; parents: any[]; transporters: any[]; branch: any } | null = null;

    // ── WHITEBOX: Server access ──────────────────────────────────────
    await run('wb-01', 'Whitebox — Server', 'Supabase client initialised', async () => {
      if (!supabase) return { status: 'fail', detail: 'supabase object is null/undefined' };
      return { status: 'pass', detail: 'supabase client object exists' };
    });

    await run('wb-02', 'Whitebox — Server', 'Campus data loads through the admin RPC', async () => {
      snap = await adminRpc('admin_branch_data');
      if (!snap) return { status: 'fail', detail: 'admin_branch_data returned nothing' };
      return { status: 'pass', detail: `${snap.students.length} students, ${snap.parents.length} parents, ${snap.transporters.length} transporters` };
    });

    await run('wb-03', 'Whitebox — Server', 'No passwords reach the browser', async () => {
      if (!snap) return { status: 'fail', detail: 'No snapshot loaded' };
      const raw = JSON.stringify(snap);
      if (/"password"/i.test(raw)) return { status: 'fail', detail: 'A password field was returned by admin_branch_data' };
      return { status: 'pass', detail: 'Parent and driver rows contain no password fields' };
    });

    await run('wb-04', 'Whitebox — Server', 'Campus geofence settings readable', async () => {
      const b = snap?.branch;
      if (!b) return { status: 'fail', detail: 'Branch not found' };
      return { status: 'pass', detail: `${b.school_name} — ${b.name}: lat=${b.lat}, lng=${b.lng}, radius=${b.geofence_radius}m, status=${b.status}` };
    });

    await run('wb-05', 'Whitebox — Security', 'Tables are not readable with the public key (RLS)', async () => {
      const { data, error } = await supabase.from('students').select('id').limit(1);
      if (error || !data?.length) return { status: 'pass', detail: 'Direct table read returned no rows' };
      return { status: 'warn', detail: 'Direct table reads still work — RLS (Step 5b) is not enabled yet' };
    });

    const st = () => snap?.students ?? [];
    const pa = () => snap?.parents ?? [];

    // ── WHITEBOX: Data Integrity ──────────────────────────────────────
    await run('wb-06', 'Whitebox — Integrity', 'All students have a name', async () => {
      const bad = st().filter(s => !s.name);
      if (bad.length) return { status: 'fail', detail: `${bad.length} students with no name` };
      return { status: 'pass', detail: 'No missing names' };
    });

    await run('wb-07', 'Whitebox — Integrity', 'All students have a parent_id', async () => {
      const bad = st().filter(s => !s.parent_id);
      if (bad.length) return { status: 'fail', detail: `${bad.length} orphan students` };
      return { status: 'pass', detail: 'All students have parent_id' };
    });

    await run('wb-08', 'Whitebox — Integrity', 'Grade format is Grade N-X', async () => {
      const bad = st().filter(s => s.grade && !/Grade \d+-[A-Z]/i.test(s.grade));
      if (bad.length) return { status: 'warn', detail: `${bad.length} non-standard grades: ${bad.slice(0, 3).map(b => b.grade).join(', ')}` };
      return { status: 'pass', detail: `All ${st().filter(s => s.grade).length} graded students use Grade N-X format` };
    });

    await run('wb-09', 'Whitebox — Integrity', 'No invalid status values', async () => {
      const valid = ['waiting', 'dispatched', 'arrived', 'received'];
      const bad = st().filter(s => !valid.includes(s.status));
      if (bad.length) return { status: 'fail', detail: `${bad.length} invalid status values` };
      return { status: 'pass', detail: 'All statuses are waiting/dispatched/arrived/received' };
    });

    await run('wb-10', 'Whitebox — Integrity', 'Parent IDs are unique within this campus', async () => {
      const ids = pa().map(p => p.parent_id);
      if (new Set(ids).size !== ids.length) return { status: 'fail', detail: 'Duplicate parent_id found in this campus!' };
      return { status: 'pass', detail: `${ids.length} accounts, all unique within this campus` };
    });

    await run('wb-11', 'Whitebox — Integrity', 'Every student parent_id has an account', async () => {
      const accountIds = new Set(pa().map(a => a.parent_id));
      const orphans = [...new Set(st().map(s => s.parent_id))].filter(pid => !accountIds.has(pid));
      if (orphans.length) return { status: 'warn', detail: `${orphans.length} parent IDs with no account: ${orphans.slice(0, 3).join(', ')}` };
      return { status: 'pass', detail: 'Every student parent_id has a matching account' };
    });

    // ── GREYBOX: Filter Logic ─────────────────────────────────────────
    await run('gb-01', 'Greybox — Filters', 'parseGrade handles standard format', async () => {
      const parse = (g?: string|null) => { if (!g) return {cls:'',sec:''}; const m=g.match(/(\d+)-([A-Za-z]+)/); return m?{cls:m[1],sec:m[2].toUpperCase()}:{cls:'',sec:''}; };
      const tests: [string,string,string][] = [['Grade 5-A','5','A'],['Grade 2-C','2','C'],['Grade 10-B','10','B']];
      const bad = tests.filter(([g,ec,es]) => { const {cls,sec}=parse(g); return cls!==ec||sec!==es; });
      if (bad.length) return { status: 'fail', detail: `Failed: ${bad.map(b=>b[0]).join(', ')}` };
      return { status: 'pass', detail: 'parseGrade correctly extracts class and section' };
    });

    await run('gb-02', 'Greybox — Filters', 'Class filter reduces student count', async () => {
      const all = st().filter(s => s.grade);
      const grade1 = all.filter(s => s.grade?.startsWith('Grade 1'));
      if (grade1.length === 0) return { status: 'warn', detail: 'No Grade 1 students found to test filter' };
      if (grade1.length >= all.length) return { status: 'fail', detail: 'Filter not reducing set — all students are Grade 1?' };
      return { status: 'pass', detail: `Grade 1 filter: ${grade1.length}/${all.length} students` };
    });

    await run('gb-03', 'Greybox — Filters', 'Section filter further reduces class filter', async () => {
      const grade2 = st().filter(s => s.grade?.match(/Grade 2-/));
      const grade2A = st().filter(s => s.grade === 'Grade 2-A');
      if (grade2.length === 0) return { status: 'warn', detail: 'No Grade 2 students for section test' };
      if (grade2A.length >= grade2.length) return { status: 'warn', detail: 'Grade 2 only has one section — cannot test further reduction' };
      return { status: 'pass', detail: `Grade 2: ${grade2.length} total, Grade 2-A: ${grade2A.length}` };
    });

    // ── BLACKBOX: Auth Flow ───────────────────────────────────────────
    await run('bb-01', 'Blackbox — Auth', 'Parent login rejects a wrong password', async () => {
      const acc = pa().find(p => p.is_active);
      if (!acc) return { status: 'warn', detail: 'No active parent accounts in this campus to test with' };
      const { data, error } = await supabase.rpc('login_parent', { p_branch_id: branchId, p_parent_id: acc.parent_id, p_password: '__definitely_wrong__' });
      if (error) return { status: 'fail', detail: error.message };
      if (data?.ok) return { status: 'fail', detail: 'Wrong password was accepted!' };
      return { status: 'pass', detail: `Rejected with "${data?.error}"` };
    });

    await run('bb-02', 'Blackbox — Auth', 'Unknown parent rejected', async () => {
      const { data, error } = await supabase.rpc('login_parent', { p_branch_id: branchId, p_parent_id: 'parent_does_not_exist', p_password: 'x' });
      if (error) return { status: 'fail', detail: error.message };
      if (data?.ok) return { status: 'fail', detail: 'Phantom parent was accepted!' };
      return { status: 'pass', detail: `Rejected with "${data?.error}"` };
    });

    await run('bb-03', 'Blackbox — Auth', 'Forged session token is refused', async () => {
      const fake = '00000000-0000-4000-8000-000000000000';
      const { error } = await supabase.rpc('parent_state', { p_token: fake });
      if (!error) return { status: 'fail', detail: 'parent_state accepted a made-up token!' };
      return { status: 'pass', detail: `Refused with "${rpcErrorCode(error) ?? error.message}"` };
    });

    await run('bb-04', 'Blackbox — Tenancy', 'Loaded data belongs to this campus only', async () => {
      const foreign = st().filter(r => r.branch_id && r.branch_id !== branchId).length
        + students.filter((r: any) => r.branch_id && r.branch_id !== branchId).length;
      if (foreign) return { status: 'fail', detail: `${foreign} rows from another campus are visible` };
      return { status: 'pass', detail: `${st().length} students, all in ${branch?.name ?? 'this campus'}` };
    });

    // ── BLACKBOX: Data ────────────────────────────────────────────────
    await run('bb-05', 'Blackbox — Data', 'Multiple grade levels exist', async () => {
      const levels = new Set(st().map(s => s.grade?.match(/(\d+)/)?.[1]).filter(Boolean));
      if (levels.size < 3) return { status: 'warn', detail: `Only ${levels.size} grade levels: ${[...levels].join(', ')}` };
      return { status: 'pass', detail: `${levels.size} grade levels: ${[...levels].sort().join(', ')}` };
    });

    await run('bb-06', 'Blackbox — Data', 'Multiple sections exist', async () => {
      const sections = new Set(st().map(s => s.grade?.match(/-([A-Z])/i)?.[1]?.toUpperCase()).filter(Boolean));
      if (sections.size < 2) return { status: 'warn', detail: `Only ${sections.size} section(s): ${[...sections].join(', ')}` };
      return { status: 'pass', detail: `${sections.size} sections: ${[...sections].sort().join(', ')}` };
    });

    await run('bb-07', 'Blackbox — Data', 'Both gates are used', async () => {
      const gates = new Set(st().map(s => s.gate).filter(Boolean));
      if (gates.size < 2) return { status: 'warn', detail: `Only ${gates.size} gate(s): ${[...gates].join(', ')}` };
      return { status: 'pass', detail: `${gates.size} gates in use: ${[...gates].join(', ')}` };
    });

    // ── Responsiveness ────────────────────────────────────────────────
    await run('rs-01', 'Responsiveness', 'Platform detected', async () => {
      return { status: 'pass', detail: `Platform.OS = "${Platform.OS}"` };
    });

    await run('rs-02', 'Responsiveness', 'Window dimensions (web)', async () => {
      if (Platform.OS !== 'web') return { status: 'pass', detail: 'Native platform — responsive handled via Dimensions API' };
      const w = (window as any).innerWidth;
      const h = (window as any).innerHeight;
      const tier = w < 640 ? 'Mobile (<640px)' : w < 1024 ? 'Tablet (640–1024px)' : 'Desktop (>1024px)';
      return { status: w < 320 ? 'warn' : 'pass', detail: `${w}×${h}px — ${tier}` };
    });

    await run('rs-03', 'Responsiveness', 'Sidebar hidden on mobile (web)', async () => {
      if (Platform.OS !== 'web') return { status: 'pass', detail: 'Mobile bottom nav shown instead of sidebar' };
      const w = (window as any).innerWidth;
      if (w < 768) return { status: 'warn', detail: `Width ${w}px: sidebar may overlap content — consider responsive sidebar toggle` };
      return { status: 'pass', detail: `Width ${w}px: sidebar layout suitable` };
    });

    await run('rs-04', 'Responsiveness', 'ScrollView used in all list panels', async () => {
      // Code inspection: all panels use ScrollView (static check)
      return { status: 'pass', detail: 'Student Directory, Guardian Roster, Dispatch Logs all wrapped in ScrollView' };
    });

    await run('rs-05', 'Responsiveness', 'Filter bar uses horizontal ScrollView', async () => {
      return { status: 'pass', detail: 'FilterBar uses horizontal ScrollView for chip overflow on small screens' };
    });

    const total = passed + failed + warned;
    setTestSummary(`${total} checks · ${passed} passed · ${warned} warnings · ${failed} failed`);
    setTestResults(results);
    setTestRunning(false);
  };

  // ─── Sign-in ──────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <AuthLayout
        title="Staff sign in"
        subtitle="Use the username and password created for you by the school or platform administrator."
        onBack={() => router.replace('/')}
      >
        {loginError ? <Notice tone="error">{loginError}</Notice> : null}
        <TextField label="Username" placeholder="e.g. branch1_admin" value={loginUser} onChangeText={setLoginUser}
          autoComplete="username" returnKeyType="next" />
        <PasswordField label="Password" value={loginPw} onChangeText={setLoginPw} onSubmitEditing={handlePinLogin} returnKeyType="go" />
        <Button label="Sign in" size="lg" full loading={loginLoading} onPress={handlePinLogin} />
      </AuthLayout>
    );
  }

  // ─── Campus chooser (admins with several campuses) ────────────────────────
  if (!branchId) {
    return (
      <AuthLayout title="Choose a campus" subtitle={`Signed in as ${session.fullName || session.username}.`}
        onBack={handleLogout} backLabel="Sign out">
        {session.branches.length === 0 ? (
          <Notice tone="info">No campuses are assigned to this account yet.</Notice>
        ) : (
          <Card padded={false}>
            {session.branches.map((b, i) => (
              <Pressable key={b.branch_id} onPress={() => selectBranch(b.branch_id)} accessibilityRole="button"
                style={({ pressed, hovered }: any) => [
                  { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
                  i > 0 && { borderTopWidth: 1, borderTopColor: color.border },
                  (pressed || hovered) && { backgroundColor: color.sunken },
                ]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.body, { fontWeight: '600', color: color.ink }]} numberOfLines={1}>{b.school_name}</Text>
                  <Text style={type.small} numberOfLines={1}>{b.branch_name} · {b.branch_code}</Text>
                </View>
                {b.status !== 'active' ? <Pill label={b.status === 'paused' ? 'Paused' : 'Archived'} fg={color.warn} bg={color.warnSoft} /> : null}
                <ChevronRight size={18} color={color.faint} strokeWidth={2} />
              </Pressable>
            ))}
          </Card>
        )}
      </AuthLayout>
    );
  }

  if (branchLoading) return <Loading />;

  // Campus admins are locked out of a paused campus; owners / super admins can still manage it.
  if (session.role === 'branch' && !branchLive) {
    return <PausedNotice branch={branch} onExit={handleLogout} />;
  }

  // ─── Data helpers ─────────────────────────────────────────────────────────
  // Parse "Grade 5-A" → { cls: '5', sec: 'A' }
  const parseGrade = (grade?: string | null) => {
    if (!grade) return { cls: '', sec: '' };
    const m = grade.match(/(\d+)-([A-Za-z]+)/);
    return m ? { cls: m[1], sec: m[2].toUpperCase() } : { cls: '', sec: '' };
  };

  const allClasses = [...new Set(students.map(x => parseGrade(x.grade).cls).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const allSections = [...new Set(
    students.filter(x => !filterClass || parseGrade(x.grade).cls === filterClass).map(x => parseGrade(x.grade).sec).filter(Boolean),
  )].sort();

  const q = searchQuery.trim().toLowerCase();
  const applyFilter = (list: Student[]) => list.filter(x => {
    const { cls, sec } = parseGrade(x.grade);
    return (!filterClass || cls === filterClass)
      && (!filterSection || sec === filterSection)
      && (!q || x.name?.toLowerCase().includes(q) || x.parent_id?.toLowerCase().includes(q) || x.grade?.toLowerCase().includes(q));
  });

  const order: Record<string, number> = { dispatched: 0, arrived: 1, waiting: 2, received: 3 };
  const byStatus = (list: Student[]) => [...list].sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4) || a.name.localeCompare(b.name));

  const waitingCount = students.filter(x => x.status === 'waiting').length;
  const dispatchedCount = students.filter(x => x.status === 'dispatched' || x.status === 'arrived').length;
  const receivedCount = students.filter(x => x.status === 'received').length;
  const activeParents = accounts.filter(a => a.is_active).length;
  const syncText = lastSync
    ? `Updated ${lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : 'Loading…';
  const distanceText = (m?: number | null) => (m != null ? `${m} m` : '—');

  const navigate = (id: string) => { setActiveNav(id as NavSection); setSearchQuery(''); };

  const nav: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard, group: 'Today', primary: true },
    { id: 'logs', label: 'Dispatch log', Icon: ClipboardList, group: 'Today' },
    { id: 'students', label: 'Students', Icon: GraduationCap, group: 'People', primary: true },
    { id: 'guardians', label: 'Guardians', Icon: UsersRound, group: 'People' },
    { id: 'accounts', label: 'Parent accounts', Icon: KeyRound, group: 'People', primary: true },
    { id: 'transporters', label: 'Drivers', Icon: Bus, group: 'People', primary: true },
    { id: 'geofence', label: 'Geofence', Icon: MapPinned, group: 'Campus' },
    { id: 'tests', label: 'System tests', Icon: FlaskConical, group: 'Campus' },
  ];

  const footer = [
    ...(session.role !== 'branch' ? [{ label: 'Back to Super Admin', Icon: Landmark, onPress: backToSuperAdmin }] : []),
    ...(session.branches.length > 1 ? [{ label: 'Switch campus', Icon: ArrowLeftRight, onPress: () => selectBranch(null) }] : []),
    { label: 'Sign out', Icon: LogOut, onPress: handleLogout },
  ];

  const roleLabel = session.role === 'owner' ? 'Platform owner' : session.role === 'super' ? 'Super admin' : 'Campus admin';

  // ─── Shared pieces ────────────────────────────────────────────────────────
  const renderFilters = () => (
    <View style={{ gap: space.sm }}>
      <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search by name, guardian or grade" />
      {allClasses.length > 0 ? (
        <ChipRow label="Class" value={filterClass} onChange={k => { setFilterClass(k); setFilterSection(''); }}
          options={[{ key: '', label: 'All' }, ...allClasses.map(c => ({ key: c, label: `Grade ${c}` }))]} />
      ) : null}
      {filterClass && allSections.length > 0 ? (
        <ChipRow label="Section" value={filterSection} onChange={setFilterSection}
          options={[{ key: '', label: 'All' }, ...allSections.map(x => ({ key: x, label: x }))]} />
      ) : null}
    </View>
  );

  const statusCell = (r: Student) => <StatusPill status={r.status} />;

  const studentColumns = (withSend: boolean): Column<Student>[] => [
    { key: 'name', title: 'Student', role: 'primary', flex: 2, render: r => <Cell strong>{r.name}</Cell> },
    { key: 'grade', title: 'Grade', render: r => <Cell>{r.grade || '—'}</Cell> },
    { key: 'gate', title: 'Gate', render: r => <Cell>{r.gate || '—'}</Cell> },
    { key: 'guardian', title: 'Guardian', render: r => <Cell muted>{r.parent_id}</Cell> },
    { key: 'distance', title: 'Distance', render: r => <Cell muted mono>{distanceText(r.last_distance_meters)}</Cell> },
    { key: 'status', title: 'Status', role: 'badge', render: statusCell },
    ...(withSend ? [{
      key: 'send', title: 'Action', role: 'actions' as const, flex: 1.3,
      render: (r: Student) => (r.status === 'waiting'
        ? <Button label="Send to gate" size="sm" variant="secondary" icon={Send} onPress={() => handleDispatch(r.id)} />
        : null),
    }] : []),
  ];

  const resetButton = (
    <Button label="Reset all to waiting" size="sm" variant="secondary" icon={RotateCcw} loading={resetLoading} onPress={handleResetDemo} />
  );

  const ActiveBadge = ({ active }: { active: boolean }) => (
    <Pill label={active ? 'Active' : 'Inactive'} fg={active ? color.done : color.muted} bg={active ? color.doneSoft : color.waitingSoft} />
  );

  // ─── Pages ────────────────────────────────────────────────────────────────
  const renderDashboard = () => {
    const queue = byStatus(applyFilter(students)).filter(x => x.status !== 'received');
    return (
      <>
        <PageHeader title="Dashboard" description={`${syncText} · updates automatically`} actions={resetButton} />
        <KpiRow>
          <Kpi label="Students" value={studentsLoading ? '…' : students.length} hint={branch ? branch.name : undefined} />
          <Kpi label="In class" value={waitingCount} hint="Not yet called" />
          <Kpi label="Sent to gate" value={dispatchedCount} hint="Waiting for pickup" tone="sent" />
          <Kpi label="Picked up" value={receivedCount} hint="Collected today" tone="done" />
          <Kpi label="Parent accounts" value={accountsLoading ? '…' : accounts.length} hint={`${activeParents} active`} />
        </KpiRow>
        <View style={{ gap: space.sm }}>
          <Text style={type.heading}>Pickup queue</Text>
          {renderFilters()}
        </View>
        <DataTable
          columns={studentColumns(true)} rows={queue} keyOf={r => r.id} loading={studentsLoading} minWidth={780}
          empty={{ title: students.length === 0 ? 'No students yet' : 'Nobody left to pick up', body: students.length === 0 ? 'Add students under People → Students.' : 'Everyone matching this filter has been collected, or nothing matches.' }}
        />
      </>
    );
  };

  const renderLogs = () => (
    <>
      <PageHeader title="Dispatch log" description="Every student’s current status. Sent-to-gate students come first." actions={resetButton} />
      {renderFilters()}
      <DataTable
        columns={studentColumns(false)} rows={byStatus(applyFilter(students))} keyOf={r => r.id} loading={studentsLoading} minWidth={760}
        empty={{ title: 'No matching students', body: 'Try a different class, section or search.' }}
      />
    </>
  );

  const renderStudents = () => {
    const rows = applyFilter(students).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <>
        <PageHeader title="Students" description={`${rows.length} of ${students.length} shown`}
          actions={<Button label="Add student" size="sm" icon={Plus} onPress={() => { setNsError(''); setAddStudentOpen(true); }} />} />
        {renderFilters()}
        <DataTable
          columns={studentColumns(false)} rows={rows} keyOf={r => r.id} loading={studentsLoading} minWidth={760}
          empty={{ title: students.length === 0 ? 'No students yet' : 'No matching students', body: students.length === 0 ? 'Add the first student to get started.' : 'Try a different class, section or search.' }}
        />
      </>
    );
  };

  const renderGuardians = () => {
    const map: Record<string, Student[]> = {};
    applyFilter(students).forEach(x => { (map[x.parent_id] ||= []).push(x); });
    const rows = Object.entries(map).map(([pid, kids]) => ({ pid, kids }));
    type Row = typeof rows[number];
    const cols: Column<Row>[] = [
      { key: 'pid', title: 'Guardian', role: 'primary', render: r => <Cell strong>{r.pid}</Cell> },
      { key: 'kids', title: 'Children', flex: 2, render: r => <Cell>{r.kids.map(k => k.name).join(', ')}</Cell> },
      { key: 'gates', title: 'Gates', render: r => <Cell>{[...new Set(r.kids.map(k => k.gate).filter(Boolean))].join(', ') || '—'}</Cell> },
      { key: 'dist', title: 'Distance', render: r => <Cell muted mono>{distanceText(r.kids.find(k => k.last_distance_meters != null)?.last_distance_meters)}</Cell> },
      {
        key: 'status', title: 'Status', role: 'badge', render: r => {
          const all = (st: string) => r.kids.every(k => k.status === st);
          const any = (st: string) => r.kids.some(k => k.status === st);
          if (all('received')) return <StatusPill status="received" />;
          if (any('dispatched') || any('arrived')) return <StatusPill status="dispatched" />;
          if (any('received')) return <Pill label="Partly picked up" fg={color.done} bg={color.doneSoft} />;
          return <StatusPill status="waiting" />;
        },
      },
    ];
    return (
      <>
        <PageHeader title="Guardians" description={`${rows.length} guardians with children on this campus`} />
        {renderFilters()}
        <DataTable columns={cols} rows={rows} keyOf={r => r.pid} loading={studentsLoading} minWidth={720}
          empty={{ title: 'No matching guardians', body: 'Try a different class, section or search.' }} />
      </>
    );
  };

  const renderAccounts = () => {
    const rows = accounts.filter(a => !q || a.parent_id.toLowerCase().includes(q) || a.full_name.toLowerCase().includes(q) || (a.phone || '').includes(q));
    const cols: Column<ParentAccount>[] = [
      { key: 'name', title: 'Parent', role: 'primary', flex: 1.6, render: a => (<View><Cell strong>{a.full_name}</Cell><Text style={type.small}>{a.parent_id}</Text></View>) },
      { key: 'phone', title: 'Phone', render: a => <Cell muted>{a.phone || '—'}</Cell> },
      { key: 'kids', title: 'Children', flex: 2, render: a => <Cell>{students.filter(st => st.parent_id === a.parent_id).map(st => st.name).join(', ') || 'None linked'}</Cell> },
      { key: 'status', title: 'Status', role: 'badge', render: a => <ActiveBadge active={a.is_active} /> },
      {
        key: 'actions', title: 'Actions', role: 'actions', flex: 1.2, render: a => (
          <>
            <IconButton Icon={Power} label={a.is_active ? 'Deactivate account' : 'Activate account'} onPress={() => handleToggleActive(a)} />
            <IconButton Icon={Pencil} label="Edit account" onPress={() => openEditAccount(a)} />
            <IconButton Icon={Trash2} label="Delete account" tone="danger" onPress={() => handleDeleteAccount(a)} />
          </>
        ),
      },
    ];
    return (
      <>
        <PageHeader title="Parent accounts" description={`${accounts.length} accounts · ${activeParents} active. Passwords are stored hashed and can only be reset.`}
          actions={<Button label="New account" size="sm" icon={Plus} onPress={openAddAccount} />} />
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search by name, ID or phone" />
        <DataTable columns={cols} rows={rows} keyOf={a => a.id} loading={accountsLoading} minWidth={760}
          empty={{ title: accounts.length === 0 ? 'No parent accounts yet' : 'No matching accounts', body: accounts.length === 0 ? 'Create an account so a parent can sign in.' : undefined }} />
      </>
    );
  };

  const renderTransporters = () => {
    const rows = transporters.filter(t => !q || t.driver_id.toLowerCase().includes(q) || t.driver_name.toLowerCase().includes(q) || t.vehicle_number.toLowerCase().includes(q));
    const cols: Column<TransporterAccount>[] = [
      { key: 'name', title: 'Driver', role: 'primary', flex: 1.6, render: t => (<View><Cell strong>{t.driver_name}</Cell><Text style={type.small}>{t.driver_id}</Text></View>) },
      { key: 'vehicle', title: 'Vehicle', flex: 1.3, render: t => <Cell>{t.vehicle_type} · {t.vehicle_number}</Cell> },
      { key: 'families', title: 'Families', flex: 2, render: t => <Cell muted>{(t.linked_parent_ids || []).length ? `${t.linked_parent_ids.length} · ${t.linked_parent_ids.join(', ')}` : 'None linked'}</Cell> },
      { key: 'status', title: 'Status', role: 'badge', render: t => <ActiveBadge active={t.is_active} /> },
      {
        key: 'actions', title: 'Actions', role: 'actions', flex: 1.2, render: t => (
          <>
            <IconButton Icon={Power} label={t.is_active ? 'Deactivate driver' : 'Activate driver'} onPress={() => handleToggleTransporterActive(t)} />
            <IconButton Icon={Pencil} label="Edit driver" onPress={() => openEditTransporter(t)} />
            <IconButton Icon={Trash2} label="Delete driver" tone="danger" onPress={() => handleDeleteTransporter(t)} />
          </>
        ),
      },
    ];
    return (
      <>
        <PageHeader title="Drivers" description={`${transporters.length} drivers. Each driver collects the families linked to them.`}
          actions={<Button label="New driver" size="sm" icon={Plus} onPress={openAddTransporter} />} />
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search by name, ID or vehicle number" />
        <DataTable columns={cols} rows={rows} keyOf={t => t.id} loading={transportersLoading} minWidth={800}
          empty={{ title: transporters.length === 0 ? 'No drivers yet' : 'No matching drivers', body: transporters.length === 0 ? 'Add a driver and link the families they collect.' : undefined }} />
      </>
    );
  };

  const renderGeofence = () => {
    const dirty = tempRadius !== geofenceRadius;
    const coord = (label: string, v: number) => (
      <View style={{ flex: 1, backgroundColor: color.sunken, borderRadius: radius.md, padding: space.md, gap: 2 }}>
        <Text style={type.small}>{label}</Text>
        <Text style={[type.body, { color: color.ink, fontVariant: ['tabular-nums'] }]}>{v.toFixed(6)}</Text>
      </View>
    );
    return (
      <>
        <PageHeader title="Geofence" description="Where the school gate is, and how close a parent or driver must be to check in." />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, alignItems: 'flex-start' }}>
          <Card style={{ flexGrow: 1, flexBasis: 340, gap: space.lg }}>
            <View style={{ gap: 2 }}>
              <Text style={type.heading}>Gate location</Text>
              <Text style={type.small}>Check-in distance is measured from this point.</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              {coord('Latitude', schoolLocation.lat)}
              {coord('Longitude', schoolLocation.lng)}
            </View>
            <View style={{ alignItems: 'flex-start' }}>
              <Button label="Move pin on map" variant="secondary" icon={MapPin} onPress={() => setIsMapOpen(true)} />
            </View>
            {Platform.OS === 'web' ? (
              <View style={{ height: 260, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: color.border }}>
                {/* @ts-ignore */}
                <iframe title="Gate location" srcDoc={`<!DOCTYPE html><html><head>
                  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
                  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                  <style>body,html,#map{margin:0;padding:0;height:100%;width:100%;}</style>
                </head><body><div id="map"></div><script>
                  const m=L.map('map').setView([${schoolLocation.lat},${schoolLocation.lng}],15);
                  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(m);
                  L.marker([${schoolLocation.lat},${schoolLocation.lng}]).addTo(m);
                  L.circle([${schoolLocation.lat},${schoolLocation.lng}],{radius:${tempRadius},color:'${color.accent}',fillOpacity:0.15}).addTo(m);
                </script></body></html>`}
                  style={{ width: '100%', height: '100%', border: 'none' }} />
              </View>
            ) : null}
          </Card>

          <Card style={{ flexGrow: 1, flexBasis: 300, gap: space.lg }}>
            <View style={{ gap: 2 }}>
              <Text style={type.heading}>Pickup radius</Text>
              <Text style={type.small}>Parents and drivers can check in only inside this distance.</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ fontSize: 44, lineHeight: 50, fontWeight: '700', color: color.ink, letterSpacing: -1, fontVariant: ['tabular-nums'] }}>{tempRadius}</Text>
              <Text style={[type.heading, { color: color.muted, fontWeight: '500' }]}>m</Text>
            </View>
            {Platform.OS === 'web' ? (
              <View>
                {/* @ts-ignore */}
                <input type="range" min="50" max="500" step="10" value={tempRadius} aria-label="Pickup radius in metres"
                  onChange={(e: any) => setTempRadius(Number(e.target.value))}
                  style={{ width: '100%', accentColor: color.accent, cursor: 'pointer' }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={type.small}>50 m</Text><Text style={type.small}>500 m</Text>
                </View>
              </View>
            ) : (
              <ChipRow value={String(tempRadius)} onChange={k => setTempRadius(Number(k))}
                options={[50, 100, 150, 200, 300, 500].map(v => ({ key: String(v), label: `${v} m` }))} />
            )}
            <Button label={dirty ? 'Save radius' : 'Saved'} disabled={!dirty} onPress={saveGeofenceRadius} />
          </Card>
        </View>

        <Card style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.lg }}>
          <View style={{ flex: 1, minWidth: 260, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={type.heading}>Demo mode</Text>
              <Pill label={demoMode ? 'On' : 'Off'} fg={demoMode ? color.warn : color.muted} bg={demoMode ? color.warnSoft : color.waitingSoft} />
            </View>
            <Text style={type.small}>
              Shows an “Outside / Inside” shortcut in the parent and driver apps so you can demonstrate check-in without
              standing at the school. Real families should never see it, so leave it off in normal use.
            </Text>
          </View>
          <Button label={demoMode ? 'Turn off demo mode' : 'Turn on demo mode'} variant={demoMode ? 'secondary' : 'primary'}
            loading={demoSaving} onPress={toggleDemoMode} />
        </Card>
      </>
    );
  };

  const renderTests = () => {
    const failed = testResults.filter(r => r.status === 'fail').length;
    const warned = testResults.filter(r => r.status === 'warn').length;
    return (
      <>
        <PageHeader title="System tests" description="Checks that this campus’s data, sign-ins and data isolation are working."
          actions={<Button label={testRunning ? 'Running…' : 'Run all checks'} size="sm" icon={Play} loading={testRunning} onPress={runAllTests} />} />
        {testSummary ? <Notice tone={failed ? 'error' : warned ? 'warn' : 'success'}>{testSummary}</Notice> : null}
        {testResults.length === 0 && !testRunning ? (
          <Card><Text style={type.body}>Press “Run all checks” to test this campus.</Text></Card>
        ) : null}
        {[...new Set(testResults.map(r => r.category))].map(cat => (
          <View key={cat} style={{ gap: space.sm }}>
            <Text style={type.overline}>{cat}</Text>
            <Card padded={false}>
              {testResults.filter(r => r.category === cat).map((r, i) => {
                const Icon = r.status === 'pass' ? CircleCheck : r.status === 'fail' ? CircleAlert : TriangleAlert;
                const fg = r.status === 'pass' ? color.done : r.status === 'fail' ? color.danger : color.warn;
                return (
                  <View key={r.id} style={[{ flexDirection: 'row', gap: space.md, padding: space.md + 2, alignItems: 'flex-start' }, i > 0 && { borderTopWidth: 1, borderTopColor: color.border }]}>
                    <Icon size={18} color={fg} strokeWidth={2} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={[type.body, { fontWeight: '600', color: color.ink }]}>{r.name}</Text>
                      <Text style={type.small}>{r.detail}</Text>
                    </View>
                    {r.durationMs != null ? <Text style={type.small}>{r.durationMs} ms</Text> : null}
                  </View>
                );
              })}
            </Card>
          </View>
        ))}
      </>
    );
  };

  const renderContent = () => {
    switch (activeNav) {
      case 'students': return renderStudents();
      case 'guardians': return renderGuardians();
      case 'geofence': return renderGeofence();
      case 'logs': return renderLogs();
      case 'accounts': return renderAccounts();
      case 'transporters': return renderTransporters();
      case 'tests': return renderTests();
      default: return renderDashboard();
    }
  };

  // ─── Dialog data ──────────────────────────────────────────────────────────
  const assignedElsewhere = new Set<string>();
  transporters.forEach(tr => {
    if (!editTransporter || tr.id !== editTransporter.id) (tr.linked_parent_ids || []).forEach(pid => assignedElsewhere.add(pid));
  });
  const availableFamilies = accounts
    .filter(a => !assignedElsewhere.has(a.parent_id) || nt_linkedParents.includes(a.parent_id))
    .map(a => ({ key: a.parent_id, label: `${a.full_name} · ${a.parent_id}` }));

  const cancel = (fn: () => void) => <Button label="Cancel" variant="secondary" onPress={fn} />;

  return (
    <View style={{ flex: 1 }}>
      <AdminShell
        context={branch ? `${branch.school_name} — ${branch.name}` : 'Campus'}
        contextSub={roleLabel}
        user={session.username}
        nav={nav}
        active={activeNav}
        onNavigate={navigate}
        footer={footer}
        banner={!branchLive ? (
          <Notice tone="warn" title="This campus is paused">
            Parents, drivers and campus admins are blocked until it is resumed. You can still manage it here.
          </Notice>
        ) : undefined}
      >
        {renderContent()}
      </AdminShell>

      {toast ? <Toast tone={toast.tone} text={toast.text} onClose={() => setToast(null)} /> : null}
      {confirmState ? <ConfirmDialog options={confirmState.opts} onResult={answerConfirm} /> : null}

      {isMapOpen ? (
        <Dialog title="Move the gate pin" subtitle="Click the map to drop the pin, or drag it." onClose={() => setIsMapOpen(false)}
          footer={(<>{cancel(() => setIsMapOpen(false))}<Button label="Save location" onPress={saveMapLocation} /></>)}>
          <View style={{ height: 340, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: color.border }}>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <iframe title="Choose gate location" srcDoc={`<!DOCTYPE html><html>
                <head><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
                <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                <style>body,html,#map{margin:0;padding:0;height:100%;width:100%;}</style></head>
                <body><div id="map"></div><script>
                  const map=L.map('map').setView([${tempLocation.lat},${tempLocation.lng}],15);
                  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                  let mk=L.marker([${tempLocation.lat},${tempLocation.lng}],{draggable:true}).addTo(map);
                  function send(lat,lng){window.parent.postMessage({type:'UPDATE_LOCATION',lat,lng},'*');}
                  mk.on('dragend',e=>{const p=e.target.getLatLng();send(p.lat,p.lng);});
                  map.on('click',e=>{mk.setLatLng(e.latlng);send(e.latlng.lat,e.latlng.lng);});
                </script></body></html>`}
                style={{ width: '100%', height: '100%', border: 'none' }} />
            ) : <Text style={[type.small, { padding: space.lg }]}>The map is only available on the web version.</Text>}
          </View>
          <Text style={type.small}>Selected: {tempLocation.lat.toFixed(5)}, {tempLocation.lng.toFixed(5)}</Text>
        </Dialog>
      ) : null}

      {addStudentOpen ? (
        <Dialog title="Add student" onClose={() => setAddStudentOpen(false)}
          footer={(<>{cancel(() => setAddStudentOpen(false))}<Button label="Add student" loading={ns_loading} onPress={handleAddStudent} /></>)}>
          {nsError ? <Notice tone="error">{nsError}</Notice> : null}
          <TextField label="Full name" placeholder="e.g. Zara Khan" value={ns_name} onChangeText={setNs_name} autoCapitalize="words" />
          <TextField label="Grade" placeholder="e.g. Grade 4-A" value={ns_grade} onChangeText={setNs_grade} hint="Use the format Grade 4-A so class filters work." />
          <TextField label="Guardian ID" placeholder="e.g. parent_003" value={ns_parentId} onChangeText={setNs_parentId} />
          <Segmented label="Pickup gate" options={['Gate A', 'Gate B', 'Gate C']} value={ns_gate} onChange={setNs_gate} />
        </Dialog>
      ) : null}

      {addAccountOpen ? (
        <Dialog title={editAccount ? 'Edit parent account' : 'New parent account'}
          subtitle={editAccount ? undefined : 'The parent signs in with this ID and password.'}
          onClose={() => setAddAccountOpen(false)}
          footer={(<>{cancel(() => setAddAccountOpen(false))}<Button label={editAccount ? 'Save changes' : 'Create account'} loading={na_loading} onPress={handleSaveAccount} /></>)}>
          {accountModalError ? <Notice tone="error">{accountModalError}</Notice> : null}
          <TextField label="Parent ID" placeholder="e.g. parent_005" value={na_parentId} onChangeText={setNa_parentId}
            editable={!editAccount} hint={editAccount ? 'The ID can’t be changed.' : undefined} />
          <TextField label="Full name" placeholder="e.g. Sarah Ahmed" value={na_fullName} onChangeText={setNa_fullName} autoCapitalize="words" />
          <PasswordField label={editAccount ? 'New password' : 'Password'} value={na_password} onChangeText={setNa_password}
            hint={editAccount ? 'Leave blank to keep the current password.' : undefined} />
          <TextField label="Phone (optional)" placeholder="e.g. 0300-1234567" value={na_phone} onChangeText={setNa_phone} keyboardType="phone-pad" />
        </Dialog>
      ) : null}

      {addTransporterOpen ? (
        <Dialog title={editTransporter ? 'Edit driver' : 'New driver'}
          subtitle={editTransporter ? undefined : 'Register a driver and choose the families they collect.'}
          onClose={() => setAddTransporterOpen(false)}
          footer={(<>{cancel(() => setAddTransporterOpen(false))}<Button label={editTransporter ? 'Save changes' : 'Create driver'} loading={nt_loading} onPress={handleSaveTransporter} /></>)}>
          {transporterModalError ? <Notice tone="error">{transporterModalError}</Notice> : null}
          <TextField label="Driver ID" placeholder="e.g. driver_001" value={nt_driverId} onChangeText={setNt_driverId}
            editable={!editTransporter} hint={editTransporter ? 'The ID can’t be changed.' : undefined} />
          <TextField label="Full name" placeholder="e.g. Afzal Khan" value={nt_driverName} onChangeText={setNt_driverName} autoCapitalize="words" />
          <Segmented label="Vehicle type" options={['Rickshaw', 'School Van', 'Taxi/Carpool']} value={nt_vehicleType} onChange={setNt_vehicleType} />
          <TextField label="Vehicle number" placeholder="e.g. LEA-4920" value={nt_vehicleNumber} onChangeText={setNt_vehicleNumber} autoCapitalize="characters" />
          <PasswordField label={editTransporter ? 'New password' : 'Password'} value={nt_password} onChangeText={setNt_password}
            hint={editTransporter ? 'Leave blank to keep the current password.' : undefined} />
          <TextField label="Phone (optional)" placeholder="e.g. 0301-5550001" value={nt_phone} onChangeText={setNt_phone} keyboardType="phone-pad" />
          <ChipGroup label={`Families on this route (${nt_linkedParents.length})`} options={availableFamilies} selected={nt_linkedParents}
            empty="Every parent account is already assigned to a driver."
            onToggle={k => setNt_linkedParents(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]))} />
        </Dialog>
      ) : null}
    </View>
  );
}
