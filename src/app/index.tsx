import { useEffect, useState, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, Platform, ScrollView, Image, TextInput, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { supabase } from '../../supabase';

// ─── Haversine Formula ───────────────────────────────────────────────────────
function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Types ───────────────────────────────────────────────────────────────────
type NavSection = 'dashboard' | 'students' | 'guardians' | 'geofence' | 'logs' | 'settings';

// ─── Main Component ──────────────────────────────────────────────────────────
export default function SmartCampusMVP() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const currentView = params.view === 'parent' ? 'parent' : 'admin';
  const setCurrentView = (view: 'admin' | 'parent') => router.setParams({ view });

  // ── Shared State ──
  const [students, setStudents] = useState<any[]>([]);
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

  // ── Parent State ──
  const [distance, setDistance] = useState(120);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [locationStatus, requestLocationPermission] = Location.useForegroundPermissions();

  const isCloseEnough = distance <= geofenceRadius;

  // ── Iframe message listener (Web map picker) ──
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
    fetchStudents();
    fetchSchoolSettings();

    const settingsSub = supabase
      .channel('public:school_settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'school_settings' }, (payload) => {
        const row = payload.new as any;
        if (row?.lat) setSchoolLocation({ lat: row.lat, lng: row.lng });
        if (row?.geofence_radius) {
          setGeofenceRadius(row.geofence_radius);
          setTempRadius(row.geofence_radius);
        }
      })
      .subscribe();

    const studentSub = supabase
      .channel('public:students')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        fetchStudents();
      })
      .subscribe();

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      supabase.removeChannel(settingsSub);
      supabase.removeChannel(studentSub);
      clearInterval(timer);
    };
  }, []);

  const fetchStudents = async () => {
    const { data, error } = await supabase
      .from('students').select('*').order('status', { ascending: true });
    if (!error) setStudents(data || []);
  };

  const fetchSchoolSettings = async () => {
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
  };

  // ── Admin Handlers ──
  const saveMapLocation = async () => {
    await supabase.from('school_settings').upsert({
      id: 'primary', lat: tempLocation.lat, lng: tempLocation.lng,
    });
    setSchoolLocation(tempLocation);
    setIsMapOpen(false);
  };

  const saveGeofenceRadius = async () => {
    await supabase.from('school_settings').upsert({
      id: 'primary', lat: schoolLocation.lat, lng: schoolLocation.lng,
      geofence_radius: tempRadius,
    });
    setGeofenceRadius(tempRadius);
    setRadiusSaved(true);
    setTimeout(() => setRadiusSaved(false), 2000);
  };

  const handleTeacherDispatch = async (id: string) => {
    await supabase.from('students').update({ status: 'dispatched' }).eq('id', id);
  };

  const handleResetDemo = async () => {
    await supabase.from('students').update({ status: 'waiting' }).neq('status', 'waiting');
    setIsCheckedIn(false);
    setDistance(120);
  };

  // ── Parent Handlers ──
  const checkLocation = async () => {
    try {
      let perm = locationStatus;
      if (!perm || perm.status !== 'granted') perm = await requestLocationPermission();
      if (perm.status !== 'granted') { alert('Location permission denied'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      const dist = getDistanceFromLatLonInMeters(
        loc.coords.latitude, loc.coords.longitude, schoolLocation.lat, schoolLocation.lng
      );
      setDistance(Math.round(dist));
    } catch (err) {
      alert('Error getting location: ' + (err as Error).message);
    }
  };

  const handleParentCheckIn = async () => {
    if (!isCloseEnough) return;
    const { error } = await supabase
      .from('students').update({ status: 'dispatched' }).eq('parent_id', 'parent_001');
    if (!error) setIsCheckedIn(true);
  };

  // ─── RENDER ADMIN PORTAL ─────────────────────────────────────────────────
  const renderAdminView = () => {
    const waitingCount = students.filter(s => s.status === 'waiting').length;
    const dispatchedCount = students.filter(s => s.status === 'dispatched').length;
    const arrivedCount = students.filter(s => s.status === 'arrived').length;

    const filteredStudents = students.filter(s =>
      !searchQuery ||
      s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.parent_id?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getStatusStyle = (status: string) => {
      switch (status) {
        case 'dispatched': return { bg: '#d1e4ff', text: '#001d35' };
        case 'arrived': return { bg: '#b7d7ff', text: '#28496a' };
        default: return { bg: '#e2e2e4', text: '#43474d' };
      }
    };

    return (
      <View style={styles.adminShell}>
        {/* ── Sidebar (web only) ── */}
        {Platform.OS === 'web' && (
          <View style={styles.sidebar}>
          {/* Logo */}
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

          {/* Nav Links */}
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

          {/* Bottom Nav */}
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

          {/* ── Top Header ── */}
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

          {/* ── Dashboard Canvas ── */}
          <ScrollView
            style={styles.canvas}
            contentContainerStyle={{ paddingBottom: 48 }}
          >

            {/* KPI Row */}
            <View style={styles.kpiRow}>
              {[
                { label: 'TOTAL STUDENTS', value: String(students.length || 842), sub: '+12 since morning', subColor: '#416183', icon: '👥' },
                { label: 'ACTIVE DISMISSALS', value: String(dispatchedCount), sub: 'In progress', subColor: '#416183', icon: '🚶' },
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

              {/* ── Live Dispatch Logs Table ── */}
              <View style={styles.logsPanel}>
                <View style={styles.logsPanelHeader}>
                  <Text style={styles.panelTitle}>Live Dispatch Logs</Text>
                  <View style={styles.logsHeaderRight}>
                    <Pressable style={styles.filterBtn} onPress={handleResetDemo}>
                      <Text style={styles.filterBtnText}>🔄 Reset Demo</Text>
                    </Pressable>
                    <Pressable style={styles.filterBtn}>
                      <Text style={styles.filterBtnText}>⚙ Filter</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Table Header */}
                <View style={styles.tableHeader}>
                  {['Timestamp', 'Student Name', 'Guardian', 'Gate', 'Distance', 'Status'].map((h) => (
                    <Text key={h} style={[styles.tableHead, h === 'Student Name' ? { flex: 2 } : {}]}>{h}</Text>
                  ))}
                </View>

                {/* Table Rows */}
                {filteredStudents.length > 0 ? filteredStudents.map((item) => {
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
                        {item.status === 'dispatched' ? '—' : `${Math.round(Math.random() * 200 + 40)}m`}
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
                  // Demo rows if no data
                  [
                    { ts: '14:32:05', name: 'Emma Thompson', guardian: 'Sarah T. (Mom)', gate: 'North Gate', dist: '120m', status: 'Arrived', bg: '#b7d7ff', tc: '#28496a' },
                    { ts: '14:31:12', name: 'Liam Davis', guardian: 'Michael D. (Dad)', gate: 'South Gate', dist: '250m', status: 'Waiting', bg: '#e2e2e4', tc: '#43474d' },
                    { ts: '14:28:45', name: 'Sophia Martinez', guardian: 'Elena M. (Aunt)', gate: 'East Gate', dist: '—', status: 'Dispatched', bg: '#d1e4ff', tc: '#001d35' },
                    { ts: '14:25:30', name: 'Jackson Lee', guardian: 'David L. (Dad)', gate: 'North Gate', dist: '80m', status: 'Arrived', bg: '#b7d7ff', tc: '#28496a' },
                  ].map((row, i) => (
                    <View key={i} style={styles.tableRow}>
                      <Text style={[styles.tableCell, styles.tableCellMuted]}>{row.ts}</Text>
                      <Text style={[styles.tableCell, styles.tableCellBold, { flex: 2 }]}>{row.name}</Text>
                      <Text style={styles.tableCell}>{row.guardian}</Text>
                      <Text style={styles.tableCell}>{row.gate}</Text>
                      <Text style={[styles.tableCell, { color: '#466179' }]}>{row.dist}</Text>
                      <View style={styles.tableCell}>
                        <View style={[styles.statusPill, { backgroundColor: row.bg }]}>
                          <Text style={[styles.statusPillText, { color: row.tc }]}>{row.status}</Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* ── Geofence Controls Panel ── */}
              <View style={styles.controlsPanel}>
                <View style={styles.controlsPanelHeader}>
                  <Text style={{ fontSize: 28 }}>📡</Text>
                  <Text style={styles.panelTitle}>Geofence{'\n'}Controls</Text>
                </View>
                <Text style={styles.controlsDesc}>
                  Adjust the detection radius for automatic arrival triggers.
                </Text>

                {/* Radius Slider */}
                <View style={styles.sliderSection}>
                  <View style={styles.sliderLabels}>
                    <Text style={styles.sliderMinMax}>50m</Text>
                    <Text style={styles.sliderValue}>{tempRadius}m</Text>
                    <Text style={styles.sliderMinMax}>500m</Text>
                  </View>
                  {Platform.OS === 'web' ? (
                    // @ts-ignore
                    <input
                      type="range"
                      min="50"
                      max="500"
                      value={tempRadius}
                      onChange={(e: any) => setTempRadius(Number(e.target.value))}
                      style={{ width: '100%', height: 6, accentColor: SLATE_PRIMARY, cursor: 'pointer', marginTop: 4 }}
                    />
                  ) : (
                    // Fallback tap buttons for native
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                      {[50, 100, 150, 200, 300, 500].map(v => (
                        <Pressable
                          key={v}
                          style={[styles.radiusChip, tempRadius === v && styles.radiusChipActive]}
                          onPress={() => setTempRadius(v)}
                        >
                          <Text style={[styles.radiusChipText, tempRadius === v && { color: '#fff' }]}>{v}m</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                {/* Map Pin Button */}
                <Pressable style={styles.mapPinBtn} onPress={() => setIsMapOpen(true)}>
                  <Text style={styles.mapPinBtnText}>📍 Set School Gate Pin on Map</Text>
                </Pressable>

                <Text style={styles.pinCoordsText}>
                  📌 {schoolLocation.lat.toFixed(4)}, {schoolLocation.lng.toFixed(4)}
                </Text>

                {/* Save Button */}
                <Pressable
                  style={[styles.saveBtn, radiusSaved && { backgroundColor: '#10B981' }]}
                  onPress={saveGeofenceRadius}
                >
                  <Text style={styles.saveBtnText}>
                    {radiusSaved ? '✅ Saved!' : '💾 Save Configuration'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>

        {/* ── Map Modal ── */}
        {isMapOpen && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>📍 Set School Gate Location</Text>
              <Text style={styles.modalSub}>Click anywhere on the map to move the school gate pin.</Text>
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
                  <Text style={{ textAlign: 'center', marginTop: 20, color: '#767779' }}>
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
      </View>
    );
  };

  // ─── RENDER PARENT APP ───────────────────────────────────────────────────
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
              <Pressable style={styles.simControlBtn} onPress={() => setDistance(geofenceRadius + 70)}>
                <Text style={styles.simControlText}>Far ({geofenceRadius + 70}m)</Text>
              </Pressable>
              <Pressable style={styles.simControlBtn} onPress={() => setDistance(Math.round(geofenceRadius * 0.3))}>
                <Text style={styles.simControlText}>Near ({Math.round(geofenceRadius * 0.3)}m)</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.childrenSection}>
            <Text style={styles.childrenHeader}>My Students</Text>
            {(parentChildren.length > 0 ? parentChildren : [
              { id: '1', name: 'Ayesha Malik', grade: 'Grade 5-A', gate: 'Gate A', status: 'waiting' },
              { id: '2', name: 'Bilal Malik', grade: 'Grade 3-B', gate: 'Gate B', status: 'waiting' },
            ]).map((child: any, index: number) => {
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
              {isCheckedIn ? '✅ Checked In' : isCloseEnough ? '🚗 Slide to Check-In' : `Too far (${distance}m / ${geofenceRadius}m needed)`}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return currentView === 'admin' ? renderAdminView() : renderParentView();
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const SLATE_PRIMARY = '#466179';
const SLATE_LIGHT = '#b0cce8';
const SURFACE = '#f9f9fb';
const WHITE = '#ffffff';
const BORDER = '#c3c7cd';
const TEXT_PRIMARY = '#1a1c1d';
const TEXT_MUTED = '#767779';
const SIDEBAR_W = Platform.OS === 'web' ? 260 : 0;

const styles = StyleSheet.create({
  // ── Admin Shell ──
  adminShell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: SURFACE,
  },

  // ── Sidebar ──
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: SLATE_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: SLATE_PRIMARY,
    lineHeight: 22,
  },
  logoSub: {
    fontSize: 16,
    fontWeight: '700',
    color: SLATE_PRIMARY,
    lineHeight: 18,
  },
  logoCampus: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 2,
  },
  navLinks: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 4,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  navItemActive: {
    backgroundColor: '#b7d7ff',
  },
  navIcon: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  navLabel: {
    fontSize: 14,
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  navLabelActive: {
    color: '#28496a',
    fontWeight: '700',
  },
  sidebarBottom: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 4,
  },

  // ── Main Content ──
  mainContent: {
    flex: 1,
    flexDirection: 'column',
  },

  // ── Top Header ──
  topHeader: {
    height: 64,
    backgroundColor: WHITE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    zIndex: 30,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8e8ea',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
    width: Platform.OS === 'web' ? 340 : 200,
    gap: 8,
  },
  searchIcon: { fontSize: 16 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: TEXT_PRIMARY,
  },
  searchInputWeb: {
    flex: 1,
    fontSize: 14,
    color: TEXT_PRIMARY,
    fontFamily: 'Inter, sans-serif',
  } as any,
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  gpsStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#b7d7ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
    gap: 6,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  gpsStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#28496a',
  },
  avatarBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: SLATE_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: SLATE_PRIMARY,
  },
  clockText: {
    fontSize: 18,
    fontWeight: '700',
    color: SLATE_PRIMARY,
  },

  // ── Canvas / Dashboard ──
  canvas: {
    flex: 1,
    padding: 24,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  kpiCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    gap: 4,
  },
  kpiCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    flex: 1,
    flexWrap: 'wrap',
  },
  kpiIcon: { fontSize: 20 },
  kpiValue: {
    fontSize: 32,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    lineHeight: 38,
  },
  kpiSub: {
    fontSize: 12,
    fontWeight: '500',
  },

  // ── Middle Split ──
  splitRow: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },

  // ── Logs Panel ──
  logsPanel: {
    flex: 2,
    minWidth: 320,
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  logsPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: SURFACE,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  logsHeaderRight: {
    flexDirection: 'row',
    gap: 8,
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#e8e8ea',
  },
  filterBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: SLATE_PRIMARY,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f4f3f5',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tableHead: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f2',
  },
  tableCell: {
    flex: 1,
    fontSize: 13,
    color: TEXT_PRIMARY,
  },
  tableCellMuted: {
    color: TEXT_MUTED,
  },
  tableCellBold: {
    fontWeight: '600',
  },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Controls Panel ──
  controlsPanel: {
    flex: 1,
    minWidth: 260,
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  controlsPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  controlsDesc: {
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 18,
  },
  sliderSection: {
    gap: 8,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderMinMax: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  sliderValue: {
    fontSize: 22,
    fontWeight: '800',
    color: SLATE_PRIMARY,
  },
  sliderWeb: {
    width: '100%',
    height: 6,
    marginTop: 4,
  } as any,
  radiusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#e8e8ea',
    borderWidth: 1,
    borderColor: BORDER,
  },
  radiusChipActive: {
    backgroundColor: SLATE_PRIMARY,
  },
  radiusChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_MUTED,
  },
  mapPinBtn: {
    backgroundColor: '#e8f0f8',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: SLATE_LIGHT,
    alignItems: 'center',
  },
  mapPinBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: SLATE_PRIMARY,
  },
  pinCoordsText: {
    fontSize: 11,
    color: TEXT_MUTED,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: SLATE_PRIMARY,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnText: {
    color: WHITE,
    fontSize: 14,
    fontWeight: '700',
  },

  // ── Map Modal ──
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 30, 50, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 28,
    width: '90%',
    maxWidth: 640,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginBottom: 16,
  },
  mapBox: {
    height: 400,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#e8e8ea',
    marginBottom: 12,
  },
  coordsPreview: {
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelBtn: {
    backgroundColor: '#e8e8ea',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  cancelBtnText: {
    color: TEXT_MUTED,
    fontWeight: '600',
    fontSize: 14,
  },
  confirmBtn: {
    backgroundColor: SLATE_PRIMARY,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  confirmBtnText: {
    color: WHITE,
    fontWeight: '700',
    fontSize: 14,
  },

  // ── Parent View ──
  parentContainer: {
    flex: 1,
    backgroundColor: SURFACE,
    ...Platform.select({ web: { paddingTop: 80 } }),
  },
  parentTopBar: {
    height: 64,
    backgroundColor: WHITE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 20,
  },
  parentTopTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: SLATE_PRIMARY,
  },
  parentHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  parentSwitchBtn: {
    backgroundColor: SLATE_PRIMARY,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  parentSwitchBtnText: {
    color: WHITE,
    fontSize: 12,
    fontWeight: '600',
  },
  avatarContainer: {
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: '#e2e2e4',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  parentMain: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  heroSection: {
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  heroIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: SLATE_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroDistance: {
    fontSize: 52,
    fontWeight: '800',
    color: SLATE_PRIMARY,
    lineHeight: 60,
  },
  heroSubtitle: {
    fontSize: 16,
    color: TEXT_MUTED,
    marginTop: 4,
  },
  geofenceHint: {
    fontSize: 12,
    color: SLATE_PRIMARY,
    fontWeight: '600',
    marginTop: 6,
    backgroundColor: SLATE_LIGHT,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  gpsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8e8ea',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 9999,
    marginTop: 16,
    gap: 8,
  },
  gpsPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  gpsButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#416183',
    letterSpacing: 0.5,
  },
  simControlsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  simControlBtn: {
    backgroundColor: '#e2e2e4',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  simControlText: {
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_MUTED,
  },
  childrenSection: {
    gap: 12,
  },
  childrenHeader: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    marginBottom: 4,
  },
  childRow: {
    backgroundColor: WHITE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  childColorStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
  },
  childAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e2e2e4',
    overflow: 'hidden',
  },
  childInfo: { flex: 1 },
  childName: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  childGrade: {
    fontSize: 13,
    color: TEXT_MUTED,
  },
  childStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  childStatusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  bottomActionArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(249, 249, 251, 0.92)',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    zIndex: 20,
  },
  checkInActionBtn: {
    height: 60,
    borderRadius: 30,
    backgroundColor: SLATE_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkInDisabled: {
    backgroundColor: '#e8e8ea',
  },
  checkInSuccess: {
    backgroundColor: '#10B981',
  },
  checkInActionText: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_MUTED,
  },
});