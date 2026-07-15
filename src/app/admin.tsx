import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator, Alert, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { supabase } from '../../supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
type NavSection = 'dashboard' | 'students' | 'guardians' | 'geofence' | 'logs' | 'accounts';

interface Student {
  id: string; name: string; grade?: string; gate?: string;
  parent_id: string; status: 'waiting' | 'dispatched' | 'arrived';
  last_distance_meters?: number | null;
}

interface ParentAccount {
  id: string; parent_id: string; full_name: string;
  password: string; phone?: string; is_active: boolean; created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const ADMIN_PIN = 'safepass2025';
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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminPortal() {
  const router = useRouter();

  // ── PIN gate ──
  const [pinAuthed, setPinAuthed] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [showPin, setShowPin] = useState(false);

  // ── App state ──
  const [students, setStudents] = useState<Student[]>([]);
  const [accounts, setAccounts] = useState<ParentAccount[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');

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

  // ─── PIN Login ─────────────────────────────────────────────────────────────
  const handlePinLogin = () => {
    if (pinInput.trim() === ADMIN_PIN) {
      setPinAuthed(true);
      initData();
    } else {
      setPinError('Incorrect PIN. Please try again.');
      setPinInput('');
    }
  };

  // ─── Data Init ────────────────────────────────────────────────────────────
  const initData = () => {
    fetchStudents();
    fetchAccounts();
    fetchSettings();

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    const studentSub = supabase.channel('admin_students')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, fetchStudents)
      .subscribe();

    const accountSub = supabase.channel('admin_accounts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parent_accounts' }, fetchAccounts)
      .subscribe();

    const settingsSub = supabase.channel('admin_settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'school_settings' }, (p) => {
        const row = p.new as any;
        if (!row?.lat) return;
        setSchoolLocation({ lat: row.lat, lng: row.lng });
        setTempLocation({ lat: row.lat, lng: row.lng });
        if (row.geofence_radius) { setGeofenceRadius(row.geofence_radius); setTempRadius(row.geofence_radius); }
      })
      .subscribe();

