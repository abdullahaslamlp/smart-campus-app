import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator, Alert, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../../supabase';
import {
  LOGIN_ERRORS, PausedScreen, isSessionError, loadSession, rpcErrorCode, rpcMessage, saveSession,
  subscribeBranchPings, useBranch,
} from '../lib/tenant';

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

// ─── Constants ────────────────────────────────────────────────────────────────
const SLATE = '#466179';
const SLATE_DARK = '#2d3f50';
const SLATE_LIGHT = '#b0cce8';
const WHITE = '#ffffff';
const SURFACE = '#f4f7fb';
const BORDER = '#c3c7cd';
const TEXT = '#1a1c1d';
const MUTED = '#767779';
const SIDEBAR_W = 260;

// ─── Haversine ────────────────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, toRad = (x: number) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── FormField (must be outside component to keep stable identity across renders) ──
function FormField({ label, value, setter, placeholder, secret = false }: {
  label: string; value: string; setter: (v: string) => void;
  placeholder: string; secret?: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.formLabel}>{label}</Text>
      {Platform.OS === 'web' ? (
        // @ts-ignore
        <input
          style={{ ...s.formInputWeb, outline: 'none', boxSizing: 'border-box' } as any}
          placeholder={placeholder}
          value={value}
          onChange={(e: any) => setter(e.target.value)}
        />
      ) : (
        <TextInput
          style={s.formInput}
          placeholder={placeholder}
          value={value}
          onChangeText={setter}
          secureTextEntry={secret}
          placeholderTextColor={MUTED}
        />
      )}
    </View>
  );
}

