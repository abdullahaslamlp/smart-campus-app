import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, Platform, ScrollView, Image, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { supabase } from '../../supabase';

// ─── Haversine Formula ────────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Types ────────────────────────────────────────────────────────────────────
type NavSection = 'dashboard' | 'students' | 'guardians' | 'geofence' | 'logs';

interface Student {
  id: string;
  name: string;
  grade?: string;
  gate?: string;
  parent_id: string;
  status: 'waiting' | 'dispatched' | 'arrived';
  last_distance_meters?: number | null;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function SmartCampusMVP() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const currentView = params.view === 'parent' ? 'parent' : 'admin';
  const setCurrentView = (view: 'admin' | 'parent') => router.setParams({ view });

  // ── Shared State ──
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  // ── Admin State ──
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [schoolLocation, setSchoolLocation] = useState({ lat: 31.4501, lng: 74.3012 });
  const [tempLocation, setTempLocation] = useState({ lat: 31.4501, lng: 74.3012 });
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [geofenceRadius, setGeofenceRadius] = useState(150);
  const [tempRadius, setTempRadius] = useState(150);
  const [radiusSaved, setRadiusSaved] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // ── Add-Student Modal State ──
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentGrade, setNewStudentGrade] = useState('');
  const [newStudentGate, setNewStudentGate] = useState('Gate A');
  const [newStudentParentId, setNewStudentParentId] = useState('');
  const [addStudentLoading, setAddStudentLoading] = useState(false);

  // ── Add-Guardian Modal State ──
  const [addGuardianOpen, setAddGuardianOpen] = useState(false);
  const [newGuardianId, setNewGuardianId] = useState('');
  const [newGuardianStudentName, setNewGuardianStudentName] = useState('');
  const [newGuardianGrade, setNewGuardianGrade] = useState('');
  const [newGuardianGate, setNewGuardianGate] = useState('Gate A');
  const [addGuardianLoading, setAddGuardianLoading] = useState(false);

  // ── Parent State ──
  const [distance, setDistance] = useState(220);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [locationStatus, requestLocationPermission] = Location.useForegroundPermissions();

  const isCloseEnough = distance <= geofenceRadius;

  // ── Iframe Message Listener ──
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'UPDATE_LOCATION') {
          setTempLocation({ lat: event.data.lat, lng: event.data.lng });
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  // ── Data Subscriptions ──
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await Promise.all([fetchStudents(), fetchSchoolSettings()]);
    };
    init();

    const settingsSub = supabase
      .channel('school_settings_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'school_settings' }, (payload) => {
        const row = payload.new as any;
        if (!row?.lat) return;
        setSchoolLocation({ lat: row.lat, lng: row.lng });
        setTempLocation({ lat: row.lat, lng: row.lng });
        if (row.geofence_radius) {
          setGeofenceRadius(row.geofence_radius);
          setTempRadius(row.geofence_radius);
        }
      })
      .subscribe();

    const studentSub = supabase
      .channel('students_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        if (mounted) fetchStudents();
      })
      .subscribe();

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      mounted = false;
      supabase.removeChannel(settingsSub);
      supabase.removeChannel(studentSub);
      clearInterval(timer);
    };
  }, []);

  // ─── Data Fetchers ────────────────────────────────────────────────────────
  const fetchStudents = async () => {
    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .order('status', { ascending: true });
      if (error) throw error;
      setStudents((data as Student[]) || []);
    } catch (e: any) {
      console.error('[fetchStudents]', e.message);
    } finally {
      setStudentsLoading(false);
    }
  };

  const fetchSchoolSettings = async () => {
    try {
      const { data } = await supabase
        .from('school_settings').select('*').eq('id', 'primary').single();
      if (data) {
        setSchoolLocation({ lat: data.lat, lng: data.lng });
        setTempLocation({ lat: data.lat, lng: data.lng });
        if (data.geofence_radius) {
          setGeofenceRadius(data.geofence_radius);
          setTempRadius(data.geofence_radius);
        }
      }
    } catch (e: any) {
      console.error('[fetchSchoolSettings]', e.message);
    }
  };

  // ─── Admin Handlers ───────────────────────────────────────────────────────
  const saveMapLocation = async () => {
    try {
      const { error } = await supabase.from('school_settings').upsert({
        id: 'primary', lat: tempLocation.lat, lng: tempLocation.lng,
      });
      if (error) throw error;
      setSchoolLocation(tempLocation);
      setIsMapOpen(false);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const saveGeofenceRadius = async () => {
    try {
      const { error } = await supabase.from('school_settings').upsert({
        id: 'primary', lat: schoolLocation.lat, lng: schoolLocation.lng,
        geofence_radius: tempRadius,
      });
      if (error) throw error;
      setGeofenceRadius(tempRadius);
      setRadiusSaved(true);
      setTimeout(() => setRadiusSaved(false), 2000);
    } catch (e: any) {
      Alert.alert('Error saving radius', e.message);
    }
  };

  const handleTeacherDispatch = async (id: string) => {
    try {
      const { error } = await supabase.from('students').update({ status: 'dispatched' }).eq('id', id);
      if (error) throw error;
    } catch (e: any) {
      console.error('[dispatch]', e.message);
    }
  };

  /**
   * WHITEBOX FIX: Supabase requires at least one filter to run an UPDATE.
   * .neq('id', '') fails for UUID columns (type mismatch on some versions).
   * Solution: fetch all IDs first, then update using the 'in' filter.
   */
  const handleResetDemo = async () => {
    setResetLoading(true);
    try {
      const { data: all, error: fetchErr } = await supabase
        .from('students').select('id');
      if (fetchErr) throw fetchErr;

      if (!all || all.length === 0) return;

      const ids = all.map((r: any) => r.id);
      const { error: updateErr } = await supabase
        .from('students')
        .update({ status: 'waiting', last_distance_meters: null })
        .in('id', ids);
      if (updateErr) throw updateErr;

      setIsCheckedIn(false);
      setDistance(geofenceRadius + 70);
    } catch (e: any) {
      Alert.alert('Reset failed', e.message);
    } finally {
      setResetLoading(false);
    }
  };

  // ── Add Student ──
  const handleAddStudent = async () => {
    if (!newStudentName.trim() || !newStudentParentId.trim()) {
      Alert.alert('Validation', 'Student name and Guardian ID are required.');
      return;
    }
    setAddStudentLoading(true);
    try {
      const { error } = await supabase.from('students').insert({
        name: newStudentName.trim(),
        grade: newStudentGrade.trim() || null,
        gate: newStudentGate,
        parent_id: newStudentParentId.trim().toLowerCase(),
        status: 'waiting',
        last_distance_meters: null,
      });
      if (error) throw error;
      setAddStudentOpen(false);
      setNewStudentName(''); setNewStudentGrade(''); setNewStudentParentId('');
    } catch (e: any) {
      Alert.alert('Error adding student', e.message);
    } finally {
      setAddStudentLoading(false);
    }
  };

  // ── Add Guardian (creates a new student linked to that guardian) ──
  const handleAddGuardian = async () => {
    if (!newGuardianId.trim() || !newGuardianStudentName.trim()) {
      Alert.alert('Validation', 'Guardian ID and child name are required.');
      return;
    }
    setAddGuardianLoading(true);
    try {
      const { error } = await supabase.from('students').insert({
        name: newGuardianStudentName.trim(),
        grade: newGuardianGrade.trim() || null,
        gate: newGuardianGate,
        parent_id: newGuardianId.trim().toLowerCase(),
        status: 'waiting',
        last_distance_meters: null,
      });
      if (error) throw error;
      setAddGuardianOpen(false);
      setNewGuardianId(''); setNewGuardianStudentName(''); setNewGuardianGrade('');
    } catch (e: any) {
      Alert.alert('Error adding guardian', e.message);
    } finally {
      setAddGuardianLoading(false);
    }
  };

  // ─── Parent Handlers ──────────────────────────────────────────────────────
  const updateParentDistance = async (newDist: number) => {
    setDistance(newDist);
    try {
      await supabase
        .from('students')
        .update({ last_distance_meters: newDist })
        .eq('parent_id', 'parent_001');
    } catch (e: any) {
      console.error('[updateParentDistance]', e.message);
    }
  };

  const checkLocation = async () => {
    try {
      let perm = locationStatus;
      if (!perm || perm.status !== 'granted') perm = await requestLocationPermission();
      if (perm.status !== 'granted') {
        Alert.alert('Permission denied', 'Location permission is required.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const dist = haversine(
        loc.coords.latitude, loc.coords.longitude,
        schoolLocation.lat, schoolLocation.lng
      );
      await updateParentDistance(Math.round(dist));
    } catch (err: any) {
      Alert.alert('Location error', err.message);
    }
  };

  const handleParentCheckIn = async () => {
    if (!isCloseEnough) return;
    try {
      const { error } = await supabase
        .from('students').update({ status: 'dispatched' }).eq('parent_id', 'parent_001');
      if (error) throw error;
      setIsCheckedIn(true);
    } catch (e: any) {
      Alert.alert('Check-in failed', e.message);
    }
  };

  // ─── Status Style Helper ──────────────────────────────────────────────────
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'dispatched': return { bg: '#d1e4ff', text: '#001d35' };
      case 'arrived':    return { bg: '#b7d7ff', text: '#28496a' };
      default:           return { bg: '#e2e2e4', text: '#43474d' };
    }
  };

  // ─── NAV SECTION RENDERERS ────────────────────────────────────────────────

  const renderStudentDirectory = () => {
    const filtered = students.filter(s =>
      !searchQuery ||
      s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.grade?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.gate?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return (
      <View style={styles.logsPanel}>
        <View style={styles.logsPanelHeader}>
          <Text style={styles.panelTitle}>👥 Student Directory</Text>
          <View style={styles.logsHeaderRight}>
            <Text style={[styles.filterBtnText, { color: '#416183' }]}>{filtered.length} students</Text>
            <Pressable style={[styles.filterBtn, { backgroundColor: SLATE_PRIMARY }]}
              onPress={() => setAddStudentOpen(true)}>
              <Text style={[styles.filterBtnText, { color: '#fff' }]}>+ Add Student</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.tableHeader}>
          {['Name', 'Grade', 'Gate', 'Guardian ID', 'Last Distance', 'Status'].map(h => (
            <Text key={h} style={[styles.tableHead, h === 'Name' ? { flex: 2 } : {}]}>{h}</Text>
          ))}
        </View>
        <ScrollView>
          {studentsLoading ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <ActivityIndicator color={SLATE_PRIMARY} />
              <Text style={{ marginTop: 8, color: TEXT_MUTED }}>Loading students…</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text style={{ color: TEXT_MUTED }}>No students found. Add one above.</Text>
            </View>
          ) : filtered.map(item => {
            const st = getStatusStyle(item.status);
            return (
              <View key={item.id} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableCellBold, { flex: 2 }]}>{item.name}</Text>
                <Text style={styles.tableCell}>{item.grade || '—'}</Text>
                <Text style={styles.tableCell}>{item.gate || '—'}</Text>
                <Text style={[styles.tableCell, styles.tableCellMuted]}>{item.parent_id}</Text>
                <Text style={[styles.tableCell, { color: '#466179' }]}>
                  {item.last_distance_meters != null ? `${item.last_distance_meters}m` : '—'}
                </Text>
                <View style={styles.tableCell}>
                  <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
                    <Text style={[styles.statusPillText, { color: st.text }]}>
                      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
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

  const renderGuardianRoster = () => {
    const guardianMap: Record<string, Student[]> = {};
    students.forEach(s => {
      if (!guardianMap[s.parent_id]) guardianMap[s.parent_id] = [];
      guardianMap[s.parent_id].push(s);
    });
    const filtered = Object.entries(guardianMap).filter(([pid]) =>
      !searchQuery ||
      pid.toLowerCase().includes(searchQuery.toLowerCase()) ||
      guardianMap[pid].some(s => s.name?.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    return (
      <View style={styles.logsPanel}>
        <View style={styles.logsPanelHeader}>
          <Text style={styles.panelTitle}>👨‍👩‍👧 Guardian Roster</Text>
          <View style={styles.logsHeaderRight}>
            <Text style={[styles.filterBtnText, { color: '#416183' }]}>{filtered.length} guardians</Text>
            <Pressable style={[styles.filterBtn, { backgroundColor: SLATE_PRIMARY }]}
              onPress={() => setAddGuardianOpen(true)}>
              <Text style={[styles.filterBtnText, { color: '#fff' }]}>+ Add Guardian</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.tableHeader}>
          {['Guardian ID', 'Children', 'Gates', 'Last Distance', 'Status'].map(h => (
            <Text key={h} style={[styles.tableHead, h === 'Children' ? { flex: 2 } : {}]}>{h}</Text>
          ))}
        </View>
        <ScrollView>
          {studentsLoading ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <ActivityIndicator color={SLATE_PRIMARY} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text style={{ color: TEXT_MUTED }}>No guardians found. Add one above.</Text>
            </View>
          ) : filtered.map(([parentId, kids]) => {
            const dist = kids.find(k => k.last_distance_meters != null)?.last_distance_meters;
            const allDispatched = kids.every(k => k.status === 'dispatched');
            const anyDispatched = kids.some(k => k.status === 'dispatched');
            const statusBg = allDispatched ? '#d1e4ff' : anyDispatched ? '#b7d7ff' : '#e2e2e4';
            const statusTxt = allDispatched ? '#001d35' : anyDispatched ? '#28496a' : '#43474d';
            const statusLabel = allDispatched ? 'All Dispatched' : anyDispatched ? 'Partial' : 'Waiting';
            return (
              <View key={parentId} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableCellBold]}>{parentId}</Text>
                <View style={[styles.tableCell, { flex: 2 }]}>
                  {kids.map(k => (
                    <Text key={k.id} style={{ fontSize: 12, color: TEXT_PRIMARY }}>• {k.name}</Text>
                  ))}
                </View>
                <Text style={styles.tableCell}>{[...new Set(kids.map(k => k.gate))].join(', ') || '—'}</Text>
                <Text style={[styles.tableCell, { color: '#466179' }]}>
                  {dist != null ? `${dist}m` : '—'}
                </Text>
                <View style={styles.tableCell}>
                  <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
                    <Text style={[styles.statusPillText, { color: statusTxt }]}>{statusLabel}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderGeofenceConfig = () => (
    <View style={{ gap: 20 }}>
      <View style={styles.logsPanel}>
        <View style={styles.logsPanelHeader}>
          <Text style={styles.panelTitle}>🗺️ Geofence Configuration</Text>
        </View>
        <View style={{ padding: 24, gap: 20 }}>
          <View style={{ gap: 8 }}>
            <Text style={[styles.tableHead, { fontSize: 13 }]}>SCHOOL GATE COORDINATES</Text>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <View style={{ flex: 1, backgroundColor: '#f4f3f5', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: '700', marginBottom: 4 }}>LATITUDE</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: SLATE_PRIMARY }}>{schoolLocation.lat.toFixed(6)}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: '#f4f3f5', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: '700', marginBottom: 4 }}>LONGITUDE</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: SLATE_PRIMARY }}>{schoolLocation.lng.toFixed(6)}</Text>
              </View>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={[styles.tableHead, { fontSize: 13 }]}>DETECTION RADIUS</Text>
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderMinMax}>50m</Text>
              <Text style={styles.sliderValue}>{tempRadius}m</Text>
              <Text style={styles.sliderMinMax}>500m</Text>
            </View>
            {Platform.OS === 'web' ? (
              // @ts-ignore
              <input type="range" min="50" max="500" value={tempRadius}
                onChange={(e: any) => setTempRadius(Number(e.target.value))}
                style={{ width: '100%', height: 6, accentColor: SLATE_PRIMARY, cursor: 'pointer', marginTop: 4 }}
              />
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {[50, 100, 150, 200, 300, 500].map(v => (
                  <Pressable key={v} style={[styles.radiusChip, tempRadius === v && styles.radiusChipActive]}
                    onPress={() => setTempRadius(v)}>
                    <Text style={[styles.radiusChipText, tempRadius === v && { color: '#fff' }]}>{v}m</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <Pressable style={styles.mapPinBtn} onPress={() => setIsMapOpen(true)}>
            <Text style={styles.mapPinBtnText}>📍 Change School Gate Pin on Map</Text>
          </Pressable>

          {Platform.OS === 'web' && (
            <View style={{ height: 300, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: BORDER }}>
              {/* @ts-ignore */}
              <iframe
                srcDoc={`<!DOCTYPE html><html><head>
                  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
                  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                  <style>body,html,#map{margin:0;padding:0;height:100%;width:100%;}</style>
                </head><body><div id="map"></div>
                <script>
                  const map = L.map('map').setView([${schoolLocation.lat},${schoolLocation.lng}],15);
                  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                  L.marker([${schoolLocation.lat},${schoolLocation.lng}]).addTo(map).bindPopup('School Gate').openPopup();
                  L.circle([${schoolLocation.lat},${schoolLocation.lng}],{radius:${geofenceRadius},color:'#466179',fillOpacity:0.15}).addTo(map);
                </script></body></html>`}
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            </View>
          )}

          <Pressable style={[styles.saveBtn, radiusSaved && { backgroundColor: '#10B981' }]}
            onPress={saveGeofenceRadius}>
            <Text style={styles.saveBtnText}>{radiusSaved ? '✅ Saved!' : '💾 Save Configuration'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderDispatchLogs = () => {
    const sorted = [...students].sort((a, b) => {
      const order: Record<string, number> = { dispatched: 0, arrived: 1, waiting: 2 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    });
    return (
      <View style={styles.logsPanel}>
        <View style={styles.logsPanelHeader}>
          <Text style={styles.panelTitle}>📋 Dispatch Logs</Text>
          <Pressable style={styles.filterBtn} onPress={handleResetDemo} disabled={resetLoading}>
            {resetLoading
              ? <ActivityIndicator size="small" color={SLATE_PRIMARY} />
              : <Text style={styles.filterBtnText}>🔄 Reset All</Text>
            }
          </Pressable>
        </View>
        <View style={styles.tableHeader}>
          {['Time', 'Student Name', 'Guardian', 'Gate', 'Distance', 'Status'].map(h => (
            <Text key={h} style={[styles.tableHead, h === 'Student Name' ? { flex: 2 } : {}]}>{h}</Text>
          ))}
        </View>
        <ScrollView>
          {studentsLoading ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <ActivityIndicator color={SLATE_PRIMARY} />
            </View>
          ) : sorted.map(item => {
            const st = getStatusStyle(item.status);
            return (
              <View key={item.id} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableCellMuted]}>
                  {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </Text>
                <Text style={[styles.tableCell, styles.tableCellBold, { flex: 2 }]}>{item.name}</Text>
                <Text style={styles.tableCell}>{item.parent_id}</Text>
                <Text style={styles.tableCell}>{item.gate || '—'}</Text>
                <Text style={[styles.tableCell, { color: '#466179' }]}>
                  {item.last_distance_meters != null ? `${item.last_distance_meters}m` : '—'}
                </Text>
                <View style={styles.tableCell}>
                  <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
                    <Text style={[styles.statusPillText, { color: st.text }]}>
                      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
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

  const renderAdminMainContent = () => {
    switch (activeNav) {
      case 'students': return renderStudentDirectory();
      case 'guardians': return renderGuardianRoster();
      case 'geofence': return renderGeofenceConfig();
      case 'logs': return renderDispatchLogs();
      default: return null;
    }
  };

  // ─── RENDER ADMIN PORTAL ──────────────────────────────────────────────────
  const renderAdminView = () => {
    const dispatchedCount = students.filter(s => s.status === 'dispatched').length;

    const filteredStudents = students.filter(s =>
      !searchQuery ||
      s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.parent_id?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <View style={styles.adminShell}>
        {/* ── Sidebar (web only) ── */}
        {Platform.OS === 'web' && (
          <View style={styles.sidebar}>
            <View style={styles.sidebarLogo}>
              <View style={styles.logoIcon}>
                <Text style={{ fontSize: 18 }}>🛡️</Text>
              </View>
              <View>
                <Text style={styles.logoTitle}>SafePass</Text>
                <Text style={styles.logoSub}>Admin</Text>
                <Text style={styles.logoCampus}>North Campus</Text>
              </View>
            </View>

            <View style={styles.navLinks}>
              {([
                { id: 'dashboard', label: 'Dashboard', icon: '📊' },
                { id: 'students', label: 'Student Directory', icon: '👥' },
                { id: 'guardians', label: 'Guardian Roster', icon: '👨‍👩‍👧' },
                { id: 'geofence', label: 'Geofence Configuration', icon: '🗺️' },
                { id: 'logs', label: 'Dispatch Logs', icon: '📋' },
              ] as { id: NavSection; label: string; icon: string }[]).map(item => (
                <Pressable
                  key={item.id}
                  style={[styles.navItem, activeNav === item.id && styles.navItemActive]}
                  onPress={() => setActiveNav(item.id)}
                >
                  <Text style={styles.navIcon}>{item.icon}</Text>
                  <Text style={[styles.navLabel, activeNav === item.id && styles.navLabelActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.sidebarBottom}>
              <Pressable style={styles.navItem} onPress={() => setCurrentView('parent')}>
                <Text style={styles.navIcon}>📱</Text>
                <Text style={styles.navLabel}>Parent App View</Text>
              </Pressable>
              <Pressable style={styles.navItem}>
                <Text style={styles.navIcon}>⚙️</Text>
                <Text style={styles.navLabel}>Settings</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Main Content ── */}
        <View style={styles.mainContent}>

          {/* Top Header */}
          <View style={styles.topHeader}>
            <View style={styles.searchBar}>
              <Text style={styles.searchIcon}>🔍</Text>
              {Platform.OS === 'web' ? (
                // @ts-ignore
                <input
                  style={styles.searchInputWeb as any}
                  placeholder="Search students, guardians, or vehicles..."
                  value={searchQuery}
                  onChange={(e: any) => setSearchQuery(e.target.value)}
                />
              ) : (
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search students or guardians..."
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholderTextColor="#767779"
                />
              )}
            </View>
            <View style={styles.headerRight}>
              <View style={styles.gpsStatusBadge}>
                <View style={styles.gpsDot} />
                <Text style={styles.gpsStatusText}>GPS Geofence Active</Text>
              </View>
              <View style={styles.avatarBubble}>
                <Text style={styles.avatarText}>SA</Text>
              </View>
              <Text style={styles.clockText}>
                {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </Text>
            </View>
          </View>

          {/* Dashboard Canvas */}
          <ScrollView style={styles.canvas} contentContainerStyle={{ paddingBottom: 48 }}>

            {/* Non-dashboard nav sections */}
            {activeNav !== 'dashboard' && renderAdminMainContent()}

            {/* Dashboard only */}
            {activeNav === 'dashboard' && (
              <>
                {/* KPI Row */}
                <View style={styles.kpiRow}>
                  {[
                    { label: 'TOTAL STUDENTS', value: studentsLoading ? '…' : String(students.length), sub: '+12 since morning', subColor: '#416183', icon: '👥' },
                    { label: 'ACTIVE DISMISSALS', value: studentsLoading ? '…' : String(dispatchedCount), sub: 'In progress', subColor: '#416183', icon: '🚶' },
                    { label: 'AVERAGE WAIT TIME', value: '4.2m', sub: '-0.5m vs yesterday', subColor: '#ba1a1a', icon: '⏱️' },
                    { label: 'GEOFENCE RADIUS', value: `${geofenceRadius}m`, sub: 'Standard Range', subColor: '#767779', icon: '📡' },
                  ].map((kpi, i) => (
                    <View key={i} style={styles.kpiCard}>
                      <View style={styles.kpiCardTop}>
                        <Text style={styles.kpiLabel}>{kpi.label}</Text>
                        <Text style={styles.kpiIcon}>{kpi.icon}</Text>
                      </View>
                      <Text style={styles.kpiValue}>{kpi.value}</Text>
                      <Text style={[styles.kpiSub, { color: kpi.subColor }]}>{kpi.sub}</Text>
                    </View>
                  ))}
                </View>

                {/* Middle Split */}
                <View style={styles.splitRow}>

                  {/* Live Dispatch Logs */}
                  <View style={styles.logsPanel}>
                    <View style={styles.logsPanelHeader}>
                      <Text style={styles.panelTitle}>Live Dispatch Logs</Text>
                      <View style={styles.logsHeaderRight}>
                        <Pressable style={styles.filterBtn} onPress={handleResetDemo} disabled={resetLoading}>
                          {resetLoading
                            ? <ActivityIndicator size="small" color={SLATE_PRIMARY} />
                            : <Text style={styles.filterBtnText}>🔄 Reset Demo</Text>
                          }
                        </Pressable>
                        <Pressable style={styles.filterBtn}>
                          <Text style={styles.filterBtnText}>⚙ Filter</Text>
                        </Pressable>
                      </View>
                    </View>

                    <View style={styles.tableHeader}>
                      {['Timestamp', 'Student Name', 'Guardian', 'Gate', 'Distance', 'Status'].map(h => (
                        <Text key={h} style={[styles.tableHead, h === 'Student Name' ? { flex: 2 } : {}]}>{h}</Text>
                      ))}
                    </View>

                    {/* BLACKBOX FIX: Show loader while fetching, no demo flash */}
                    {studentsLoading ? (
                      <View style={{ padding: 32, alignItems: 'center' }}>
                        <ActivityIndicator color={SLATE_PRIMARY} />
                        <Text style={{ marginTop: 8, color: TEXT_MUTED }}>Connecting to Supabase…</Text>
                      </View>
                    ) : filteredStudents.length > 0 ? filteredStudents.map(item => {
                      const st = getStatusStyle(item.status);
                      return (
                        <Pressable
                          key={item.id}
                          style={styles.tableRow}
                          onPress={() => item.status === 'waiting' && handleTeacherDispatch(item.id)}
                        >
                          <Text style={[styles.tableCell, styles.tableCellMuted]}>
                            {currentTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </Text>
                          <Text style={[styles.tableCell, styles.tableCellBold, { flex: 2 }]}>{item.name}</Text>
                          <Text style={styles.tableCell}>{item.parent_id}</Text>
                          <Text style={styles.tableCell}>{item.gate || '—'}</Text>
                          <Text style={[styles.tableCell, { color: '#466179' }]}>
                            {item.last_distance_meters != null ? `${item.last_distance_meters}m` : '—'}
                          </Text>
                          <View style={styles.tableCell}>
                            <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
                              <Text style={[styles.statusPillText, { color: st.text }]}>
                                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                      );
                    }) : (
                      <View style={{ padding: 32, alignItems: 'center' }}>
                        <Text style={{ color: TEXT_MUTED }}>No student records yet. Add via Student Directory.</Text>
                      </View>
                    )}
                  </View>

                  {/* Geofence Controls Panel */}
                  <View style={styles.controlsPanel}>
                    <View style={styles.controlsPanelHeader}>
                      <Text style={{ fontSize: 28 }}>📡</Text>
                      <Text style={styles.panelTitle}>Geofence{'\n'}Controls</Text>
                    </View>
                    <Text style={styles.controlsDesc}>
                      Adjust the detection radius for automatic arrival triggers.
                    </Text>
                    <View style={styles.sliderSection}>
                      <View style={styles.sliderLabels}>
                        <Text style={styles.sliderMinMax}>50m</Text>
                        <Text style={styles.sliderValue}>{tempRadius}m</Text>
                        <Text style={styles.sliderMinMax}>500m</Text>
                      </View>
                      {Platform.OS === 'web' ? (
                        // @ts-ignore
                        <input type="range" min="50" max="500" value={tempRadius}
                          onChange={(e: any) => setTempRadius(Number(e.target.value))}
                          style={{ width: '100%', height: 6, accentColor: SLATE_PRIMARY, cursor: 'pointer', marginTop: 4 }}
                        />
                      ) : (
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                          {[50, 100, 150, 200, 300, 500].map(v => (
                            <Pressable key={v} style={[styles.radiusChip, tempRadius === v && styles.radiusChipActive]}
                              onPress={() => setTempRadius(v)}>
                              <Text style={[styles.radiusChipText, tempRadius === v && { color: '#fff' }]}>{v}m</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                    <Pressable style={styles.mapPinBtn} onPress={() => setIsMapOpen(true)}>
                      <Text style={styles.mapPinBtnText}>📍 Set School Gate Pin on Map</Text>
                    </Pressable>
                    <Text style={styles.pinCoordsText}>
                      📌 {schoolLocation.lat.toFixed(4)}, {schoolLocation.lng.toFixed(4)}
                    </Text>
                    <Pressable style={[styles.saveBtn, radiusSaved && { backgroundColor: '#10B981' }]}
                      onPress={saveGeofenceRadius}>
                      <Text style={styles.saveBtnText}>{radiusSaved ? '✅ Saved!' : '💾 Save Configuration'}</Text>
                    </Pressable>
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </View>

        {/* ── Map Modal ── */}
        {isMapOpen && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>📍 Set School Gate Location</Text>
              <Text style={styles.modalSub}>Click anywhere on the map to drop the school gate pin.</Text>
              <View style={styles.mapBox}>
                {Platform.OS === 'web' ? (
                  // @ts-ignore
                  <iframe
                    srcDoc={`<!DOCTYPE html><html>
                    <head>
                      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
                      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                      <style>body,html,#map{margin:0;padding:0;height:100%;width:100%;}</style>
                    </head>
                    <body>
                      <div id="map"></div>
                      <script>
                        const map = L.map('map').setView([${tempLocation.lat},${tempLocation.lng}],15);
                        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                        let marker = L.marker([${tempLocation.lat},${tempLocation.lng}],{draggable:true}).addTo(map);
                        function send(lat,lng){window.parent.postMessage({type:'UPDATE_LOCATION',lat,lng},'*');}
                        marker.on('dragend',e=>{const p=e.target.getLatLng();send(p.lat,p.lng);});
                        map.on('click',e=>{marker.setLatLng(e.latlng);send(e.latlng.lat,e.latlng.lng);});
                      </script>
                    </body></html>`}
                    style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8 }}
                  />
                ) : (
                  <Text style={{ textAlign: 'center', marginTop: 20, color: TEXT_MUTED }}>
                    Map pin picker available on Web only.
                  </Text>
                )}
              </View>
              <Text style={styles.coordsPreview}>
                Selected: {tempLocation.lat.toFixed(5)}, {tempLocation.lng.toFixed(5)}
              </Text>
              <View style={styles.modalActions}>
                <Pressable style={styles.cancelBtn} onPress={() => setIsMapOpen(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.confirmBtn} onPress={saveMapLocation}>
                  <Text style={styles.confirmBtnText}>Save Pin</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* ── Add Student Modal ── */}
        {addStudentOpen && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>👤 Add New Student</Text>
              <Text style={styles.modalSub}>Student will be added to Supabase and appear in real-time.</Text>
              <View style={{ gap: 12, marginTop: 8 }}>
                {[
                  { label: 'Full Name *', value: newStudentName, setter: setNewStudentName, placeholder: 'e.g. Zara Khan' },
                  { label: 'Grade', value: newStudentGrade, setter: setNewStudentGrade, placeholder: 'e.g. Grade 4-A' },
                  { label: 'Guardian ID *', value: newStudentParentId, setter: setNewStudentParentId, placeholder: 'e.g. parent_003' },
                ].map(field => (
                  <View key={field.label}>
                    <Text style={styles.formLabel}>{field.label}</Text>
                    {Platform.OS === 'web' ? (
                      // @ts-ignore
                      <input
                        style={styles.formInputWeb as any}
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={(e: any) => field.setter(e.target.value)}
                      />
                    ) : (
                      <TextInput style={styles.formInput} placeholder={field.placeholder}
                        value={field.value} onChangeText={field.setter} placeholderTextColor={TEXT_MUTED} />
                    )}
                  </View>
                ))}
                <View>
                  <Text style={styles.formLabel}>Pickup Gate</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    {['Gate A', 'Gate B', 'Gate C'].map(g => (
                      <Pressable key={g}
                        style={[styles.radiusChip, newStudentGate === g && styles.radiusChipActive]}
                        onPress={() => setNewStudentGate(g)}>
                        <Text style={[styles.radiusChipText, newStudentGate === g && { color: '#fff' }]}>{g}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
              <View style={[styles.modalActions, { marginTop: 20 }]}>
                <Pressable style={styles.cancelBtn} onPress={() => setAddStudentOpen(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.confirmBtn, addStudentLoading && { opacity: 0.7 }]}
                  onPress={handleAddStudent} disabled={addStudentLoading}>
                  {addStudentLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.confirmBtnText}>Add Student</Text>
                  }
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* ── Add Guardian Modal ── */}
        {addGuardianOpen && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>👨‍👩‍👧 Add New Guardian</Text>
              <Text style={styles.modalSub}>Creates a guardian entry with their first child linked.</Text>
              <View style={{ gap: 12, marginTop: 8 }}>
                {[
                  { label: 'Guardian ID *', value: newGuardianId, setter: setNewGuardianId, placeholder: 'e.g. parent_005' },
                  { label: "Child's Full Name *", value: newGuardianStudentName, setter: setNewGuardianStudentName, placeholder: 'e.g. Ali Hassan' },
                  { label: "Child's Grade", value: newGuardianGrade, setter: setNewGuardianGrade, placeholder: 'e.g. Grade 2-B' },
                ].map(field => (
                  <View key={field.label}>
                    <Text style={styles.formLabel}>{field.label}</Text>
                    {Platform.OS === 'web' ? (
                      // @ts-ignore
                      <input
                        style={styles.formInputWeb as any}
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={(e: any) => field.setter(e.target.value)}
                      />
                    ) : (
                      <TextInput style={styles.formInput} placeholder={field.placeholder}
                        value={field.value} onChangeText={field.setter} placeholderTextColor={TEXT_MUTED} />
                    )}
                  </View>
                ))}
                <View>
                  <Text style={styles.formLabel}>Pickup Gate</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    {['Gate A', 'Gate B', 'Gate C'].map(g => (
                      <Pressable key={g}
                        style={[styles.radiusChip, newGuardianGate === g && styles.radiusChipActive]}
                        onPress={() => setNewGuardianGate(g)}>
                        <Text style={[styles.radiusChipText, newGuardianGate === g && { color: '#fff' }]}>{g}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
              <View style={[styles.modalActions, { marginTop: 20 }]}>
                <Pressable style={styles.cancelBtn} onPress={() => setAddGuardianOpen(false)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.confirmBtn, addGuardianLoading && { opacity: 0.7 }]}
                  onPress={handleAddGuardian} disabled={addGuardianLoading}>
                  {addGuardianLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.confirmBtnText}>Add Guardian</Text>
                  }
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  // ─── RENDER PARENT APP ────────────────────────────────────────────────────
  const renderParentView = () => {
    const parentChildren = students.filter(s => s.parent_id === 'parent_001');

    return (
      <View style={styles.parentContainer}>
        <View style={styles.parentTopBar}>
          <Text style={styles.parentTopTitle}>SafePass</Text>
          <View style={styles.parentHeaderRight}>
            <Pressable style={styles.parentSwitchBtn} onPress={() => setCurrentView('admin')}>
              <Text style={styles.parentSwitchBtnText}>🖥️ Admin Portal</Text>
            </Pressable>
            <View style={styles.avatarContainer}>
              <Image
                source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBHca5LGRBNre3wlQunBCfpC6_Ur9db-Lj4CfxucdR_2y8lVk1FzncPXRNozRWS4QJLx28LZraRgEZvdkY7H4BBTVfzeWzuHZr_7qRpp51uuehDJ8JBrm8mE5mRUJ7R5inpJznBa0hjFfh2A5innRCodtkSfOElsqieRSpNIT4bTjPv6jfByanryAC1-ZNx9xC7pqun7opbIiZ54VU6gvJZ0lXzKFictb07oaMY5WkgoA88-4QdOWby' }}
                style={styles.avatarImage}
              />
            </View>
          </View>
        </View>

        <ScrollView style={styles.parentMain} contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={styles.heroSection}>
            <View style={styles.heroIconContainer}>
              <Text style={{ fontSize: 24 }}>📍</Text>
            </View>
            <Text style={styles.heroDistance}>{distance}m</Text>
            <Text style={styles.heroSubtitle}>from School Gate</Text>
            <Text style={styles.geofenceHint}>Unlock radius: {geofenceRadius}m</Text>
            <Pressable style={styles.gpsButton} onPress={checkLocation}>
              <View style={styles.gpsPulse} />
              <Text style={styles.gpsButtonText}>UPDATE GPS LOCATION</Text>
            </Pressable>
            <View style={styles.simControlsRow}>
              <Pressable style={styles.simControlBtn} onPress={() => updateParentDistance(geofenceRadius + 70)}>
                <Text style={styles.simControlText}>Far ({geofenceRadius + 70}m)</Text>
              </Pressable>
              <Pressable style={styles.simControlBtn} onPress={() => updateParentDistance(Math.round(geofenceRadius * 0.3))}>
                <Text style={styles.simControlText}>Near ({Math.round(geofenceRadius * 0.3)}m)</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.childrenSection}>
            <Text style={styles.childrenHeader}>My Students</Text>
            {(parentChildren.length > 0 ? parentChildren : [
              { id: '1', name: 'Ayesha Malik', grade: 'Grade 5-A', gate: 'Gate A', status: 'waiting' as const },
              { id: '2', name: 'Bilal Malik', grade: 'Grade 3-B', gate: 'Gate B', status: 'waiting' as const },
            ]).map((child, index) => {
              const isDispatched = child.status === 'dispatched';
              return (
                <View key={child.id} style={styles.childRow}>
                  <View style={[styles.childColorStripe, { backgroundColor: isDispatched ? '#10B981' : '#F59E0B' }]} />
                  <View style={styles.childAvatar}>
                    <Image
                      source={{ uri: index === 0
                        ? 'https://lh3.googleusercontent.com/aida-public/AB6AXuD8SI1zIrTq9sjUJ78Z_8mnXFrrqSnwaghm8D6LsvkpqvGEeAyFqxTRJJLQX5Obb7R0vFkA3Tq9_Zodr5l16ZVSmxbMD1289MMm9Gj6Wu4nY9O-o9ByCpMtpRUijekD4QwNvVPtY277ogMUbCrDqAEkLOVCHXSnKXSiBXtSmUz9p-wPCsQD-eeRYLnnhVauBzJ7V-P0pDB1spaWAHycm_hWuCEWDtB4U1svBXAFGFJOxXADg1aNW018'
                        : 'https://lh3.googleusercontent.com/aida-public/AB6AXuCarQlWAHNqF20G4BaSkbygpjpFDalO-B4FfPlQAH080ZIuy2HVyi_WFKvTOFYeX9Tsm2iOZHFN-sG9Pp9irps6xiAzUB-U0hYp02U2m1EPS0dbYdvrKJWXtFXclAY4er7GR0phJ-noVyfOGSu7XQwaz4KCZKoxQW5petEXuDaUNbkIKcw8vmNprufiazF2_6xuMC8mDt9l7lqhSUyDZJn5vzRGmnrsszqiEvcw-3W-smJPw4ygJP_J'
                      }}
                      style={styles.avatarImage}
                    />
                  </View>
                  <View style={styles.childInfo}>
                    <Text style={styles.childName}>{child.name}</Text>
                    <Text style={styles.childGrade}>{child.grade} • {child.gate}</Text>
                  </View>
                  <View style={[styles.childStatusBadge, { backgroundColor: isDispatched ? '#D1FAE5' : '#FEF3C7' }]}>
                    <Text style={[styles.childStatusText, { color: isDispatched ? '#065F46' : '#92400E' }]}>
                      {isDispatched ? 'DISPATCHED' : 'IN CLASS'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.bottomActionArea}>
          <Pressable
            style={[
              styles.checkInActionBtn,
              !isCloseEnough && styles.checkInDisabled,
              isCheckedIn && styles.checkInSuccess,
            ]}
            onPress={handleParentCheckIn}
            disabled={!isCloseEnough || isCheckedIn}
          >
            <Text style={[styles.checkInActionText, isCloseEnough && !isCheckedIn && { color: '#fff' }]}>
              {isCheckedIn
                ? '✅ Checked In'
                : isCloseEnough
                  ? '🚗 Slide to Check-In'
                  : `Too far — ${distance}m (need ≤${geofenceRadius}m)`}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return currentView === 'admin' ? renderAdminView() : renderParentView();
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const SLATE_PRIMARY = '#466179';
const SLATE_LIGHT = '#b0cce8';
const SURFACE = '#f9f9fb';
const WHITE = '#ffffff';
const BORDER = '#c3c7cd';
const TEXT_PRIMARY = '#1a1c1d';
const TEXT_MUTED = '#767779';
const SIDEBAR_W = 260;

const styles = StyleSheet.create({
  adminShell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: SURFACE,
  },
  sidebar: {
    width: SIDEBAR_W,
    backgroundColor: '#f4f3f5',
    borderRightWidth: 1,
    borderRightColor: BORDER,
    flexDirection: 'column',
    paddingTop: Platform.select({ web: 80, default: 0 }) ?? 0,
  },
  sidebarLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  logoIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: SLATE_PRIMARY,
    alignItems: 'center', justifyContent: 'center',
  },
  logoTitle: { fontSize: 20, fontWeight: '700', color: SLATE_PRIMARY, lineHeight: 22 },
  logoSub: { fontSize: 16, fontWeight: '700', color: SLATE_PRIMARY, lineHeight: 18 },
  logoCampus: { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },
  navLinks: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, gap: 4 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
  navItemActive: { backgroundColor: '#b7d7ff' },
  navIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  navLabel: { fontSize: 14, color: TEXT_MUTED, fontWeight: '500' },
  navLabelActive: { color: '#28496a', fontWeight: '700' },
  sidebarBottom: { borderTopWidth: 1, borderTopColor: BORDER, paddingVertical: 12, paddingHorizontal: 8, gap: 4 },

  mainContent: { flex: 1, flexDirection: 'column' },

  topHeader: {
    height: 64, backgroundColor: WHITE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 24, zIndex: 30,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#e8e8ea', borderRadius: 8,
    paddingHorizontal: 12, height: 40,
    width: Platform.OS === 'web' ? 340 : 200, gap: 8,
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 14, color: TEXT_PRIMARY },
  searchInputWeb: { flex: 1, fontSize: 14, color: TEXT_PRIMARY, fontFamily: 'Inter, sans-serif' } as any,
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  gpsStatusBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#b7d7ff', paddingHorizontal: 12,
    paddingVertical: 6, borderRadius: 9999, gap: 6,
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  gpsStatusText: { fontSize: 12, fontWeight: '600', color: '#28496a' },
  avatarBubble: { width: 36, height: 36, borderRadius: 18, backgroundColor: SLATE_LIGHT, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '700', color: SLATE_PRIMARY },
  clockText: { fontSize: 18, fontWeight: '700', color: SLATE_PRIMARY },

  canvas: { flex: 1, padding: 24 },

  kpiRow: { flexDirection: 'row', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  kpiCard: {
    flex: 1, minWidth: 180, backgroundColor: WHITE, borderRadius: 12,
    padding: 20, borderWidth: 1, borderColor: BORDER,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2, gap: 4,
  },
  kpiCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  kpiLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: TEXT_MUTED, textTransform: 'uppercase', flex: 1, flexWrap: 'wrap' },
  kpiIcon: { fontSize: 20 },
  kpiValue: { fontSize: 32, fontWeight: '700', color: TEXT_PRIMARY, lineHeight: 38 },
  kpiSub: { fontSize: 12, fontWeight: '500' },

  splitRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },

  logsPanel: {
    flex: 2, minWidth: 320, backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  logsPanelHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: SURFACE,
  },
  panelTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
  logsHeaderRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#e8e8ea' },
  filterBtnText: { fontSize: 12, fontWeight: '600', color: SLATE_PRIMARY },
  tableHeader: {
    flexDirection: 'row', backgroundColor: '#f4f3f5',
    borderBottomWidth: 1, borderBottomColor: BORDER,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  tableHead: { flex: 1, fontSize: 11, fontWeight: '700', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f2',
  },
  tableCell: { flex: 1, fontSize: 13, color: TEXT_PRIMARY },
  tableCellMuted: { color: TEXT_MUTED },
  tableCellBold: { fontWeight: '600' },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 9999 },
  statusPillText: { fontSize: 11, fontWeight: '700' },

  controlsPanel: {
    flex: 1, minWidth: 260, backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER, padding: 24, gap: 16,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  controlsPanelHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  controlsDesc: { fontSize: 13, color: TEXT_MUTED, lineHeight: 18 },
  sliderSection: { gap: 8 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderMinMax: { fontSize: 12, color: TEXT_MUTED, fontWeight: '500' },
  sliderValue: { fontSize: 22, fontWeight: '800', color: SLATE_PRIMARY },
  radiusChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#e8e8ea', borderWidth: 1, borderColor: BORDER },
  radiusChipActive: { backgroundColor: SLATE_PRIMARY },
  radiusChipText: { fontSize: 12, fontWeight: '600', color: TEXT_MUTED },
  mapPinBtn: { backgroundColor: '#e8f0f8', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: SLATE_LIGHT, alignItems: 'center' },
  mapPinBtnText: { fontSize: 13, fontWeight: '600', color: SLATE_PRIMARY },
  pinCoordsText: { fontSize: 11, color: TEXT_MUTED, textAlign: 'center' },
  saveBtn: { backgroundColor: SLATE_PRIMARY, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  saveBtnText: { color: WHITE, fontSize: 14, fontWeight: '700' },

  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,30,50,0.75)',
    justifyContent: 'center', alignItems: 'center', zIndex: 1000,
  },
  modalCard: { backgroundColor: WHITE, borderRadius: 16, padding: 28, width: '90%', maxWidth: 640 },
  modalTitle: { fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 4 },
  modalSub: { fontSize: 13, color: TEXT_MUTED, marginBottom: 16 },
  mapBox: { height: 400, borderRadius: 10, overflow: 'hidden', backgroundColor: '#e8e8ea', marginBottom: 12 },
  coordsPreview: { fontSize: 12, color: TEXT_MUTED, textAlign: 'center', marginBottom: 16 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  cancelBtn: { backgroundColor: '#e8e8ea', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  cancelBtnText: { color: TEXT_MUTED, fontWeight: '600', fontSize: 14 },
  confirmBtn: { backgroundColor: SLATE_PRIMARY, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, minWidth: 100, alignItems: 'center' },
  confirmBtnText: { color: WHITE, fontWeight: '700', fontSize: 14 },

  // Form styles
  formLabel: { fontSize: 12, fontWeight: '700', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  formInput: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: TEXT_PRIMARY, backgroundColor: '#f4f3f5' },
  formInputWeb: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingLeft: 12, paddingRight: 12, height: 40, fontSize: 14, color: TEXT_PRIMARY, backgroundColor: '#f4f3f5', fontFamily: 'Inter, sans-serif', width: '100%', boxSizing: 'border-box' } as any,

  // Parent View
  parentContainer: { flex: 1, backgroundColor: SURFACE, ...Platform.select({ web: { paddingTop: 80 } }) },
  parentTopBar: { height: 64, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, zIndex: 20 },
  parentTopTitle: { fontSize: 20, fontWeight: '700', color: SLATE_PRIMARY },
  parentHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  parentSwitchBtn: { backgroundColor: SLATE_PRIMARY, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  parentSwitchBtnText: { color: WHITE, fontSize: 12, fontWeight: '600' },
  avatarContainer: { height: 40, width: 40, borderRadius: 20, backgroundColor: '#e2e2e4', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  parentMain: { flex: 1, paddingHorizontal: 16, paddingTop: 24 },
  heroSection: {
    backgroundColor: WHITE, borderRadius: 12, padding: 24,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center', marginBottom: 24,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  heroIconContainer: { width: 56, height: 56, borderRadius: 28, backgroundColor: SLATE_PRIMARY, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroDistance: { fontSize: 52, fontWeight: '800', color: SLATE_PRIMARY, lineHeight: 60 },
  heroSubtitle: { fontSize: 16, color: TEXT_MUTED, marginTop: 4 },
  geofenceHint: { fontSize: 12, color: SLATE_PRIMARY, fontWeight: '600', marginTop: 6, backgroundColor: SLATE_LIGHT, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  gpsButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8e8ea', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999, marginTop: 16, gap: 8 },
  gpsPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  gpsButtonText: { fontSize: 12, fontWeight: '700', color: '#416183', letterSpacing: 0.5 },
  simControlsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  simControlBtn: { backgroundColor: '#e2e2e4', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  simControlText: { fontSize: 12, fontWeight: '600', color: TEXT_MUTED },
  childrenSection: { gap: 12 },
  childrenHeader: { fontSize: 20, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 4 },
  childRow: { backgroundColor: WHITE, borderRadius: 10, borderWidth: 1, borderColor: BORDER, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  childColorStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6 },
  childAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e2e2e4', overflow: 'hidden' },
  childInfo: { flex: 1 },
  childName: { fontSize: 18, fontWeight: '600', color: TEXT_PRIMARY },
  childGrade: { fontSize: 13, color: TEXT_MUTED },
  childStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  childStatusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  bottomActionArea: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(249,249,251,0.92)',
    borderTopWidth: 1, borderTopColor: BORDER,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    zIndex: 20,
  },
  checkInActionBtn: { height: 60, borderRadius: 30, backgroundColor: SLATE_PRIMARY, alignItems: 'center', justifyContent: 'center' },
  checkInDisabled: { backgroundColor: '#e8e8ea' },
  checkInSuccess: { backgroundColor: '#10B981' },
  checkInActionText: { fontSize: 16, fontWeight: '700', color: TEXT_MUTED },
});