    if (Platform.OS === 'web') {
      window.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.type === 'UPDATE_LOCATION')
          setTempLocation({ lat: e.data.lat, lng: e.data.lng });
      });
    }

    return () => {
      clearInterval(timer);
      supabase.removeChannel(studentSub);
      supabase.removeChannel(accountSub);
      supabase.removeChannel(settingsSub);
    };
  };

  const fetchStudents = async () => {
    try {
      const { data, error } = await supabase.from('students').select('*').order('status');
      if (error) throw error;
      setStudents((data as Student[]) || []);
    } catch (e: any) { console.error('[fetchStudents]', e.message); }
    finally { setStudentsLoading(false); }
  };

  const fetchAccounts = async () => {
    try {
      const { data, error } = await supabase.from('parent_accounts').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setAccounts((data as ParentAccount[]) || []);
    } catch (e: any) { console.error('[fetchAccounts]', e.message); }
    finally { setAccountsLoading(false); }
  };

  const fetchSettings = async () => {
    try {
      const { data } = await supabase.from('school_settings').select('*').eq('id', 'primary').single();
      if (data) {
        setSchoolLocation({ lat: data.lat, lng: data.lng });
        setTempLocation({ lat: data.lat, lng: data.lng });
        if (data.geofence_radius) { setGeofenceRadius(data.geofence_radius); setTempRadius(data.geofence_radius); }
      }
    } catch (e: any) { console.error('[fetchSettings]', e.message); }
  };

  // ─── Admin Handlers ───────────────────────────────────────────────────────
  const handleResetDemo = async () => {
    setResetLoading(true);
    try {
      const { data: all, error: fe } = await supabase.from('students').select('id');
      if (fe) throw fe;
      if (!all?.length) return;
      const { error: ue } = await supabase.from('students')
        .update({ status: 'waiting', last_distance_meters: null })
        .in('id', all.map((r: any) => r.id));
      if (ue) throw ue;
    } catch (e: any) { Alert.alert('Reset failed', e.message); }
    finally { setResetLoading(false); }
  };

  const handleDispatch = async (id: string) => {
    const { error } = await supabase.from('students').update({ status: 'dispatched' }).eq('id', id);
    if (error) Alert.alert('Error', error.message);
  };

  const saveMapLocation = async () => {
    const { error } = await supabase.from('school_settings').upsert({ id: 'primary', lat: tempLocation.lat, lng: tempLocation.lng });
    if (error) { Alert.alert('Error', error.message); return; }
    setSchoolLocation(tempLocation);
    setIsMapOpen(false);
  };

  const saveGeofenceRadius = async () => {
    const { error } = await supabase.from('school_settings').upsert({ id: 'primary', lat: schoolLocation.lat, lng: schoolLocation.lng, geofence_radius: tempRadius });
    if (error) { Alert.alert('Error', error.message); return; }
    setGeofenceRadius(tempRadius);
    setRadiusSaved(true);
    setTimeout(() => setRadiusSaved(false), 2000);
  };

  // ─── Add Student ──────────────────────────────────────────────────────────
  const handleAddStudent = async () => {
    if (!ns_name.trim() || !ns_parentId.trim()) {
      Alert.alert('Validation', 'Name and Guardian ID are required.'); return;
    }
    setNs_loading(true);
    try {
      const { error } = await supabase.from('students').insert({
        name: ns_name.trim(), grade: ns_grade.trim() || null,
        gate: ns_gate, parent_id: ns_parentId.trim().toLowerCase(),
        status: 'waiting', last_distance_meters: null,
      });
      if (error) throw error;
      setAddStudentOpen(false); setNs_name(''); setNs_grade(''); setNs_parentId('');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setNs_loading(false); }
  };

  // ─── Parent Account CRUD ──────────────────────────────────────────────────
  const openAddAccount = () => {
    setEditAccount(null);
    setNa_parentId(''); setNa_fullName(''); setNa_password('safepass123'); setNa_phone('');
    setAddAccountOpen(true);
  };

  const openEditAccount = (acc: ParentAccount) => {
    setEditAccount(acc);
    setNa_parentId(acc.parent_id); setNa_fullName(acc.full_name);
    setNa_password(acc.password); setNa_phone(acc.phone || '');
    setAddAccountOpen(true);
  };

  const handleSaveAccount = async () => {
    if (!na_parentId.trim() || !na_fullName.trim() || !na_password.trim()) {
      Alert.alert('Validation', 'Parent ID, Full Name, and Password are required.'); return;
    }
    setNa_loading(true);
    try {
      if (editAccount) {
        // Update existing
        const { error } = await supabase.from('parent_accounts')
          .update({ full_name: na_fullName.trim(), password: na_password.trim(), phone: na_phone.trim() || null })
          .eq('id', editAccount.id);
        if (error) throw error;
      } else {
        // Create new
        const trimId = na_parentId.trim().toLowerCase();
        const { error } = await supabase.from('parent_accounts').insert({
          parent_id: trimId, full_name: na_fullName.trim(),
          password: na_password.trim(), phone: na_phone.trim() || null, is_active: true,
        });
        if (error) throw error;
      }
      setAddAccountOpen(false);
    } catch (e: any) { Alert.alert('Error saving account', e.message); }
    finally { setNa_loading(false); }
  };

  const handleToggleActive = async (acc: ParentAccount) => {
    const { error } = await supabase.from('parent_accounts')
      .update({ is_active: !acc.is_active }).eq('id', acc.id);
    if (error) Alert.alert('Error', error.message);
  };

  const handleDeleteAccount = (acc: ParentAccount) => {
    Alert.alert(
      'Delete Account',
      `Delete ${acc.full_name}'s account? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('parent_accounts').delete().eq('id', acc.id);
            if (error) Alert.alert('Error', error.message);
          },
        },
      ]
    );
  };

  // ─── Status style ─────────────────────────────────────────────────────────
  const statusStyle = (s: string) => {
    if (s === 'dispatched') return { bg: '#d1e4ff', text: '#001d35' };
    if (s === 'arrived') return { bg: '#b7d7ff', text: '#28496a' };
    return { bg: '#e2e2e4', text: '#43474d' };
  };

  // ─── PIN Gate ─────────────────────────────────────────────────────────────
  if (!pinAuthed) {
    return (
      <View style={s.pinRoot}>
        <View style={s.pinCard}>
          <View style={s.pinLogoWrap}>
            <Text style={{ fontSize: 36 }}>🛡️</Text>
          </View>
          <Text style={s.pinTitle}>Admin Portal</Text>
          <Text style={s.pinSub}>Enter your admin PIN to continue</Text>

          {pinError ? <View style={s.errorBanner}><Text style={s.errorText}>⚠️ {pinError}</Text></View> : null}

          <View style={{ gap: 4, alignSelf: 'stretch' }}>
            <Text style={s.formLabel}>Admin PIN</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {Platform.OS === 'web' ? (
                // @ts-ignore
                <input
                  style={{ ...s.formInputWeb, flex: 1, outline: 'none', boxSizing: 'border-box' } as any}
                  type={showPin ? 'text' : 'password'}
                  placeholder="Enter PIN"
                  value={pinInput}
                  onChange={(e: any) => setPinInput(e.target.value)}
                  onKeyDown={(e: any) => e.key === 'Enter' && handlePinLogin()}
                />
              ) : (
                <TextInput style={[s.formInput, { flex: 1 }]}
                  placeholder="Enter PIN" value={pinInput}
                  onChangeText={setPinInput} secureTextEntry={!showPin}
                  placeholderTextColor={MUTED} />
              )}
              <Pressable style={s.eyeBtn} onPress={() => setShowPin(p => !p)}>
                <Text style={{ fontSize: 18 }}>{showPin ? '🙈' : '👁️'}</Text>
              </Pressable>
            </View>
          </View>

          <Pressable style={s.pinBtn} onPress={handlePinLogin}>
            <Text style={s.pinBtnText}>Enter Portal →</Text>
          </Pressable>

          <Pressable onPress={() => router.replace('/')}>
            <Text style={s.backLink}>← Back to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── ADMIN PORTAL ─────────────────────────────────────────────────────────
  const dispatchedCount = students.filter(x => x.status === 'dispatched').length;
  const filtered = students.filter(x =>
    !searchQuery ||
    x.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    x.parent_id?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderDashboard = () => (
    <>
      {/* KPI Row */}
      <View style={s.kpiRow}>
        {[
          { label: 'TOTAL STUDENTS', value: studentsLoading ? '…' : String(students.length), sub: 'Enrolled', icon: '👥', subColor: SLATE },
          { label: 'ACTIVE DISMISSALS', value: String(dispatchedCount), sub: 'In progress', icon: '🚶', subColor: SLATE },
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
          <View style={s.tableHeader}>
            {['Time', 'Student', 'Guardian', 'Gate', 'Distance', 'Status'].map(h => (
              <Text key={h} style={[s.th, h === 'Student' ? { flex: 2 } : {}]}>{h}</Text>
            ))}
          </View>
          {studentsLoading ? (
            <View style={s.loader}><ActivityIndicator color={SLATE} /><Text style={s.loaderText}>Loading…</Text></View>
          ) : filtered.length === 0 ? (
            <View style={s.loader}><Text style={s.loaderText}>No students yet. Add via Student Directory.</Text></View>
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
                    <Text style={[s.pillText, { color: st.text }]}>{item.status.charAt(0).toUpperCase() + item.status.slice(1)}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
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
    const filtSt = students.filter(x =>
      !searchQuery || x.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      x.grade?.toLowerCase().includes(searchQuery.toLowerCase())
    );
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
        <View style={s.tableHeader}>
          {['Name', 'Grade', 'Gate', 'Guardian ID', 'Last Distance', 'Status'].map(h => (
            <Text key={h} style={[s.th, h === 'Name' ? { flex: 2 } : {}]}>{h}</Text>
          ))}
        </View>
        <ScrollView>
          {studentsLoading ? <View style={s.loader}><ActivityIndicator color={SLATE} /></View>
            : filtSt.length === 0 ? <View style={s.loader}><Text style={s.loaderText}>No students found.</Text></View>
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
                      <Text style={[s.pillText, { color: st.text }]}>{item.status.charAt(0).toUpperCase() + item.status.slice(1)}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
        </ScrollView>
      </View>
    );
  };

  const renderGuardianRoster = () => {
    const map: Record<string, Student[]> = {};
    students.forEach(s => { if (!map[s.parent_id]) map[s.parent_id] = []; map[s.parent_id].push(s); });
    const pairs = Object.entries(map).filter(([pid]) =>
      !searchQuery || pid.toLowerCase().includes(searchQuery.toLowerCase()) ||
      map[pid].some(x => x.name?.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    return (
      <View style={s.panel}>
        <View style={s.panelHeader}>
          <Text style={s.panelTitle}>👨‍👩‍👧 Guardian Roster</Text>
          <Text style={{ color: SLATE, fontSize: 13, fontWeight: '600' }}>{pairs.length} guardians</Text>
        </View>
        <View style={s.tableHeader}>
          {['Guardian ID', 'Children', 'Gates', 'Last Distance', 'Status'].map(h => (
            <Text key={h} style={[s.th, h === 'Children' ? { flex: 2 } : {}]}>{h}</Text>
          ))}
        </View>
        <ScrollView>
          {pairs.map(([pid, kids]) => {
            const dist = kids.find(k => k.last_distance_meters != null)?.last_distance_meters;
            const allD = kids.every(k => k.status === 'dispatched');
            const anyD = kids.some(k => k.status === 'dispatched');
            return (
              <View key={pid} style={s.tableRow}>
                <Text style={[s.td, s.tdBold]}>{pid}</Text>
                <View style={[s.td, { flex: 2 }]}>{kids.map(k => <Text key={k.id} style={{ fontSize: 12, color: TEXT }}>• {k.name}</Text>)}</View>
                <Text style={s.td}>{[...new Set(kids.map(k => k.gate))].join(', ') || '—'}</Text>
                <Text style={[s.td, { color: SLATE }]}>{dist != null ? `${dist}m` : '—'}</Text>
                <View style={s.td}>
                  <View style={[s.pill, { backgroundColor: allD ? '#d1e4ff' : anyD ? '#b7d7ff' : '#e2e2e4' }]}>
                    <Text style={[s.pillText, { color: allD ? '#001d35' : anyD ? '#28496a' : '#43474d' }]}>
                      {allD ? 'All Dispatched' : anyD ? 'Partial' : 'Waiting'}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
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
          <Pressable style={[s.smBtn, { backgroundColor: SLATE }]} onPress={openAddAccount}>
            <Text style={[s.smBtnText, { color: WHITE }]}>+ New Account</Text>
          </Pressable>
        </View>
      </View>
      <View style={s.tableHeader}>
        {['Parent ID', 'Full Name', 'Password', 'Phone', 'Linked Students', 'Status', 'Actions'].map(h => (
          <Text key={h} style={[s.th, h === 'Linked Students' ? { flex: 2 } : {}]}>{h}</Text>
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
                <Text style={[s.td, { fontFamily: 'monospace', fontSize: 12 }]}>{acc.password}</Text>
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
    const sorted = [...students].sort((a, b) => {
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
        <View style={s.tableHeader}>
          {['Time', 'Student', 'Guardian', 'Gate', 'Distance', 'Status'].map(h => (
            <Text key={h} style={[s.th, h === 'Student' ? { flex: 2 } : {}]}>{h}</Text>
          ))}
        </View>
        <ScrollView>
          {sorted.map(item => {
            const st = statusStyle(item.status);
            return (
              <View key={item.id} style={s.tableRow}>
                <Text style={[s.td, { color: MUTED }]}>
                  {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </Text>
                <Text style={[s.td, s.tdBold, { flex: 2 }]}>{item.name}</Text>
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
    );
  };

  const renderContent = () => {
    switch (activeNav) {
      case 'students': return renderStudentDirectory();
      case 'guardians': return renderGuardianRoster();
      case 'geofence': return renderGeofenceConfig();
      case 'logs': return renderDispatchLogs();
      case 'accounts': return renderParentAccounts();
      default: return renderDashboard();
    }
  };

  return (
    <View style={s.shell}>
      {/* Sidebar */}
      {Platform.OS === 'web' && (
        <View style={s.sidebar}>
          <View style={s.sidebarLogo}>
            <View style={s.logoCircle}><Text style={{ fontSize: 18 }}>🛡️</Text></View>
            <View>
              <Text style={s.logoTitle}>SafePass</Text>
              <Text style={s.logoSub}>Admin Portal</Text>
              <Text style={s.logoCampus}>North Campus</Text>
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
            <Pressable style={s.navItem} onPress={() => router.replace('/')}>
              <Text style={s.navIcon}>🏠</Text>
              <Text style={s.navLabel}>Back to Home</Text>
            </Pressable>
            <Pressable style={s.navItem} onPress={() => { setPinAuthed(false); setPinInput(''); }}>
              <Text style={s.navIcon}>🔒</Text>
              <Text style={s.navLabel}>Lock Portal</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Main */}
      <View style={s.main}>
        {/* Top Header */}
        <View style={s.topHeader}>
          <View style={s.searchBarWrap}>
            <Text>🔍 </Text>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <input style={{ ...s.searchWeb, border: 'none', background: 'transparent', outline: 'none' } as any} placeholder="Search students or guardians…"
                value={searchQuery} onChange={(e: any) => setSearchQuery(e.target.value)} />
            ) : (
              <TextInput style={s.searchNative} placeholder="Search…" value={searchQuery}
                onChangeText={setSearchQuery} placeholderTextColor={MUTED} />
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={s.gpsBadge}><View style={s.gpsDot} /><Text style={s.gpsBadgeText}>GPS Active</Text></View>
            <View style={s.avBubble}><Text style={{ fontSize: 12, fontWeight: '700', color: SLATE }}>SA</Text></View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: SLATE }}>
              {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Text>
          </View>
        </View>

        <ScrollView style={s.canvas} contentContainerStyle={{ paddingBottom: 48 }}>
          {renderContent()}
        </ScrollView>
      </View>

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
              <FormField label="Password *" value={na_password} setter={setNa_password} placeholder="e.g. safepass123" />
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
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
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
  topHeader: { height: 60, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, zIndex: 20 },
  searchBarWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8e8ea', borderRadius: 8, paddingHorizontal: 10, height: 38, width: Platform.OS === 'web' ? 320 : 180 },
  searchWeb: { flex: 1, fontSize: 14, fontFamily: 'inherit' } as any,
  searchNative: { flex: 1, fontSize: 14, color: TEXT },
  gpsBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#b7d7ff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, gap: 6 },
  gpsDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#10B981' },
  gpsBadgeText: { fontSize: 11, fontWeight: '600', color: '#28496a' },
  avBubble: { width: 34, height: 34, borderRadius: 17, backgroundColor: SLATE_LIGHT, alignItems: 'center', justifyContent: 'center' },
  canvas: { flex: 1, padding: 24 },

  // KPI
  kpiRow: { flexDirection: 'row', gap: 14, marginBottom: 18, flexWrap: 'wrap' },
  kpiCard: { flex: 1, minWidth: 170, backgroundColor: WHITE, borderRadius: 12, padding: 18, borderWidth: 1, borderColor: BORDER, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2, gap: 3 },
  kpiTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 },
  kpiLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: MUTED, textTransform: 'uppercase', flex: 1, flexWrap: 'wrap' },
  kpiIcon: { fontSize: 18 },
  kpiValue: { fontSize: 30, fontWeight: '700', color: TEXT },
  kpiSub: { fontSize: 12, fontWeight: '500' },

  splitRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },

  // Panels
  panel: { flex: 2, minWidth: 320, backgroundColor: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  geoPanel: { flex: 1, minWidth: 240, backgroundColor: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 22, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
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
});
