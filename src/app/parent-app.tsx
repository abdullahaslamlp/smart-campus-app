import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator, Alert, Platform,
  Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../../supabase';
import { getParentSession, setParentSession } from './parent-login';

// ─── Haversine Distance ────────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SLATE = '#466179';
const SLATE_DARK = '#2d3f50';
const SLATE_LIGHT = '#b0cce8';
const WHITE = '#ffffff';
const SURFACE = '#f4f7fb';
const BORDER = '#c3c7cd';
const GREEN_DARK = '#065F46';
const GREEN_BG = '#D1FAE5';
const INDIGO = '#4338CA';
const INDIGO_BG = '#E0E7FF';

export default function ParentApp() {
  const router = useRouter();

  // ── Auth guard ──
  const session = getParentSession();
  const [authed, setAuthed] = useState(!!session);
  const [currentParentId, setCurrentParentId] = useState(session?.parentId ?? '');
  const [currentFullName, setCurrentFullName] = useState(session?.fullName ?? '');

  // ── Data state ──
  const [students, setStudents] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [geofenceRadius, setGeofenceRadius] = useState(150);
  const [schoolLocation, setSchoolLocation] = useState({ lat: 31.4501, lng: 74.3012 });
  const [distance, setDistance] = useState<number | null>(null);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [isReceived, setIsReceived] = useState(false);
  const [locationStatus, requestLocationPermission] = Location.useForegroundPermissions();
  const [gpsLoading, setGpsLoading] = useState(false);
  const [kidsArrivedLoading, setKidsArrivedLoading] = useState(false);

  // ── Refs for auto-poll ──
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geofenceRadiusRef = useRef(geofenceRadius);
  const schoolLocationRef = useRef(schoolLocation);
  const isReceivedRef = useRef(isReceived);
  const currentParentIdRef = useRef(currentParentId);

  // Keep refs in sync with state
  useEffect(() => { geofenceRadiusRef.current = geofenceRadius; }, [geofenceRadius]);
  useEffect(() => { schoolLocationRef.current = schoolLocation; }, [schoolLocation]);
  useEffect(() => { isReceivedRef.current = isReceived; }, [isReceived]);
  useEffect(() => { currentParentIdRef.current = currentParentId; }, [currentParentId]);

  // ── On mount: redirect if not authenticated ──
  useEffect(() => {
    const s = getParentSession();
    if (!s) {
      router.replace('/parent-login');
      return;
    }
    setAuthed(true);
    setCurrentParentId(s.parentId);
    setCurrentFullName(s.fullName);
    currentParentIdRef.current = s.parentId;
    fetchData(s.parentId);
    fetchSettings();

    const sub = supabase
      .channel('parent_students_' + s.parentId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        fetchData(s.parentId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
      stopAutoPoll();
    };
  }, []);

  // ── Start / stop auto-poll based on dispatched state ──
  useEffect(() => {
    if (isCheckedIn && !isReceived) {
      startAutoPoll();
    } else {
      stopAutoPoll();
    }
  }, [isCheckedIn, isReceived]);

  const startAutoPoll = () => {
    if (pollIntervalRef.current) return; // already polling
    pollIntervalRef.current = setInterval(() => {
      silentLocationCheck();
    }, 30000); // every 30 seconds
  };

  const stopAutoPoll = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  // ── Silent location check (used by auto-poll) ──
  const silentLocationCheck = async () => {
    if (isReceivedRef.current) {
      stopAutoPoll();
      return;
    }
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const dist = haversine(
        loc.coords.latitude, loc.coords.longitude,
        schoolLocationRef.current.lat, schoolLocationRef.current.lng
      );
      const rounded = Math.round(dist);
      // If parent has driven outside the geofence → kids have boarded, auto-mark received
      if (rounded > geofenceRadiusRef.current) {
        await markKidsReceived(currentParentIdRef.current);
      }
    } catch (e: any) {
      console.warn('[AutoPoll] Location check failed:', e.message);
    }
  };

  const fetchData = async (pid: string) => {
    setLoadingStudents(true);
    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('parent_id', pid);
      if (error) throw error;
      setStudents(data || []);
      // Sync status flags from DB — resets when admin clears status
      const dispatched = (data || []).some((s: any) => s.status === 'dispatched');
      const received = (data || []).some((s: any) => s.status === 'received');
      setIsCheckedIn(dispatched || received);
      setIsReceived(received);
      // Restore last known distance; reset to null if admin cleared it
      const distRow = (data || []).find((s: any) => s.last_distance_meters != null);
      setDistance(distRow ? distRow.last_distance_meters : null);
    } catch (e: any) {
      console.error('[fetchData]', e.message);
    } finally {
      setLoadingStudents(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const { data } = await supabase
        .from('school_settings').select('*').eq('id', 'primary').single();
      if (data) {
        setSchoolLocation({ lat: data.lat, lng: data.lng });
        schoolLocationRef.current = { lat: data.lat, lng: data.lng };
        if (data.geofence_radius) {
          setGeofenceRadius(data.geofence_radius);
          geofenceRadiusRef.current = data.geofence_radius;
        }
      }
    } catch (e: any) {
      console.error('[fetchSettings]', e.message);
    }
  };

  // ─── Distance update (GPS real + simulation) ──────────────────────────────
  const updateDistance = async (newDist: number) => {
    setDistance(newDist);
    try {
      await supabase
        .from('students')
        .update({ last_distance_meters: newDist })
        .eq('parent_id', currentParentId);
    } catch (e: any) {
      console.error('[updateDistance]', e.message);
    }
  };

  const checkRealGPS = async () => {
    setGpsLoading(true);
    try {
      let perm = locationStatus;
      if (!perm || perm.status !== 'granted') perm = await requestLocationPermission();
      if (perm.status !== 'granted') {
        Alert.alert('Permission denied', 'Location permission is required to check in.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const dist = haversine(
        loc.coords.latitude, loc.coords.longitude,
        schoolLocation.lat, schoolLocation.lng
      );
      await updateDistance(Math.round(dist));
    } catch (e: any) {
      Alert.alert('GPS error', e.message);
    } finally {
      setGpsLoading(false);
    }
  };

  // ─── Check-in (arrive at school) ──────────────────────────────────────────
  const handleCheckIn = async () => {
    if (distance == null || distance > geofenceRadius) return;
    try {
      const { error } = await supabase
        .from('students')
        .update({ status: 'dispatched' })
        .eq('parent_id', currentParentId);
      if (error) throw error;
      setIsCheckedIn(true);
    } catch (e: any) {
      Alert.alert('Check-in failed', e.message);
    }
  };

  // ─── Kids Arrived (kids boarded, parent leaving school) ───────────────────
  const markKidsReceived = async (pid: string) => {
    try {
      const { error } = await supabase
        .from('students')
        .update({ status: 'received' })
        .eq('parent_id', pid)
        .eq('status', 'dispatched');
      if (error) throw error;
      setIsReceived(true);
      stopAutoPoll();
    } catch (e: any) {
      console.error('[markKidsReceived]', e.message);
    }
  };

  const handleKidsArrived = async () => {
    setKidsArrivedLoading(true);
    try {
      await markKidsReceived(currentParentId);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setKidsArrivedLoading(false);
    }
  };

  // ─── Logout ───────────────────────────────────────────────────────────────
  const handleLogout = () => {
    stopAutoPoll();
    setParentSession(null);
    router.replace('/');
  };

  const isCloseEnough = distance != null && distance <= geofenceRadius;

  if (!authed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={SLATE} size="large" />
      </View>
    );
  }

  // ── Bottom bar content ──
  const renderBottomBar = () => {
    if (isReceived) {
      return (
        <View style={styles.receivedCard}>
          <Text style={styles.receivedIcon}>🏠</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.receivedTitle}>Kids Safely Received!</Text>
            <Text style={styles.receivedSub}>Admin & guards have been notified.</Text>
          </View>
        </View>
      );
    }

    if (isCheckedIn) {
      return (
        <Pressable
          style={[styles.checkInBtn, { backgroundColor: INDIGO }]}
          onPress={handleKidsArrived}
          disabled={kidsArrivedLoading}
        >
          {kidsArrivedLoading
            ? <ActivityIndicator color={WHITE} />
            : <Text style={styles.checkInBtnText}>🧒 Kids Arrived — Tap to Confirm</Text>
          }
        </Pressable>
      );
    }

    return (
      <Pressable
        style={[
          styles.checkInBtn,
          !isCloseEnough && styles.checkInDisabled,
        ]}
        onPress={handleCheckIn}
        disabled={!isCloseEnough}
      >
        <Text style={[
          styles.checkInBtnText,
          !isCloseEnough && { color: '#767779' },
        ]}>
          {isCloseEnough
            ? '🚗 Check In for Dismissal'
            : `Too far — need ≤${geofenceRadius}m`}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.topGreeting}>Hello, {currentFullName.split(' ')[0]} 👋</Text>
          <Text style={styles.topId}>{currentParentId}</Text>
        </View>
        <Pressable style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Logout</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 140 }}>

        {/* ── Distance Hero ── */}
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Text style={{ fontSize: 28 }}>📍</Text>
          </View>

          {distance == null ? (
            <>
              <Text style={styles.heroDistanceGray}>—</Text>
              <Text style={styles.heroSub}>No location recorded yet</Text>
            </>
          ) : (
            <>
              <Text style={[styles.heroDistance, { color: isCloseEnough ? '#10B981' : SLATE }]}>
                {distance}m
              </Text>
              <Text style={styles.heroSub}>from School Gate</Text>
              <View style={[styles.radiusBadge, { backgroundColor: isCloseEnough ? '#D1FAE5' : '#e8f0f8' }]}>
                <Text style={[styles.radiusBadgeText, { color: isCloseEnough ? '#065F46' : SLATE }]}>
                  {isCloseEnough ? '✅ Within range' : `Unlock at ≤${geofenceRadius}m`}
                </Text>
              </View>
            </>
          )}

          {/* GPS button */}
          <Pressable style={styles.gpsBtn} onPress={checkRealGPS} disabled={gpsLoading}>
            {gpsLoading
              ? <ActivityIndicator size="small" color={SLATE} />
              : <><View style={styles.gpsDot} /><Text style={styles.gpsBtnText}>UPDATE GPS LOCATION</Text></>
            }
          </Pressable>

          {/* Sim buttons */}
          <View style={styles.simRow}>
            <Pressable style={styles.simBtn} onPress={() => updateDistance(geofenceRadius + 70)}>
              <Text style={styles.simBtnText}>Far ({geofenceRadius + 70}m)</Text>
            </Pressable>
            <Pressable style={styles.simBtn} onPress={() => updateDistance(Math.round(geofenceRadius * 0.3))}>
              <Text style={styles.simBtnText}>Near ({Math.round(geofenceRadius * 0.3)}m)</Text>
            </Pressable>
          </View>

          {/* Auto-poll indicator */}
          {isCheckedIn && !isReceived && (
            <View style={styles.autoPollBadge}>
              <View style={styles.autoPollDot} />
              <Text style={styles.autoPollText}>
                Auto-detecting departure every 30s
              </Text>
            </View>
          )}
        </View>

        {/* ── My Children ── */}
        <Text style={styles.sectionTitle}>My Students</Text>

        {loadingStudents ? (
          <View style={{ padding: 32, alignItems: 'center' }}>
            <ActivityIndicator color={SLATE} />
            <Text style={{ color: '#aaa', marginTop: 8 }}>Loading your students…</Text>
          </View>
        ) : students.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={{ fontSize: 32 }}>📭</Text>
            <Text style={styles.emptyText}>No students linked to your account.</Text>
            <Text style={styles.emptySubText}>Contact the school office to link your children.</Text>
          </View>
        ) : students.map((child, idx) => {
          const dispatched = child.status === 'dispatched';
          const arrived = child.status === 'arrived';
          const received = child.status === 'received';
          const statusColor = received ? INDIGO : dispatched ? '#10B981' : arrived ? '#3B82F6' : '#F59E0B';
          const statusBg = received ? INDIGO_BG : dispatched ? '#D1FAE5' : arrived ? '#DBEAFE' : '#FEF3C7';
          const statusLabel = received ? 'RECEIVED 🏠' : dispatched ? 'DISPATCHED' : arrived ? 'ARRIVED' : 'IN CLASS';
          return (
            <View key={child.id} style={styles.childCard}>
              <View style={[styles.childStripe, { backgroundColor: statusColor }]} />
              <View style={styles.childAvatar}>
                <Text style={{ fontSize: 24 }}>{idx % 2 === 0 ? '👧' : '👦'}</Text>
              </View>
              <View style={styles.childInfo}>
                <Text style={styles.childName}>{child.name}</Text>
                <Text style={styles.childMeta}>{child.grade || 'Grade —'} • {child.gate || 'Gate —'}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
                <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* ── Bottom Action Bar ── */}
      <View style={styles.bottomBar}>
        {renderBottomBar()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE, ...Platform.select({ web: { paddingTop: 0 } }) },
  topBar: {
    height: 64, backgroundColor: WHITE,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 0 : 44,
    paddingBottom: Platform.OS === 'web' ? 0 : 10,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  topGreeting: { fontSize: 17, fontWeight: '700', color: SLATE_DARK },
  topId: { fontSize: 12, color: '#767779' },
  logoutBtn: { backgroundColor: '#fee2e2', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  logoutBtnText: { color: '#c0392b', fontSize: 13, fontWeight: '700' },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 20 },
  heroCard: {
    backgroundColor: WHITE, borderRadius: 20, padding: 28,
    alignItems: 'center', gap: 8, marginBottom: 24,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  heroIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: SLATE, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  heroDistance: { fontSize: 64, fontWeight: '800', lineHeight: 72 },
  heroDistanceGray: { fontSize: 64, fontWeight: '800', lineHeight: 72, color: '#ccc' },
  heroSub: { fontSize: 15, color: '#767779' },
  radiusBadge: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 99 },
  radiusBadgeText: { fontSize: 13, fontWeight: '700' },
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#e8f0f8', paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 99, marginTop: 8, gap: 8, minWidth: 180, justifyContent: 'center',
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  gpsBtnText: { fontSize: 12, fontWeight: '700', color: SLATE, letterSpacing: 0.5 },
  simRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  simBtn: { backgroundColor: '#e8e8ea', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 8 },
  simBtnText: { fontSize: 12, fontWeight: '600', color: '#767779' },
  autoPollBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef3c7', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99, marginTop: 4,
  },
  autoPollDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#f59e0b' },
  autoPollText: { fontSize: 11, fontWeight: '600', color: '#b45309' },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: SLATE_DARK, marginBottom: 12 },
  emptyCard: { backgroundColor: WHITE, borderRadius: 16, padding: 32, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: BORDER },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#767779' },
  emptySubText: { fontSize: 13, color: '#aaa', textAlign: 'center' },
  childCard: {
    backgroundColor: WHITE, borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 12,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  childStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6 },
  childAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#f0f0f2', alignItems: 'center', justifyContent: 'center' },
  childInfo: { flex: 1 },
  childName: { fontSize: 17, fontWeight: '700', color: SLATE_DARK },
  childMeta: { fontSize: 13, color: '#767779', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(244,247,251,0.95)',
    borderTopWidth: 1, borderTopColor: BORDER,
    padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    zIndex: 10,
  },
  checkInBtn: {
    height: 60, borderRadius: 30, backgroundColor: SLATE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: SLATE, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  checkInDisabled: { backgroundColor: '#e8e8ea' },
  checkInBtnText: { fontSize: 16, fontWeight: '700', color: WHITE },
  receivedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: GREEN_BG, borderRadius: 16,
    paddingHorizontal: 20, paddingVertical: 14,
    borderWidth: 1, borderColor: '#6ee7b7',
  },
  receivedIcon: { fontSize: 28 },
  receivedTitle: { fontSize: 15, fontWeight: '800', color: GREEN_DARK },
  receivedSub: { fontSize: 12, color: '#047857', marginTop: 2 },
});
