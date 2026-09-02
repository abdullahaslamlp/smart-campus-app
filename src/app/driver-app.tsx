import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator, Alert, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../../supabase';
import { getDriverSession, setDriverSession } from './driver-login';

const SLATE = '#466179';
const SLATE_DARK = '#2d3f50';
const WHITE = '#ffffff';
const SURFACE = '#f4f7fb';
const BORDER = '#c3c7cd';
const GREEN_DARK = '#065F46';
const GREEN_BG = '#D1FAE5';

// ─── Haversine Distance Formula ────────────────────────────────────────────────
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

interface Student {
  id: string;
  name: string;
  grade?: string;
  gate?: string;
  parent_id: string;
  status: 'waiting' | 'dispatched' | 'arrived';
  last_distance_meters?: number | null;
}

export default function DriverApp() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [driverInfo, setDriverInfo] = useState<{
    driverId: string;
    driverName: string;
    vehicleType: string;
    vehicleNumber: string;
    linkedParentIds: string[];
  } | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [distance, setDistance] = useState<number | null>(null);
  const [schoolLocation, setSchoolLocation] = useState({ lat: 31.4501, lng: 74.3012 });
  const [geofenceRadius, setGeofenceRadius] = useState(150);
  const [dispatching, setDispatching] = useState(false);
  const [locationStatus, requestLocationPermission] = Location.useForegroundPermissions();
  const [gpsLoading, setGpsLoading] = useState(false);

  useEffect(() => {
    const s = getDriverSession();
    if (!s) {
      router.replace('/driver-login' as any);
      return;
    }
    setAuthed(true);
    setDriverInfo(s);

    // Restore driver's own distance from session storage if present
    try {
      if (typeof window !== 'undefined') {
        const saved = window.sessionStorage?.getItem('driver_dist_' + s.driverId);
        if (saved) setDistance(Number(saved));
      }
    } catch {}

    fetchData(s.linkedParentIds);
    fetchSettings();

    // ── Realtime subscription to students table (for status dispatch sync) ──
    const sub = supabase
      .channel('driver_students_' + s.driverId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        fetchData(s.linkedParentIds);
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, []);

  const fetchData = async (pids: string[]) => {
    if (!pids || pids.length === 0) {
      setStudents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .in('parent_id', pids);
      if (error) throw error;
      setStudents(data || []);
      // Do NOT read last_distance_meters from students table because that is the parent's location!
    } catch (e: any) {
      console.error('[driverFetchData]', e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const { data } = await supabase
        .from('school_settings').select('*').eq('id', 'primary').single();
      if (data) {
        setSchoolLocation({ lat: data.lat, lng: data.lng });
        if (data.geofence_radius) setGeofenceRadius(data.geofence_radius);
      }
    } catch (e: any) {
      console.error('[driverFetchSettings]', e.message);
    }
  };

  // ── Update driver distance (driver's own location, independent from parent's) ──
  const updateDistance = (newDist: number) => {
    setDistance(newDist);
    try {
      if (typeof window !== 'undefined' && driverInfo?.driverId) {
        window.sessionStorage?.setItem('driver_dist_' + driverInfo.driverId, String(newDist));
      }
    } catch {}
  };

  // ── Get Driver's Real Live GPS Location ──
  const checkRealGPS = async () => {
    setGpsLoading(true);
    try {
      let perm = locationStatus;
      if (!perm || perm.status !== 'granted') perm = await requestLocationPermission();
      if (perm.status !== 'granted') {
        Alert.alert('Location Access Required', 'Please enable location permissions on your phone to track driver GPS.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const dist = haversine(
        loc.coords.latitude, loc.coords.longitude,
        schoolLocation.lat, schoolLocation.lng
      );
      const roundedDist = Math.round(dist);
      await updateDistance(roundedDist);
      Alert.alert('📍 GPS Location Updated', `Real Distance to School Gate: ${roundedDist} meters`);
    } catch (e: any) {
      Alert.alert('GPS Error', e.message);
    } finally {
      setGpsLoading(false);
    }
  };

  // ── Check if driver is within allowed geofence distance ──
  const isCloseEnough = distance !== null && distance <= geofenceRadius;

  // ── Dispatch all waiting students assigned to this driver ──
  const handleCheckInAll = async () => {
    if (!driverInfo || !driverInfo.linkedParentIds.length) return;
    if (!isCloseEnough) {
      Alert.alert(
        '🚫 Geofence Restriction',
        `Your distance is ${distance ?? '—'}m from the school gate. You must be within ${geofenceRadius}m to notify the gate!`
      );
      return;
    }
    const waitingKids = students.filter(s => s.status === 'waiting');
    if (waitingKids.length === 0) {
      Alert.alert('Notice', 'All assigned students have already been dispatched!');
      return;
    }

    setDispatching(true);
    try {
      const { error } = await supabase
        .from('students')
        .update({ status: 'dispatched' })
        .in('parent_id', driverInfo.linkedParentIds)
        .eq('status', 'waiting');
      if (error) throw error;
    } catch (e: any) {
      Alert.alert('Check-in failed', e.message);
    } finally {
      setDispatching(false);
    }
  };

  const handleLogout = () => {
    setDriverSession(null);
    router.replace('/');
  };

  if (!authed || !driverInfo) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={GREEN_DARK} size="large" />
      </View>
    );
  }

  const waitingCount = students.filter(s => s.status === 'waiting').length;
  const dispatchedCount = students.filter(s => s.status === 'dispatched' || s.status === 'arrived').length;

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.vehicleBadge}>
            <Text style={{ fontSize: 20 }}>🛺</Text>
          </View>
          <View>
            <Text style={styles.topName}>{driverInfo.driverName}</Text>
            <Text style={styles.topVehicle}>{driverInfo.vehicleType} • {driverInfo.vehicleNumber}</Text>
          </View>
        </View>
        <Pressable style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Logout</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 130 }}>

        {/* ── Status Card ── */}
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Assigned Route Students</Text>
          <Text style={styles.heroSub}>
            Linked to {driverInfo.linkedParentIds.length} Parents ({students.length} Total Students)
          </Text>

          <View style={styles.statRow}>
            <View style={[styles.statBox, { backgroundColor: '#fef3c7' }]}>
              <Text style={[styles.statNum, { color: '#b45309' }]}>{waitingCount}</Text>
              <Text style={[styles.statLabel, { color: '#b45309' }]}>Waiting</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: GREEN_BG }]}>
              <Text style={[styles.statNum, { color: GREEN_DARK }]}>{dispatchedCount}</Text>
              <Text style={[styles.statLabel, { color: GREEN_DARK }]}>Dispatched</Text>
            </View>
          </View>

          {/* Real GPS button & simulator */}
          <View style={{ width: '100%', gap: 8, marginTop: 4, alignItems: 'center' }}>
            <Pressable
              style={[styles.gpsBtn, gpsLoading && { opacity: 0.7 }]}
              onPress={checkRealGPS}
              disabled={gpsLoading}
            >
              {gpsLoading ? (
                <ActivityIndicator color={WHITE} size="small" />
              ) : (
                <Text style={styles.gpsBtnText}>📍 Get My Live GPS Distance</Text>
              )}
            </Pressable>

            {distance != null && (
              <Text style={{ fontSize: 14, fontWeight: '800', color: isCloseEnough ? GREEN_DARK : '#c0392b' }}>
                Current Distance to Gate: {distance} meters
              </Text>
            )}

            {/* Geofence Status Badge */}
            <View style={[styles.radiusBadge, { backgroundColor: isCloseEnough ? GREEN_BG : '#fee2e2' }]}>
              <Text style={[styles.radiusBadgeText, { color: isCloseEnough ? GREEN_DARK : '#c0392b' }]}>
                {distance == null
                  ? `📍 Set location to check in (Geofence Max: ${geofenceRadius}m)`
                  : isCloseEnough
                    ? `✅ Within range (${distance}m ≤ ${geofenceRadius}m)`
                    : `⚠️ Outside Geofence Area (${distance}m > ${geofenceRadius}m max)`}
              </Text>
            </View>

            <View style={styles.simRow}>
              <Text style={{ fontSize: 11, color: '#767779', fontWeight: '600' }}>Simulate Distance:</Text>
              {[500, 150, 50].map(m => (
                <Pressable key={m} style={[styles.simBtn, distance === m && styles.simBtnActive]} onPress={() => updateDistance(m)}>
                  <Text style={[styles.simBtnText, distance === m && { color: WHITE }]}>{m}m</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* ── Student Roster ── */}
        <Text style={styles.sectionTitle}>Students List</Text>

        {loading ? (
          <ActivityIndicator color={GREEN_DARK} />
        ) : students.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No parents assigned to your vehicle yet.</Text>
            <Text style={styles.emptySubText}>Ask admin to link parents to your driver ID ({driverInfo.driverId}).</Text>
          </View>
        ) : (
          students.map(item => {
            const isDispatched = item.status === 'dispatched' || item.status === 'arrived';
            return (
              <View key={item.id} style={[styles.childCard, isDispatched && { borderColor: '#10B981', backgroundColor: '#f0fdf4' }]}>
                <View style={[styles.childStripe, { backgroundColor: isDispatched ? '#10B981' : '#f59e0b' }]} />
                <View style={styles.childAvatar}>
                  <Text style={{ fontSize: 24 }}>👦</Text>
                </View>
                <View style={styles.childInfo}>
                  <Text style={styles.childName}>{item.name}</Text>
                  <Text style={styles.childMeta}>{item.grade || 'Student'} • Parent: {item.parent_id}</Text>
                  {isDispatched ? (
                    <Text style={{ fontSize: 11, color: GREEN_DARK, fontWeight: '700', marginTop: 2 }}>
                      ✓ Dispatched / Ready at Gate ({item.gate || 'Gate A'})
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 11, color: '#b45309', fontWeight: '600', marginTop: 2 }}>
                      ⏳ Waiting for pickup signal
                    </Text>
                  )}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: isDispatched ? GREEN_BG : '#fef3c7' }]}>
                  <Text style={[styles.statusText, { color: isDispatched ? GREEN_DARK : '#b45309' }]}>
                    {isDispatched ? 'DISPATCHED' : 'WAITING'}
                  </Text>
                </View>
              </View>
            );
          })
        )}

      </ScrollView>

      {/* ── Check-in Action Bar ── */}
      <View style={styles.bottomBar}>
        <Pressable
          style={[
            styles.checkInBtn,
            (!isCloseEnough || waitingCount === 0 || dispatching) && styles.checkInDisabled,
          ]}
          onPress={handleCheckInAll}
          disabled={!isCloseEnough || waitingCount === 0 || dispatching}
        >
          {dispatching ? (
            <ActivityIndicator color={WHITE} />
          ) : (
            <Text style={[styles.checkInBtnText, (!isCloseEnough || waitingCount === 0) && { color: '#767779' }]}>
              {waitingCount === 0
                ? '✓ All Students Dispatched'
                : !isCloseEnough
                  ? `🚫 Too Far — Must be ≤${geofenceRadius}m (${distance ?? '—'}m)`
                  : `🛺 Notify Gate for All (${waitingCount} Waiting)`}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE },
  topBar: {
    backgroundColor: WHITE,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 14 : 44,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  vehicleBadge: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: GREEN_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  topName: { fontSize: 16, fontWeight: '700', color: GREEN_DARK },
  topVehicle: { fontSize: 12, color: '#767779' },
  logoutBtn: { backgroundColor: '#fee2e2', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  logoutBtnText: { color: '#c0392b', fontSize: 13, fontWeight: '700' },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  heroCard: {
    backgroundColor: WHITE, borderRadius: 16, padding: 20,
    alignItems: 'center', gap: 12, marginBottom: 20,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  heroTitle: { fontSize: 18, fontWeight: '800', color: GREEN_DARK },
  heroSub: { fontSize: 13, color: '#767779', textAlign: 'center' },
  statRow: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 4 },
  statBox: { flex: 1, borderRadius: 12, padding: 14, alignItems: 'center' },
  statNum: { fontSize: 26, fontWeight: '800' },
  statLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  gpsBtn: { backgroundColor: GREEN_DARK, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, alignSelf: 'stretch', alignItems: 'center' },
  gpsBtnText: { color: WHITE, fontWeight: '700', fontSize: 14 },
  radiusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  radiusBadgeText: { fontSize: 12, fontWeight: '700' },
  simRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  simBtn: { backgroundColor: '#e8e8ea', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6 },
  simBtnActive: { backgroundColor: GREEN_DARK },
  simBtnText: { fontSize: 11, fontWeight: '600', color: '#767779' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: GREEN_DARK, marginBottom: 12 },
  emptyCard: { backgroundColor: WHITE, borderRadius: 14, padding: 28, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: BORDER },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#767779' },
  emptySubText: { fontSize: 12, color: '#aaa', textAlign: 'center' },
  childCard: {
    backgroundColor: WHITE, borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
  },
  childStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  childAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f0f0f2', alignItems: 'center', justifyContent: 'center' },
  childInfo: { flex: 1 },
  childName: { fontSize: 16, fontWeight: '700', color: '#1a1c1d' },
  childMeta: { fontSize: 12, color: '#767779', marginTop: 2 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '800' },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(244,247,251,0.95)',
    borderTopWidth: 1, borderTopColor: BORDER,
    padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    zIndex: 10,
  },
  checkInBtn: {
    height: 56, borderRadius: 28, backgroundColor: GREEN_DARK,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: GREEN_DARK, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  checkInDisabled: { backgroundColor: '#cbd5e1' },
  checkInBtnText: { fontSize: 16, fontWeight: '700', color: WHITE },
});