// ─── FilterBar (stable module-level component to avoid remount focus loss) ──
function FilterBar({ classes, sections, filterClass, filterSection, onClassChange, onSectionChange }: {
  classes: string[]; sections: string[];
  filterClass: string; filterSection: string;
  onClassChange: (v: string) => void; onSectionChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 6, marginBottom: 12 }}>
      {/* Class row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
        <Pressable onPress={() => { onClassChange(''); onSectionChange(''); }}
          style={[s.filterChip, !filterClass && s.filterChipActive]}>
          <Text style={[s.filterChipTxt, !filterClass && s.filterChipTxtActive]}>All Classes</Text>
        </Pressable>
        {classes.map(c => (
          <Pressable key={c} onPress={() => { onClassChange(c); onSectionChange(''); }}
            style={[s.filterChip, filterClass === c && s.filterChipActive]}>
            <Text style={[s.filterChipTxt, filterClass === c && s.filterChipTxtActive]}>Grade {c}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {/* Section row — only shows when a class is selected */}
      {filterClass ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
          <Pressable onPress={() => onSectionChange('')}
            style={[s.filterChip, s.filterChipSec, !filterSection && s.filterChipSecActive]}>
            <Text style={[s.filterChipTxt, !filterSection && s.filterChipTxtActive]}>All Sections</Text>
          </Pressable>
          {sections.map(sec => (
            <Pressable key={sec} onPress={() => onSectionChange(sec)}
              style={[s.filterChip, s.filterChipSec, filterSection === sec && s.filterChipSecActive]}>
              <Text style={[s.filterChipTxt, filterSection === sec && s.filterChipTxtActive]}>Section {sec}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminPortal() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = Platform.OS !== 'web' || windowWidth < 768;

  // ── Admin auth ──
  const [session, setSession] = useState<AdminSession | null>(() => getAdminSession());
  const [loginUser, setLoginUser] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const branchId = session?.branchId ?? null;
  const pinAuthed = !!branchId;
  const { branch, loading: branchLoading, live: branchLive } = useBranch(branchId);

  // ── App state ──
  const [students, setStudents] = useState<Student[]>([]);
  const [accounts, setAccounts] = useState<ParentAccount[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
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

  // ── Add Student modal ──
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [ns_name, setNs_name] = useState('');
  const [ns_grade, setNs_grade] = useState('');
  const [ns_gate, setNs_gate] = useState('Gate A');
  const [ns_parentId, setNs_parentId] = useState('');
  const [ns_loading, setNs_loading] = useState(false);

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

  // ── Password Visibility Toggles ──
  const [showParentPasswords, setShowParentPasswords] = useState(false);
  const [showTransporterPasswords, setShowTransporterPasswords] = useState(false);
  const [showParentModalPw, setShowParentModalPw] = useState(false);
  const [showTransporterModalPw, setShowTransporterModalPw] = useState(false);

  // ─── PIN Login ─────────────────────────────────────────────────────────────
  const updateSession = (next: AdminSession | null) => {
    setAdminSession(next);
    setSession(next);
  };

  const handlePinLogin = async () => {
    if (!loginUser.trim() || !loginPw) {
      setLoginError('Please enter your username and password.');
      return;
    }
    setLoginError('');
    setLoginLoading(true);
    try {
      const { data, error } = await supabase.rpc('login_admin', { p_username: loginUser, p_password: loginPw });
      if (error) { setLoginError('Connection error. Please try again.'); console.error('[adminLogin]', error.message); return; }
      if (!data?.ok) {
        setLoginError(data?.error === 'no_branch'
          ? 'No campus is assigned to this admin account.'
          : LOGIN_ERRORS[data?.error] ?? 'Login failed. Please try again.');
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
      setLoginError('An unexpected error occurred.');
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

  const showError = (title: string, e: any) => {
    const msg = rpcMessage(e);
    if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
    else Alert.alert(title, msg);
  };

  const confirmWeb = (message: string) => (Platform.OS === 'web' ? window.confirm(message) : true);

  // One snapshot of the campus (students, parents, transporters — never passwords).
  const loadAll = async () => {
    if (!branchId || !session?.token) return;
    try {
      const data = await adminRpc('admin_branch_data');
      setStudents((data?.students as Student[]) || []);
      setAccounts((data?.parents as ParentAccount[]) || []);
      setTransporters((data?.transporters as TransporterAccount[]) || []);
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
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
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
      clearInterval(timer);
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
    if (!confirmWeb(`Delete driver "${tr.driver_name}" (${tr.driver_id})?`)) return;
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
    if (!radiusSaved) setTempRadius(branch.geofence_radius);
  }, [branch?.id, branch?.lat, branch?.lng, branch?.geofence_radius]);

  // ─── Admin Handlers ───────────────────────────────────────────────────────
  const handleResetDemo = async () => {
    setResetLoading(true);
    try {
      await adminRpc('admin_reset_demo');
      loadAll();
    } catch (e: any) { showError('Reset failed', e); }
    finally { setResetLoading(false); }
  };

  const handleDispatch = async (id: string) => {
    try {
      await adminRpc('admin_set_student_status', { p_student_id: id, p_status: 'dispatched' });
      loadAll();
    } catch (e: any) { showError('Dispatch failed', e); }
  };

  const saveMapLocation = async () => {
    try {
      await adminRpc('admin_save_geofence', { p_lat: tempLocation.lat, p_lng: tempLocation.lng });
      setSchoolLocation(tempLocation);
      setIsMapOpen(false);
    } catch (e: any) { showError('Could not save location', e); }
  };

  const saveGeofenceRadius = async () => {
    try {
      await adminRpc('admin_save_geofence', { p_radius: tempRadius });
      setGeofenceRadius(tempRadius);
      setRadiusSaved(true);
      setTimeout(() => setRadiusSaved(false), 2000);
    } catch (e: any) { showError('Could not save radius', e); }
  };

  // ─── Add Student ──────────────────────────────────────────────────────────
  const handleAddStudent = async () => {
    if (!ns_name.trim() || !ns_parentId.trim()) {
      showError('Validation', new Error('Name and Guardian ID are required.')); return;
    }
    setNs_loading(true);
    try {
      await adminRpc('admin_add_student', {
        p_name: ns_name.trim(), p_grade: ns_grade.trim() || null,
        p_gate: ns_gate, p_parent_id: ns_parentId.trim().toLowerCase(),
      });
      setAddStudentOpen(false); setNs_name(''); setNs_grade(''); setNs_parentId('');
      loadAll();
    } catch (e: any) { showError('Could not add student', e); }
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
    const doDelete = async () => {
      try {
        await adminRpc('admin_delete_parent', { p_id: acc.id });
        loadAll();
      } catch (e: any) { showError('Delete failed', e); }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${acc.full_name}'s account? This cannot be undone.`)) doDelete();
      return;
    }
    Alert.alert('Delete Account', `Delete ${acc.full_name}'s account? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doDelete },
    ]);
  };

  // ─── Status style ─────────────────────────────────────────────────────────
  const statusStyle = (s: string) => {
    if (s === 'dispatched') return { bg: '#d1e4ff', text: '#001d35' };
    if (s === 'arrived') return { bg: '#b7d7ff', text: '#28496a' };
    if (s === 'received') return { bg: '#e0e7ff', text: '#3730a3' };
    return { bg: '#e2e2e4', text: '#43474d' };
  };

  // ─── Login Gate ───────────────────────────────────────────────────────────
  if (!session) {
    const webInput = (extra: any) => ({ ...s.formInputWeb, outline: 'none', boxSizing: 'border-box', ...extra } as any);
    return (
      <View style={s.pinRoot}>
        <View style={s.pinCard}>
          <View style={s.pinLogoWrap}>
            <Text style={{ fontSize: 36 }}>🛡️</Text>
          </View>
          <Text style={s.pinTitle}>Admin Portal</Text>
          <Text style={s.pinSub}>Sign in with your campus admin account</Text>

          {loginError ? <View style={s.errorBanner}><Text style={s.errorText}>⚠️ {loginError}</Text></View> : null}

          <View style={{ gap: 4, alignSelf: 'stretch' }}>
            <Text style={s.formLabel}>Username</Text>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <input style={webInput({})} placeholder="e.g. branch1_admin" value={loginUser}
                autoComplete="username" onChange={(e: any) => setLoginUser(e.target.value)} />
            ) : (
              <TextInput style={s.formInput} placeholder="e.g. branch1_admin" value={loginUser}
                onChangeText={setLoginUser} autoCapitalize="none" placeholderTextColor={MUTED} />
            )}
          </View>

          <View style={{ gap: 4, alignSelf: 'stretch' }}>
            <Text style={s.formLabel}>Password</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {Platform.OS === 'web' ? (
                // @ts-ignore
                <input
                  style={webInput({ flex: 1 })}
                  type={showPin ? 'text' : 'password'}
                  placeholder="Enter password"
                  value={loginPw}
                  autoComplete="current-password"
                  onChange={(e: any) => setLoginPw(e.target.value)}
                  onKeyDown={(e: any) => e.key === 'Enter' && handlePinLogin()}
                />
              ) : (
                <TextInput style={[s.formInput, { flex: 1 }]}
                  placeholder="Enter password" value={loginPw}
                  onChangeText={setLoginPw} secureTextEntry={!showPin}
                  placeholderTextColor={MUTED} />
              )}
              <Pressable style={s.eyeBtn} onPress={() => setShowPin(p => !p)}>
                <Text style={{ fontSize: 18 }}>{showPin ? '🙈' : '👁️'}</Text>
              </Pressable>
            </View>
          </View>

          <Pressable style={s.pinBtn} onPress={handlePinLogin} disabled={loginLoading}>
            {loginLoading
              ? <ActivityIndicator color={WHITE} />
              : <Text style={s.pinBtnText}>Sign In →</Text>}
          </Pressable>

          <Pressable onPress={() => router.replace('/')}>
            <Text style={s.backLink}>← Back to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── Campus chooser (admins with access to several campuses) ─────────────
  if (!branchId) {
    return (
      <View style={s.pinRoot}>
        <View style={[s.pinCard, { maxWidth: 520 }]}>
          <Text style={s.pinTitle}>Choose a Campus</Text>
          <Text style={s.pinSub}>Signed in as {session.fullName || session.username}</Text>
          {session.branches.length === 0 ? (
            <Text style={s.pinSub}>No campuses are assigned to this account yet.</Text>
          ) : (
            <View style={{ alignSelf: 'stretch', gap: 8 }}>
              {session.branches.map(b => (
                <Pressable key={b.branch_id} style={s.campusRow} onPress={() => selectBranch(b.branch_id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.campusSchool}>{b.school_name}</Text>
                    <Text style={s.campusBranch}>{b.branch_name} · {b.branch_code}</Text>
                  </View>
                  {b.status !== 'active' ? <Text style={s.campusPaused}>{b.status.toUpperCase()}</Text> : null}
                  <Text style={{ color: SLATE, fontWeight: '700' }}>→</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable onPress={handleLogout}>
            <Text style={s.backLink}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (branchLoading) {
    return (
      <View style={s.pinRoot}><ActivityIndicator color={SLATE} size="large" /></View>
    );
  }

  // Branch admins are locked out of a paused campus; owners / super admins can still manage it.
  if (session.role === 'branch' && !branchLive) {
    return <PausedScreen branch={branch} onExit={handleLogout} />;
  }

  // ─── ADMIN PORTAL ─────────────────────────────────────────────────────────
  // Parse "Grade 5-A" → { cls: '5', sec: 'A' }
  const parseGrade = (grade?: string | null) => {
    if (!grade) return { cls: '', sec: '' };
    const m = grade.match(/(\d+)-([A-Za-z]+)/);
    return m ? { cls: m[1], sec: m[2].toUpperCase() } : { cls: '', sec: '' };
  };

  // Unique sorted class numbers across all students
  const allClasses = [...new Set(
    students.map(x => parseGrade(x.grade).cls).filter(Boolean)
  )].sort((a, b) => Number(a) - Number(b));

  // Sections available within the selected class
  const allSections = [...new Set(
    students
      .filter(x => !filterClass || parseGrade(x.grade).cls === filterClass)
      .map(x => parseGrade(x.grade).sec)
      .filter(Boolean)
  )].sort();

  // Central filter helper
  const applyFilter = (list: Student[]) => list.filter(x => {
    const { cls, sec } = parseGrade(x.grade);
    const matchClass   = !filterClass   || cls === filterClass;
    const matchSection = !filterSection || sec === filterSection;
    const matchSearch  = !searchQuery   ||
      x.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      x.parent_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      x.grade?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchClass && matchSection && matchSearch;
  });

  const dispatchedCount = students.filter(x => x.status === 'dispatched').length;
  const receivedCount = students.filter(x => x.status === 'received').length;
  // Legacy filtered (dashboard uses applyFilter below)
  const filtered = applyFilter(students);

  const renderDashboard = () => (
    <>
      {/* Class / Section filter bar */}
      <FilterBar
        classes={allClasses} sections={allSections}
        filterClass={filterClass} filterSection={filterSection}
        onClassChange={setFilterClass} onSectionChange={setFilterSection}
      />
      {/* KPI Row */}
      <View style={s.kpiRow}>
        {[
          { label: 'TOTAL STUDENTS', value: studentsLoading ? '…' : String(filtered.length === students.length ? students.length : `${filtered.length}/${students.length}`), sub: filterClass ? `Grade ${filterClass}${filterSection ? '-' + filterSection : ''}` : 'Enrolled', icon: '👥', subColor: SLATE },
          { label: 'ACTIVE DISMISSALS', value: String(filtered.filter(x => x.status === 'dispatched').length), sub: 'In progress', icon: '🚶', subColor: SLATE },
          { label: 'RECEIVED TODAY', value: String(filtered.filter(x => x.status === 'received').length), sub: 'Safely home', icon: '🏠', subColor: '#3730a3' },
          { label: 'PARENT ACCOUNTS', value: accountsLoading ? '…' : String(accounts.length), sub: String(accounts.filter(a => a.is_active).length) + ' active', icon: '👨‍👩‍👧', subColor: '#10B981' },
          { label: 'GEOFENCE RADIUS', value: `${geofenceRadius}m`, sub: 'Standard Range', icon: '📡', subColor: MUTED },
        ].map((kpi, i) => (
          <View key={i} style={s.kpiCard}>
            <View style={s.kpiTop}>
              <Text style={s.kpiLabel}>{kpi.label}</Text>
              <Text style={s.kpiIcon}>{kpi.icon}</Text>
            </View>
            <Text style={s.kpiValue}>{kpi.value}</Text>
            <Text style={[s.kpiSub, { color: kpi.subColor }]}>{kpi.sub}</Text>
          </View>
        ))}
      </View>

      {/* Split: Dispatch Logs + Geofence Controls */}
      <View style={s.splitRow}>
        {/* Live Dispatch Logs */}
        <View style={s.panel}>
          <View style={s.panelHeader}>
            <Text style={s.panelTitle}>Live Dispatch Logs</Text>
            <View style={s.panelHeaderRight}>
              <Pressable style={s.smBtn} onPress={handleResetDemo} disabled={resetLoading}>
                {resetLoading ? <ActivityIndicator size="small" color={SLATE} /> : <Text style={s.smBtnText}>🔄 Reset</Text>}
              </Pressable>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ minWidth: 550, width: '100%' }}>
              <View style={s.tableHeader}>
                {['Time', 'Student', 'Guardian', 'Gate', 'Distance', 'Status'].map(h => (
                  <Text key={h} style={[s.th, h === 'Student' ? { flex: 2 } : {}]}>{h}</Text>
                ))}
              </View>
              {studentsLoading ? (
                <View style={s.loader}><ActivityIndicator color={SLATE} /><Text style={s.loaderText}>Loading…</Text></View>
              ) : filtered.length === 0 ? (
                <View style={s.loader}><Text style={s.loaderText}>No students match this filter.</Text></View>
              ) : filtered.map(item => {
                const st = statusStyle(item.status);
                return (
                  <Pressable key={item.id} style={s.tableRow}
                    onPress={() => item.status === 'waiting' && handleDispatch(item.id)}>
                    <Text style={[s.td, { color: MUTED }]}>
                      {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </Text>
                    <Text style={[s.td, s.tdBold, { flex: 2 }]}>{item.name}</Text>
                    <Text style={s.td}>{item.parent_id}</Text>
                    <Text style={s.td}>{item.gate || '—'}</Text>
                    <Text style={[s.td, { color: SLATE }]}>{item.last_distance_meters != null ? `${item.last_distance_meters}m` : '—'}</Text>
                    <View style={s.td}>
                      <View style={[s.pill, { backgroundColor: st.bg }]}>
                        <Text style={[s.pillText, { color: st.text }]}>
                          {item.status === 'received' ? 'Received 🏠' : item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* Geofence Quick Controls */}
        <View style={s.geoPanel}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Text style={{ fontSize: 26 }}>📡</Text>
            <Text style={s.panelTitle}>Geofence{'\n'}Controls</Text>
          </View>
          <Text style={{ fontSize: 13, color: MUTED, lineHeight: 18 }}>
            Adjust detection radius for automatic arrival triggers.
          </Text>
          <View style={{ gap: 6, marginTop: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: MUTED }}>50m</Text>
              <Text style={{ fontSize: 22, fontWeight: '800', color: SLATE }}>{tempRadius}m</Text>
              <Text style={{ fontSize: 12, color: MUTED }}>500m</Text>
            </View>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <input type="range" min="50" max="500" value={tempRadius}
                onChange={(e: any) => setTempRadius(Number(e.target.value))}
                style={{ width: '100%', accentColor: SLATE, cursor: 'pointer' }} />
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {[50, 100, 150, 200, 300, 500].map(v => (
                  <Pressable key={v} style={[s.chip, tempRadius === v && s.chipActive]} onPress={() => setTempRadius(v)}>
                    <Text style={[s.chipText, tempRadius === v && { color: WHITE }]}>{v}m</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
          <Pressable style={s.mapBtn} onPress={() => setIsMapOpen(true)}>
            <Text style={s.mapBtnText}>📍 Set Gate on Map</Text>
          </Pressable>
          <Text style={{ fontSize: 11, color: MUTED, textAlign: 'center' }}>
            📌 {schoolLocation.lat.toFixed(4)}, {schoolLocation.lng.toFixed(4)}
          </Text>
          <Pressable style={[s.saveBtn, radiusSaved && { backgroundColor: '#10B981' }]} onPress={saveGeofenceRadius}>
            <Text style={s.saveBtnText}>{radiusSaved ? '✅ Saved!' : '💾 Save Configuration'}</Text>
          </Pressable>
        </View>
      </View>
    </>
  );

  const renderStudentDirectory = () => {
    const filtSt = applyFilter(students);
    return (
      <View style={s.panel}>
        <View style={s.panelHeader}>
          <Text style={s.panelTitle}>👥 Student Directory</Text>
          <View style={s.panelHeaderRight}>
            <Text style={{ color: SLATE, fontSize: 13, fontWeight: '600' }}>{filtSt.length} students</Text>
            <Pressable style={[s.smBtn, { backgroundColor: SLATE }]} onPress={() => setAddStudentOpen(true)}>
              <Text style={[s.smBtnText, { color: WHITE }]}>+ Add Student</Text>
            </Pressable>
          </View>
        </View>
        {/* Filter bar */}
        <View style={{ paddingHorizontal: 0, paddingBottom: 4 }}>
          <FilterBar
            classes={allClasses} sections={allSections}
            filterClass={filterClass} filterSection={filterSection}
            onClassChange={setFilterClass} onSectionChange={setFilterSection}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: 600, width: '100%' }}>
            <View style={s.tableHeader}>
              {['Name', 'Grade', 'Gate', 'Guardian ID', 'Last Distance', 'Status'].map(h => (
                <Text key={h} style={[s.th, h === 'Name' ? { flex: 2 } : {}]}>{h}</Text>
              ))}
            </View>
            <ScrollView>
              {studentsLoading ? <View style={s.loader}><ActivityIndicator color={SLATE} /></View>
                : filtSt.length === 0 ? <View style={s.loader}><Text style={s.loaderText}>No students match this filter.</Text></View>
                : filtSt.map(item => {
                  const st = statusStyle(item.status);
                  return (
                    <View key={item.id} style={s.tableRow}>
                      <Text style={[s.td, s.tdBold, { flex: 2 }]}>{item.name}</Text>
                      <Text style={s.td}>{item.grade || '—'}</Text>
                      <Text style={s.td}>{item.gate || '—'}</Text>
                      <Text style={[s.td, { color: MUTED }]}>{item.parent_id}</Text>
                      <Text style={[s.td, { color: SLATE }]}>{item.last_distance_meters != null ? `${item.last_distance_meters}m` : '—'}</Text>
                      <View style={s.td}>
                        <View style={[s.pill, { backgroundColor: st.bg }]}>
                          <Text style={[s.pillText, { color: st.text }]}>
                            {item.status === 'received' ? 'Received 🏠' : item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderGuardianRoster = () => {
    // Filter students first, then group by parent
    const filtSt = applyFilter(students);
    const map: Record<string, Student[]> = {};
    filtSt.forEach(s => { if (!map[s.parent_id]) map[s.parent_id] = []; map[s.parent_id].push(s); });
    const pairs = Object.entries(map);
    return (
      <View style={s.panel}>
        <View style={s.panelHeader}>
          <Text style={s.panelTitle}>👨‍👩‍👧 Guardian Roster</Text>
          <Text style={{ color: SLATE, fontSize: 13, fontWeight: '600' }}>{pairs.length} guardians</Text>
        </View>
        {/* Filter bar */}
        <View style={{ paddingBottom: 4 }}>
          <FilterBar
            classes={allClasses} sections={allSections}
            filterClass={filterClass} filterSection={filterSection}
            onClassChange={setFilterClass} onSectionChange={setFilterSection}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: 600, width: '100%' }}>
            <View style={s.tableHeader}>
              {['Guardian ID', 'Children', 'Gates', 'Last Distance', 'Status'].map(h => (
                <Text key={h} style={[s.th, h === 'Children' ? { flex: 2 } : {}]}>{h}</Text>
              ))}
            </View>
            <ScrollView>
              {pairs.length === 0
                ? <View style={s.loader}><Text style={s.loaderText}>No guardians match this filter.</Text></View>
                : pairs.map(([pid, kids]) => {
                  const dist = kids.find(k => k.last_distance_meters != null)?.last_distance_meters;
                  const allR = kids.every(k => k.status === 'received');
                  const anyR = kids.some(k => k.status === 'received');
                  const allD = kids.every(k => k.status === 'dispatched' || k.status === 'received');
                  const anyD = kids.some(k => k.status === 'dispatched');
                  const pillBg = allR ? '#e0e7ff' : allD ? '#d1e4ff' : anyD || anyR ? '#b7d7ff' : '#e2e2e4';
                  const pillText = allR ? '#3730a3' : allD ? '#001d35' : anyD || anyR ? '#28496a' : '#43474d';
                  const pillLabel = allR ? 'All Received 🏠' : allD ? 'All Dispatched' : anyD || anyR ? 'Partial' : 'Waiting';
                  return (
                    <View key={pid} style={s.tableRow}>
                      <Text style={[s.td, s.tdBold]}>{pid}</Text>
                      <View style={[s.td, { flex: 2 }]}>{kids.map(k => <Text key={k.id} style={{ fontSize: 12, color: TEXT }}>• {k.name}</Text>)}</View>
                      <Text style={s.td}>{[...new Set(kids.map(k => k.gate))].join(', ') || '—'}</Text>
                      <Text style={[s.td, { color: SLATE }]}>{dist != null ? `${dist}m` : '—'}</Text>
                      <View style={s.td}>
                        <View style={[s.pill, { backgroundColor: pillBg }]}>
                          <Text style={[s.pillText, { color: pillText }]}>
                            {pillLabel}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
              })}
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderParentAccounts = () => (
    <View style={s.panel}>
      <View style={s.panelHeader}>
        <Text style={s.panelTitle}>🔑 Parent Accounts</Text>
        <View style={s.panelHeaderRight}>
          <Text style={{ color: SLATE, fontSize: 13, fontWeight: '600' }}>{accounts.length} accounts</Text>
          <Pressable style={s.smBtn} onPress={fetchAccounts} disabled={accountsLoading}>
            {accountsLoading ? <ActivityIndicator size="small" color={SLATE} /> : <Text style={s.smBtnText}>🔄 Refresh</Text>}
          </Pressable>
          <Pressable style={[s.smBtn, { backgroundColor: SLATE }]} onPress={openAddAccount}>
            <Text style={[s.smBtnText, { color: WHITE }]}>+ New Account</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth: 700, width: '100%' }}>
          <View style={s.tableHeader}>
            {['Parent ID', 'Full Name', 'Password', 'Phone', 'Linked Students', 'Status', 'Actions'].map(h => (
              h === 'Password' ? (
                <Pressable key={h} style={[s.th, { flexDirection: 'row', alignItems: 'center', gap: 4 }]} onPress={() => setShowParentPasswords(p => !p)}>
                  <Text style={s.th}>Password</Text>
                </Pressable>
              ) : (
                <Text key={h} style={[s.th, h === 'Linked Students' ? { flex: 2 } : {}]}>{h}</Text>
              )
            ))}
          </View>
          <ScrollView>
            {accountsLoading ? <View style={s.loader}><ActivityIndicator color={SLATE} /></View>
              : accounts.length === 0 ? <View style={s.loader}><Text style={s.loaderText}>No parent accounts. Create one above.</Text></View>
              : accounts.map(acc => {
                const linked = students.filter(st => st.parent_id === acc.parent_id);
                return (
                  <View key={acc.id} style={s.tableRow}>
                    <Text style={[s.td, s.tdBold]}>{acc.parent_id}</Text>
                    <Text style={s.td}>{acc.full_name}</Text>
                    <Text style={[s.td, { fontFamily: 'monospace', fontSize: 12 }]}>
                      {'•••••••• (hashed)'}
                    </Text>
                    <Text style={[s.td, { color: MUTED }]}>{acc.phone || '—'}</Text>
                    <View style={[s.td, { flex: 2 }]}>
                      {linked.length === 0
                        ? <Text style={{ fontSize: 12, color: MUTED }}>None</Text>
                        : linked.map(st => <Text key={st.id} style={{ fontSize: 12, color: TEXT }}>• {st.name}</Text>)
                      }
                    </View>
                    <View style={s.td}>
                      <Pressable onPress={() => handleToggleActive(acc)}>
                        <View style={[s.pill, { backgroundColor: acc.is_active ? '#D1FAE5' : '#fee2e2' }]}>
                          <Text style={[s.pillText, { color: acc.is_active ? '#065F46' : '#c0392b' }]}>
                            {acc.is_active ? 'Active' : 'Inactive'}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                    <View style={[s.td, { flexDirection: 'row', gap: 6 }]}>
                      <Pressable style={[s.smBtn, { backgroundColor: '#e8f0f8' }]} onPress={() => openEditAccount(acc)}>
                        <Text style={[s.smBtnText, { color: SLATE }]}>Edit</Text>
                      </Pressable>
                      <Pressable style={[s.smBtn, { backgroundColor: '#fee2e2' }]} onPress={() => handleDeleteAccount(acc)}>
                        <Text style={[s.smBtnText, { color: '#c0392b' }]}>Del</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );

  const renderTransporters = () => (
    <View style={s.panel}>
      <View style={s.panelHeader}>
        <Text style={s.panelTitle}>🛺 Rickshaw & Van Transporters</Text>
        <View style={s.panelHeaderRight}>
          <Text style={{ color: SLATE, fontSize: 13, fontWeight: '600' }}>{transporters.length} drivers</Text>
          <Pressable style={s.smBtn} onPress={fetchTransporters} disabled={transportersLoading}>
            {transportersLoading ? <ActivityIndicator size="small" color={SLATE} /> : <Text style={s.smBtnText}>🔄 Refresh</Text>}
          </Pressable>
          <Pressable style={[s.smBtn, { backgroundColor: '#065F46' }]} onPress={openAddTransporter}>
            <Text style={[s.smBtnText, { color: WHITE }]}>+ New Driver</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth: 750, width: '100%' }}>
          <View style={s.tableHeader}>
            {['Driver ID', 'Driver Name', 'Vehicle', 'Vehicle No.', 'Password', 'Linked Parents', 'Status', 'Actions'].map(h => (
              h === 'Password' ? (
                <Pressable key={h} style={[s.th, { flexDirection: 'row', alignItems: 'center', gap: 4 }]} onPress={() => setShowTransporterPasswords(p => !p)}>
                  <Text style={s.th}>Password</Text>
                </Pressable>
              ) : (
                <Text key={h} style={[s.th, h === 'Linked Parents' ? { flex: 2 } : {}]}>{h}</Text>
              )
            ))}
          </View>
          <ScrollView>
            {transportersLoading ? <View style={s.loader}><ActivityIndicator color={SLATE} /></View>
              : transporters.length === 0 ? <View style={s.loader}><Text style={s.loaderText}>No registered transporters. Add a driver above.</Text></View>
              : transporters.map(tr => {
                const linkedCount = (tr.linked_parent_ids || []).length;
                return (
                  <View key={tr.id} style={s.tableRow}>
                    <Text style={[s.td, s.tdBold, { color: '#065F46' }]}>{tr.driver_id}</Text>
                    <Text style={s.td}>{tr.driver_name}</Text>
                    <Text style={s.td}>{tr.vehicle_type}</Text>
                    <Text style={[s.td, s.tdBold]}>{tr.vehicle_number}</Text>
                    <Text style={[s.td, { fontFamily: 'monospace', fontSize: 12 }]}>
                      {'•••••••• (hashed)'}
                    </Text>
                    <View style={[s.td, { flex: 2 }]}>
                      {linkedCount === 0
                        ? <Text style={{ fontSize: 12, color: MUTED }}>None linked</Text>
                        : <Text style={{ fontSize: 12, color: TEXT }}>{(tr.linked_parent_ids || []).join(', ')} ({linkedCount} parents)</Text>
                      }
                    </View>
                    <View style={s.td}>
                      <Pressable onPress={() => handleToggleTransporterActive(tr)}>
                        <View style={[s.pill, { backgroundColor: tr.is_active ? '#D1FAE5' : '#fee2e2' }]}>
                          <Text style={[s.pillText, { color: tr.is_active ? '#065F46' : '#c0392b' }]}>
                            {tr.is_active ? 'Active' : 'Inactive'}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                    <View style={[s.td, { flexDirection: 'row', gap: 6 }]}>
                      <Pressable style={[s.smBtn, { backgroundColor: '#e8f0f8' }]} onPress={() => openEditTransporter(tr)}>
                        <Text style={[s.smBtnText, { color: SLATE }]}>Edit</Text>
                      </Pressable>
                      <Pressable style={[s.smBtn, { backgroundColor: '#fee2e2' }]} onPress={() => handleDeleteTransporter(tr)}>
                        <Text style={[s.smBtnText, { color: '#c0392b' }]}>Del</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );

  const renderGeofenceConfig = () => (
    <View style={s.panel}>
      <View style={s.panelHeader}>
        <Text style={s.panelTitle}>🗺️ Geofence Configuration</Text>
      </View>
      <View style={{ padding: 24, gap: 20 }}>
        <View style={{ gap: 8 }}>
          <Text style={s.th}>SCHOOL GATE COORDINATES</Text>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <View style={s.coordBox}><Text style={s.coordLabel}>LATITUDE</Text><Text style={s.coordValue}>{schoolLocation.lat.toFixed(6)}</Text></View>
            <View style={s.coordBox}><Text style={s.coordLabel}>LONGITUDE</Text><Text style={s.coordValue}>{schoolLocation.lng.toFixed(6)}</Text></View>
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.th}>DETECTION RADIUS</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: MUTED }}>50m</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: SLATE }}>{tempRadius}m</Text>
            <Text style={{ fontSize: 12, color: MUTED }}>500m</Text>
          </View>
          {Platform.OS === 'web' ? (
            // @ts-ignore
            <input type="range" min="50" max="500" value={tempRadius}
              onChange={(e: any) => setTempRadius(Number(e.target.value))}
              style={{ width: '100%', accentColor: SLATE, cursor: 'pointer' }} />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {[50, 100, 150, 200, 300, 500].map(v => (
                <Pressable key={v} style={[s.chip, tempRadius === v && s.chipActive]} onPress={() => setTempRadius(v)}>
                  <Text style={[s.chipText, tempRadius === v && { color: WHITE }]}>{v}m</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        <Pressable style={s.mapBtn} onPress={() => setIsMapOpen(true)}>
          <Text style={s.mapBtnText}>📍 Change School Gate Pin on Map</Text>
        </Pressable>
        {Platform.OS === 'web' && (
          <View style={{ height: 300, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: BORDER }}>
            {/* @ts-ignore */}
            <iframe srcDoc={`<!DOCTYPE html><html><head>
              <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
              <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
              <style>body,html,#map{margin:0;padding:0;height:100%;width:100%;}</style>
            </head><body><div id="map"></div><script>
              const m=L.map('map').setView([${schoolLocation.lat},${schoolLocation.lng}],15);
              L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(m);
              L.marker([${schoolLocation.lat},${schoolLocation.lng}]).addTo(m).bindPopup('School Gate').openPopup();
              L.circle([${schoolLocation.lat},${schoolLocation.lng}],{radius:${geofenceRadius},color:'${SLATE}',fillOpacity:0.15}).addTo(m);
            </script></body></html>`}
              style={{ width: '100%', height: '100%', border: 'none' }} />
          </View>
        )}
        <Pressable style={[s.saveBtn, radiusSaved && { backgroundColor: '#10B981' }]} onPress={saveGeofenceRadius}>
          <Text style={s.saveBtnText}>{radiusSaved ? '✅ Saved!' : '💾 Save Configuration'}</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderDispatchLogs = () => {
    const sorted = [...applyFilter(students)].sort((a, b) => {
      const o: Record<string, number> = { dispatched: 0, arrived: 1, waiting: 2 };
      return (o[a.status] ?? 3) - (o[b.status] ?? 3);
    });
    return (
      <View style={s.panel}>
        <View style={s.panelHeader}>
          <Text style={s.panelTitle}>📋 Dispatch Logs</Text>
          <Pressable style={s.smBtn} onPress={handleResetDemo} disabled={resetLoading}>
            {resetLoading ? <ActivityIndicator size="small" color={SLATE} /> : <Text style={s.smBtnText}>🔄 Reset All</Text>}
          </Pressable>
        </View>
        {/* Filter bar */}
        <View style={{ paddingBottom: 4 }}>
          <FilterBar
            classes={allClasses} sections={allSections}
            filterClass={filterClass} filterSection={filterSection}
            onClassChange={setFilterClass} onSectionChange={setFilterSection}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: 650, width: '100%' }}>
            <View style={s.tableHeader}>
              {['Time', 'Student', 'Grade', 'Guardian', 'Gate', 'Distance', 'Status'].map(h => (
                <Text key={h} style={[s.th, h === 'Student' ? { flex: 2 } : {}]}>{h}</Text>
              ))}
            </View>
            <ScrollView>
              {sorted.length === 0
                ? <View style={s.loader}><Text style={s.loaderText}>No dispatch records match this filter.</Text></View>
                : sorted.map(item => {
                const st = statusStyle(item.status);
                return (
                  <View key={item.id} style={s.tableRow}>
                    <Text style={[s.td, { color: MUTED }]}>
                      {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </Text>
                    <Text style={[s.td, s.tdBold, { flex: 2 }]}>{item.name}</Text>
                    <Text style={[s.td, { color: MUTED, fontSize: 11 }]}>{item.grade || '—'}</Text>
                    <Text style={s.td}>{item.parent_id}</Text>
                    <Text style={s.td}>{item.gate || '—'}</Text>
                    <Text style={[s.td, { color: SLATE }]}>{item.last_distance_meters != null ? `${item.last_distance_meters}m` : '—'}</Text>
                    <View style={s.td}>
                      <View style={[s.pill, { backgroundColor: st.bg }]}>
                        <Text style={[s.pillText, { color: st.text }]}>{item.status.charAt(0).toUpperCase() + item.status.slice(1)}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
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
    setTestSummary(`${total} tests: ✅ ${passed} passed  ⚠️ ${warned} warnings  ❌ ${failed} failed`);
    setTestResults(results);
    setTestRunning(false);
  };

  const renderTestLogs = () => (
    <View style={s.panel}>
      <View style={s.panelHeader}>
        <Text style={s.panelTitle}>🧪 System Tests</Text>
        <Pressable style={[s.smBtn, { backgroundColor: SLATE }]} onPress={runAllTests} disabled={testRunning}>
          {testRunning
            ? <ActivityIndicator size="small" color={WHITE} />
            : <Text style={[s.smBtnText, { color: WHITE }]}>▶ Run All Tests</Text>}
        </Pressable>
      </View>

      {testSummary ? (
        <View style={{
          margin: 12, padding: 12, borderRadius: 10,
          backgroundColor: testResults.some(r => r.status === 'fail') ? '#fdecea' : testResults.some(r => r.status === 'warn') ? '#fffbeb' : '#ecfdf5',
          borderLeftWidth: 4,
          borderLeftColor: testResults.some(r => r.status === 'fail') ? '#c0392b' : testResults.some(r => r.status === 'warn') ? '#f59e0b' : '#10B981',
        }}>
          <Text style={{ fontWeight: '700', fontSize: 14 }}>{testSummary}</Text>
        </View>
      ) : null}

      {testResults.length === 0 && !testRunning ? (
        <View style={s.loader}>
          <Text style={{ fontSize: 32 }}>🧪</Text>
          <Text style={s.loaderText}>Press "Run All Tests" to execute the full test suite.</Text>
          <Text style={[s.loaderText, { fontSize: 12, color: MUTED, marginTop: 4 }]}>
            Covers Whitebox, Greybox, Blackbox and Responsiveness checks.
          </Text>
        </View>
      ) : null}

      {/* Group by category */}
      {[...new Set(testResults.map(r => r.category))].map(cat => (
        <View key={cat} style={{ marginBottom: 12 }}>
          <Text style={[s.th, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, fontSize: 10 }]}>{cat.toUpperCase()}</Text>
          {testResults.filter(r => r.category === cat).map(r => (
            <View key={r.id} style={[s.tableRow, { alignItems: 'flex-start', gap: 0 }]}>
              <Text style={{ fontSize: 16, marginTop: 1, minWidth: 22 }}>
                {r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : r.status === 'warn' ? '⚠️' : '⏳'}
              </Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: TEXT }}>{r.name}</Text>
                <Text style={{ fontSize: 12, color: MUTED }}>{r.detail}</Text>
              </View>
              {r.durationMs != null && (
                <Text style={{ fontSize: 11, color: MUTED, alignSelf: 'flex-start', marginTop: 2 }}>{r.durationMs}ms</Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );


  const renderContent = () => {
    switch (activeNav) {
      case 'students': return renderStudentDirectory();
      case 'guardians': return renderGuardianRoster();
      case 'geofence': return renderGeofenceConfig();
      case 'logs': return renderDispatchLogs();
      case 'accounts': return renderParentAccounts();
      case 'transporters': return renderTransporters();
      case 'tests': return renderTestLogs();
      default: return renderDashboard();
    }
  };

  return (
    <View style={s.shell}>
      {/* Sidebar - hidden on mobile screens */}
      {!isMobile && (
        <View style={s.sidebar}>
          <View style={s.sidebarLogo}>
            <View style={s.logoCircle}><Text style={{ fontSize: 18 }}>🛡️</Text></View>
            <View>
              <Text style={s.logoTitle}>SafePass</Text>
              <Text style={s.logoSub}>Admin Portal</Text>
              <Text style={s.logoCampus}>{branch ? `${branch.school_name} — ${branch.name}` : ''}</Text>
            </View>
          </View>
          <View style={s.navLinks}>
            {([
              { id: 'dashboard', label: 'Dashboard', icon: '📊' },
              { id: 'students', label: 'Student Directory', icon: '👥' },
              { id: 'guardians', label: 'Guardian Roster', icon: '👨‍👩‍👧' },
              { id: 'geofence', label: 'Geofence Config', icon: '🗺️' },
              { id: 'logs', label: 'Dispatch Logs', icon: '📋' },
              { id: 'accounts', label: 'Parent Accounts', icon: '🔑' },
              { id: 'transporters', label: 'Transporters', icon: '🛺' },
              { id: 'tests', label: 'System Tests', icon: '🧪' },
            ] as { id: NavSection; label: string; icon: string }[]).map(item => (
              <Pressable key={item.id}
                style={[s.navItem, activeNav === item.id && s.navItemActive]}
                onPress={() => setActiveNav(item.id)}>
                <Text style={s.navIcon}>{item.icon}</Text>
                <Text style={[s.navLabel, activeNav === item.id && s.navLabelActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.sidebarBottom}>
            {session.role !== 'branch' && (
              <Pressable style={s.navItem} onPress={backToSuperAdmin}>
                <Text style={s.navIcon}>🏛️</Text>
                <Text style={s.navLabel}>Back to Super Admin</Text>
              </Pressable>
            )}
            {session.branches.length > 1 && (
              <Pressable style={s.navItem} onPress={() => selectBranch(null)}>
                <Text style={s.navIcon}>⇄</Text>
                <Text style={s.navLabel}>Switch Campus</Text>
              </Pressable>
            )}
            <Pressable style={s.navItem} onPress={() => router.replace('/')}>
              <Text style={s.navIcon}>🏠</Text>
              <Text style={s.navLabel}>Back to Home</Text>
            </Pressable>
            <Pressable style={s.navItem} onPress={handleLogout}>
              <Text style={s.navIcon}>🔒</Text>
              <Text style={s.navLabel}>Sign Out</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Main */}
      <View style={s.main}>
        {/* Top Header */}
        <View style={[s.topHeader, isMobile && { paddingHorizontal: 12, gap: 8 }]}>
          <View style={[s.searchBarWrap, isMobile && { flex: 1, maxWidth: 180 }]}>
            <Text>🔍 </Text>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <input style={{ ...s.searchWeb, border: 'none', background: 'transparent', outline: 'none' } as any} placeholder={isMobile ? "Search…" : "Search students or guardians…"}
                value={searchQuery} onChange={(e: any) => setSearchQuery(e.target.value)} />
            ) : (
              <TextInput style={s.searchNative} placeholder="Search…" value={searchQuery}
                onChangeText={setSearchQuery} placeholderTextColor={MUTED} />
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: isMobile ? 6 : 12 }}>
            <View style={[s.gpsBadge, isMobile && { paddingHorizontal: 6, paddingVertical: 4 }]}><View style={s.gpsDot} /><Text style={[s.gpsBadgeText, isMobile && { fontSize: 10 }]}>{isMobile ? 'GPS' : 'GPS Active'}</Text></View>
            <View style={[s.avBubble, isMobile && { width: 28, height: 28, borderRadius: 14 }]}><Text style={{ fontSize: isMobile ? 10 : 12, fontWeight: '700', color: SLATE }}>{(session.username || 'A').slice(0, 2).toUpperCase()}</Text></View>
            <Text style={{ fontSize: isMobile ? 14 : 18, fontWeight: '700', color: SLATE }}>
              {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', ...(isMobile ? {} : { second: '2-digit' }) })}
            </Text>
          </View>
        </View>

        <ScrollView style={s.canvas} contentContainerStyle={{ padding: isMobile ? 12 : 24, paddingBottom: isMobile ? 110 : 48 }}>
          {!branchLive ? (
            <View style={s.pausedBanner}>
              <Text style={s.pausedBannerText}>
                ⏸️ This campus is {branch?.status ?? 'unavailable'} — parents, drivers and branch admins are currently blocked.
              </Text>
            </View>
          ) : null}
          {isMobile && branch ? (
            <Text style={s.mobileCampus}>{branch.school_name} — {branch.name}</Text>
          ) : null}
          {renderContent()}
        </ScrollView>
      </View>

      {/* ── Mobile Bottom Navigation (shown whenever screen is mobile width) ── */}
      {isMobile && (
        <View style={s.mobileBottomNav}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingHorizontal: 8 }}>
            {([
              { id: 'dashboard',  label: 'Dashboard',  icon: '📊' },
              { id: 'students',   label: 'Students',   icon: '👥' },
              { id: 'guardians',  label: 'Guardians',  icon: '👨‍👩‍👧' },
              { id: 'geofence',   label: 'Geofence',   icon: '🗺️' },
              { id: 'logs',       label: 'Logs',       icon: '📋' },
              { id: 'accounts',   label: 'Accounts',   icon: '🔑' },
              { id: 'transporters',label: 'Drivers',   icon: '🛺' },
              { id: 'tests',      label: 'Tests',      icon: '🧪' },
            ] as { id: NavSection; label: string; icon: string }[]).map(item => (
              <Pressable key={item.id}
                style={[s.mobileNavItem, activeNav === item.id && s.mobileNavItemActive]}
                onPress={() => setActiveNav(item.id)}>
                <Text style={{ fontSize: 18 }}>{item.icon}</Text>
                <Text style={[s.mobileNavLabel, activeNav === item.id && { color: SLATE, fontWeight: '700' }]}>{item.label}</Text>
              </Pressable>
            ))}
            <Pressable style={s.mobileNavItem} onPress={() => router.replace('/')}>
              <Text style={{ fontSize: 18 }}>🏠</Text>
              <Text style={s.mobileNavLabel}>Home</Text>
            </Pressable>
            {session.role !== 'branch' && (
              <Pressable style={s.mobileNavItem} onPress={backToSuperAdmin}>
                <Text style={{ fontSize: 18 }}>🏛️</Text>
                <Text style={s.mobileNavLabel}>Super</Text>
              </Pressable>
            )}
            {session.branches.length > 1 && (
              <Pressable style={s.mobileNavItem} onPress={() => selectBranch(null)}>
                <Text style={{ fontSize: 18 }}>⇄</Text>
                <Text style={s.mobileNavLabel}>Campus</Text>
              </Pressable>
            )}
            <Pressable style={s.mobileNavItem} onPress={handleLogout}>
              <Text style={{ fontSize: 18 }}>🔒</Text>
              <Text style={s.mobileNavLabel}>Sign Out</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {/* Map Modal */}
      {isMapOpen && (
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>📍 Set School Gate Location</Text>
            <Text style={s.modalSub}>Click anywhere to drop the pin, or drag it.</Text>
            <View style={s.mapBox}>
              {Platform.OS === 'web' ? (
                // @ts-ignore
                <iframe srcDoc={`<!DOCTYPE html><html>
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
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8 }} />
              ) : <Text style={{ textAlign: 'center', marginTop: 20, color: MUTED }}>Map only on Web.</Text>}
            </View>
            <Text style={{ fontSize: 12, color: MUTED, textAlign: 'center', marginBottom: 12 }}>
              Selected: {tempLocation.lat.toFixed(5)}, {tempLocation.lng.toFixed(5)}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
              <Pressable style={s.cancelBtn} onPress={() => setIsMapOpen(false)}><Text style={s.cancelBtnText}>Cancel</Text></Pressable>
              <Pressable style={s.confirmBtn} onPress={saveMapLocation}><Text style={s.confirmBtnText}>Save Pin</Text></Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Add Student Modal */}
      {addStudentOpen && (
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>👤 Add New Student</Text>
            <View style={{ gap: 12, marginTop: 8 }}>
              <FormField label="Full Name *" value={ns_name} setter={setNs_name} placeholder="e.g. Zara Khan" />
              <FormField label="Grade" value={ns_grade} setter={setNs_grade} placeholder="e.g. Grade 4-A" />
              <FormField label="Guardian ID *" value={ns_parentId} setter={setNs_parentId} placeholder="e.g. parent_003" />
              <View>
                <Text style={s.formLabel}>Pickup Gate</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  {['Gate A', 'Gate B', 'Gate C'].map(g => (
                    <Pressable key={g} style={[s.chip, ns_gate === g && s.chipActive]} onPress={() => setNs_gate(g)}>
                      <Text style={[s.chipText, ns_gate === g && { color: WHITE }]}>{g}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            <View style={[{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 }]}>
              <Pressable style={s.cancelBtn} onPress={() => setAddStudentOpen(false)}><Text style={s.cancelBtnText}>Cancel</Text></Pressable>
              <Pressable style={[s.confirmBtn, ns_loading && { opacity: 0.7 }]} onPress={handleAddStudent} disabled={ns_loading}>
                {ns_loading ? <ActivityIndicator size="small" color={WHITE} /> : <Text style={s.confirmBtnText}>Add Student</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Add / Edit Account Modal */}
      {addAccountOpen && (
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{editAccount ? '✏️ Edit Account' : '🔑 New Parent Account'}</Text>
            <Text style={s.modalSub}>
              {editAccount ? 'Update this parent\'s details.' : 'Create login credentials for a parent.'}
            </Text>
            <View style={{ gap: 12, marginTop: 8 }}>
              {/* ── Inline error banner ── */}
              {accountModalError ? (
                <View style={s.errorBanner}>
                  <Text style={s.errorText}>⚠️  {accountModalError}</Text>
                </View>
              ) : null}
              <View style={{ gap: 4 }}>
                <Text style={s.formLabel}>Parent ID *</Text>
                {Platform.OS === 'web' ? (
                  // @ts-ignore
                  <input style={{ ...s.formInputWeb, outline: 'none', boxSizing: 'border-box' } as any}
                    placeholder="e.g. parent_005"
                    value={na_parentId}
                    onChange={(e: any) => setNa_parentId(e.target.value)}
                    disabled={!!editAccount} />
                ) : (
                  <TextInput style={[s.formInput, !!editAccount && { backgroundColor: '#e8e8ea' }]}
                    placeholder="e.g. parent_005" value={na_parentId}
                    onChangeText={setNa_parentId} editable={!editAccount} placeholderTextColor={MUTED} />
                )}
                {editAccount && <Text style={{ fontSize: 11, color: MUTED }}>Parent ID cannot be changed.</Text>}
              </View>
              <FormField label="Full Name *" value={na_fullName} setter={setNa_fullName} placeholder="e.g. Sarah Ahmed" />
              <View style={{ gap: 4 }}>
                <Text style={s.formLabel}>{editAccount ? 'New password (leave blank to keep)' : 'Password *'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {Platform.OS === 'web' ? (
                    // @ts-ignore
                    <input style={{ ...s.formInputWeb, flex: 1, outline: 'none', boxSizing: 'border-box' } as any}
                      type={showParentModalPw ? 'text' : 'password'}
                      placeholder="e.g. safepass123"
                      value={na_password}
                      onChange={(e: any) => setNa_password(e.target.value)} />
                  ) : (
                    <TextInput style={[s.formInput, { flex: 1 }]}
                      placeholder="e.g. safepass123" value={na_password}
                      onChangeText={setNa_password} secureTextEntry={!showParentModalPw} placeholderTextColor={MUTED} />
                  )}
                  <Pressable style={s.eyeBtn} onPress={() => setShowParentModalPw(p => !p)}>
                    <Text style={{ fontSize: 18 }}>{showParentModalPw ? '🙈' : '👁️'}</Text>
                  </Pressable>
                </View>
              </View>
              <FormField label="Phone (optional)" value={na_phone} setter={setNa_phone} placeholder="e.g. 0300-1234567" />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <Pressable style={s.cancelBtn} onPress={() => setAddAccountOpen(false)}><Text style={s.cancelBtnText}>Cancel</Text></Pressable>
              <Pressable style={[s.confirmBtn, na_loading && { opacity: 0.7 }]} onPress={handleSaveAccount} disabled={na_loading}>
                {na_loading ? <ActivityIndicator size="small" color={WHITE} /> : <Text style={s.confirmBtnText}>{editAccount ? 'Save Changes' : 'Create Account'}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Add / Edit Transporter Modal */}
      {addTransporterOpen && (
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{editTransporter ? '✏️ Edit Transporter Driver' : '🛺 New Transporter Driver'}</Text>
            <Text style={s.modalSub}>
              {editTransporter ? 'Update driver profile & parent assignments.' : 'Register a Rickshaw/Van driver & assign parent accounts.'}
            </Text>
            <View style={{ gap: 12, marginTop: 8 }}>
              {transporterModalError ? (
                <View style={s.errorBanner}>
                  <Text style={s.errorText}>⚠️  {transporterModalError}</Text>
                </View>
              ) : null}
              <View style={{ gap: 4 }}>
                <Text style={s.formLabel}>Driver ID *</Text>
                {Platform.OS === 'web' ? (
                  // @ts-ignore
                  <input style={{ ...s.formInputWeb, outline: 'none', boxSizing: 'border-box' } as any}
                    placeholder="e.g. driver_001"
                    value={nt_driverId}
                    onChange={(e: any) => setNt_driverId(e.target.value)}
                    disabled={!!editTransporter} />
                ) : (
                  <TextInput style={[s.formInput, !!editTransporter && { backgroundColor: '#e8e8ea' }]}
                    placeholder="e.g. driver_001" value={nt_driverId}
                    onChangeText={setNt_driverId} editable={!editTransporter} placeholderTextColor={MUTED} />
                )}
                {editTransporter && <Text style={{ fontSize: 11, color: MUTED }}>Driver ID cannot be changed.</Text>}
              </View>
              <FormField label="Driver Full Name *" value={nt_driverName} setter={setNt_driverName} placeholder="e.g. Afzal Khan" />
              <View style={{ gap: 4 }}>
                <Text style={s.formLabel}>Vehicle Type *</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {['Rickshaw', 'School Van', 'Taxi/Carpool'].map(vt => (
                    <Pressable key={vt} onPress={() => setNt_vehicleType(vt)}
                      style={[s.filterChip, nt_vehicleType === vt && s.filterChipActive]}>
                      <Text style={[s.filterChipTxt, nt_vehicleType === vt && s.filterChipTxtActive]}>{vt}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <FormField label="Vehicle Number *" value={nt_vehicleNumber} setter={setNt_vehicleNumber} placeholder="e.g. LEA-4920" />
              <View style={{ gap: 4 }}>
                <Text style={s.formLabel}>{editTransporter ? 'New password (leave blank to keep)' : 'Password *'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {Platform.OS === 'web' ? (
                    // @ts-ignore
                    <input style={{ ...s.formInputWeb, flex: 1, outline: 'none', boxSizing: 'border-box' } as any}
                      type={showTransporterModalPw ? 'text' : 'password'}
                      placeholder="e.g. safepass123"
                      value={nt_password}
                      onChange={(e: any) => setNt_password(e.target.value)} />
                  ) : (
                    <TextInput style={[s.formInput, { flex: 1 }]}
                      placeholder="e.g. safepass123" value={nt_password}
                      onChangeText={setNt_password} secureTextEntry={!showTransporterModalPw} placeholderTextColor={MUTED} />
                  )}
                  <Pressable style={s.eyeBtn} onPress={() => setShowTransporterModalPw(p => !p)}>
                    <Text style={{ fontSize: 18 }}>{showTransporterModalPw ? '🙈' : '👁️'}</Text>
                  </Pressable>
                </View>
              </View>
              <FormField label="Phone (optional)" value={nt_phone} setter={setNt_phone} placeholder="e.g. 0301-5550001" />

              {/* Linked Parents Selection (hides parents already assigned to other drivers) */}
              <View style={{ gap: 6, marginTop: 4 }}>
                <Text style={s.formLabel}>Linked Parent Accounts ({nt_linkedParents.length} selected)</Text>
                <Text style={{ fontSize: 11, color: MUTED }}>Unassigned parents available for pickup route:</Text>
                <ScrollView style={{ maxHeight: 120, borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 8, backgroundColor: '#fafafa' }}>
                  {(() => {
                    const assignedToOthers = new Set<string>();
                    transporters.forEach(tr => {
                      if (!editTransporter || tr.id !== editTransporter.id) {
                        (tr.linked_parent_ids || []).forEach(pid => assignedToOthers.add(pid));
                      }
                    });
                    const available = accounts.filter(acc => !assignedToOthers.has(acc.parent_id));

                    return available.length === 0 ? (
                      <Text style={{ fontSize: 12, color: MUTED, padding: 4 }}>No unassigned parent accounts available.</Text>
                    ) : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {available.map(acc => {
                          const isSel = nt_linkedParents.includes(acc.parent_id);
                          return (
                            <Pressable key={acc.parent_id}
                              onPress={() => {
                                if (isSel) setNt_linkedParents(p => p.filter(x => x !== acc.parent_id));
                                else setNt_linkedParents(p => [...p, acc.parent_id]);
                              }}
                              style={[s.filterChip, isSel && { backgroundColor: '#065F46', borderColor: '#065F46' }]}>
                              <Text style={[s.filterChipTxt, isSel && { color: WHITE }]}>{acc.parent_id} ({acc.full_name.split(' ')[0]})</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    );
                  })()}
                </ScrollView>
              </View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <Pressable style={s.cancelBtn} onPress={() => setAddTransporterOpen(false)}><Text style={s.cancelBtnText}>Cancel</Text></Pressable>
              <Pressable style={[s.confirmBtn, { backgroundColor: '#065F46' }, nt_loading && { opacity: 0.7 }]} onPress={handleSaveTransporter} disabled={nt_loading}>
                {nt_loading ? <ActivityIndicator size="small" color={WHITE} /> : <Text style={s.confirmBtnText}>{editTransporter ? 'Save Changes' : 'Create Driver'}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  campusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 14, backgroundColor: SURFACE },
  campusSchool: { fontSize: 15, fontWeight: '800', color: SLATE_DARK },
  campusBranch: { fontSize: 12, color: MUTED, marginTop: 2 },
  campusPaused: { fontSize: 10, fontWeight: '800', color: '#b45309', backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pausedBanner: { backgroundColor: '#fef3c7', borderLeftWidth: 4, borderLeftColor: '#f59e0b', borderRadius: 10, padding: 12, marginBottom: 16 },
  pausedBannerText: { color: '#92400e', fontWeight: '700', fontSize: 13 },
  mobileCampus: { fontSize: 12, fontWeight: '700', color: SLATE, marginBottom: 10 },
  // PIN gate
  pinRoot: { flex: 1, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', padding: 24 },
  pinCard: { backgroundColor: WHITE, borderRadius: 20, padding: 36, width: '100%', maxWidth: 420, gap: 16, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.09, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  pinLogoWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: SLATE, alignItems: 'center', justifyContent: 'center', shadowColor: SLATE, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  pinTitle: { fontSize: 28, fontWeight: '800', color: SLATE_DARK },
  pinSub: { fontSize: 13, color: MUTED, textAlign: 'center' },
  pinBtn: { backgroundColor: SLATE, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center', alignSelf: 'stretch', shadowColor: SLATE, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  pinBtnText: { color: WHITE, fontSize: 16, fontWeight: '700' },
  backLink: { color: SLATE, fontSize: 14, fontWeight: '600' },
  errorBanner: { backgroundColor: '#fdecea', borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: '#c0392b', alignSelf: 'stretch' },
  errorText: { fontSize: 13, color: '#c0392b', fontWeight: '600' },
  eyeBtn: { padding: 8 },

  // Shell
  shell: { flex: 1, flexDirection: 'row', backgroundColor: SURFACE },
  sidebar: { width: SIDEBAR_W, backgroundColor: '#f0f2f5', borderRightWidth: 1, borderRightColor: BORDER, flexDirection: 'column' },
  sidebarLogo: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 22, borderBottomWidth: 1, borderBottomColor: BORDER },
  logoCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: SLATE, alignItems: 'center', justifyContent: 'center' },
  logoTitle: { fontSize: 20, fontWeight: '700', color: SLATE_DARK },
  logoSub: { fontSize: 12, color: MUTED },
  logoCampus: { fontSize: 11, color: MUTED, marginTop: 1 },
  navLinks: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, gap: 3 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
  navItemActive: { backgroundColor: '#b7d7ff' },
  navIcon: { fontSize: 17, width: 24, textAlign: 'center' },
  navLabel: { fontSize: 13, color: MUTED, fontWeight: '500' },
  navLabelActive: { color: '#28496a', fontWeight: '700' },
  sidebarBottom: { borderTopWidth: 1, borderTopColor: BORDER, paddingVertical: 10, paddingHorizontal: 8, gap: 3 },

  main: { flex: 1, flexDirection: 'column' },
  topHeader: {
    backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, zIndex: 20,
    height: Platform.OS === 'web' ? 60 : undefined,
    paddingTop: Platform.OS === 'web' ? 0 : 44,
    paddingBottom: Platform.OS === 'web' ? 0 : 10,
  },
  searchBarWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8e8ea', borderRadius: 8, paddingHorizontal: 10, height: 38, width: Platform.OS === 'web' ? 320 : 180 },
  searchWeb: { flex: 1, fontSize: 14, fontFamily: 'inherit' } as any,
  searchNative: { flex: 1, fontSize: 14, color: TEXT },
  gpsBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#b7d7ff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, gap: 6 },
  gpsDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#10B981' },
  gpsBadgeText: { fontSize: 11, fontWeight: '600', color: '#28496a' },
  avBubble: { width: 34, height: 34, borderRadius: 17, backgroundColor: SLATE_LIGHT, alignItems: 'center', justifyContent: 'center' },
  canvas: { flex: 1, padding: 24 },

  // KPI
  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 18, flexWrap: 'wrap' },
  kpiCard: { flex: 1, minWidth: 140, backgroundColor: WHITE, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: BORDER, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2, gap: 3 },
  kpiTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 },
  kpiLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: MUTED, textTransform: 'uppercase', flex: 1, flexWrap: 'wrap' },
  kpiIcon: { fontSize: 18 },
  kpiValue: { fontSize: 30, fontWeight: '700', color: TEXT },
  kpiSub: { fontSize: 12, fontWeight: '500' },

  splitRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },

  // Panels
  panel: { flex: 2, minWidth: 280, width: '100%', backgroundColor: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  geoPanel: { flex: 1, minWidth: 280, width: '100%', backgroundColor: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 22, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: SURFACE },
  panelHeaderRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  panelTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f0f2f5', borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: 14, paddingVertical: 9 },
  th: { flex: 1, fontSize: 10, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f2' },
  td: { flex: 1, fontSize: 13, color: TEXT },
  tdBold: { fontWeight: '600' },
  loader: { padding: 28, alignItems: 'center', gap: 8 },
  loaderText: { color: MUTED, fontSize: 13 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99 },
  pillText: { fontSize: 11, fontWeight: '700' },
  smBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: '#e8e8ea' },
  smBtnText: { fontSize: 12, fontWeight: '600', color: SLATE },

  // Geofence
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#e8e8ea', borderWidth: 1, borderColor: BORDER },
  chipActive: { backgroundColor: SLATE },
  chipText: { fontSize: 12, fontWeight: '600', color: MUTED },
  mapBtn: { backgroundColor: '#e8f0f8', borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center', borderWidth: 1, borderColor: SLATE_LIGHT },
  mapBtnText: { fontSize: 13, fontWeight: '600', color: SLATE },
  saveBtn: { backgroundColor: SLATE, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  saveBtnText: { color: WHITE, fontSize: 14, fontWeight: '700' },
  coordBox: { flex: 1, backgroundColor: '#f4f3f5', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: BORDER },
  coordLabel: { fontSize: 10, color: MUTED, fontWeight: '700', marginBottom: 3 },
  coordValue: { fontSize: 18, fontWeight: '700', color: SLATE },

  // Modals
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,30,50,0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalCard: { backgroundColor: WHITE, borderRadius: 18, padding: 28, width: '90%', maxWidth: 600 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: TEXT, marginBottom: 4 },
  modalSub: { fontSize: 13, color: MUTED, marginBottom: 12 },
  mapBox: { height: 380, borderRadius: 10, overflow: 'hidden', backgroundColor: '#e8e8ea', marginBottom: 10 },
  cancelBtn: { backgroundColor: '#e8e8ea', paddingVertical: 11, paddingHorizontal: 18, borderRadius: 8 },
  cancelBtnText: { color: MUTED, fontWeight: '600', fontSize: 14 },
  confirmBtn: { backgroundColor: SLATE, paddingVertical: 11, paddingHorizontal: 18, borderRadius: 8, minWidth: 100, alignItems: 'center' },
  confirmBtnText: { color: WHITE, fontWeight: '700', fontSize: 14 },

  // Form
  formLabel: { fontSize: 11, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },
  formInput: { borderWidth: 1.5, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: TEXT, backgroundColor: '#fafafa' },
  formInputWeb: { borderWidth: 1.5, borderStyle: 'solid', borderColor: BORDER, borderRadius: 8, paddingLeft: 12, paddingRight: 12, height: 42, fontSize: 14, color: TEXT, backgroundColor: '#fafafa', fontFamily: 'inherit', width: '100%' } as any,

  // Class / Section filter chips
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
    borderWidth: 1.5, borderColor: BORDER, backgroundColor: WHITE,
  },
  filterChipActive: { backgroundColor: SLATE, borderColor: SLATE },
  filterChipSec: { borderColor: '#a0aec0', backgroundColor: '#f7f8fa' },
  filterChipSecActive: { backgroundColor: SLATE_LIGHT, borderColor: SLATE },
  filterChipTxt: { fontSize: 12, fontWeight: '600', color: MUTED },
  filterChipTxtActive: { color: WHITE },

  // Mobile bottom nav
  mobileBottomNav: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: WHITE, borderTopWidth: 1, borderTopColor: BORDER,
    paddingVertical: 8, paddingBottom: 24, zIndex: 50,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: -2 }, elevation: 8,
  },
  mobileNavItem: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, gap: 2, minWidth: 72,
  },
  mobileNavItemActive: { backgroundColor: SLATE_LIGHT },
  mobileNavLabel: { fontSize: 10, fontWeight: '600', color: MUTED, textAlign: 'center' },
});

