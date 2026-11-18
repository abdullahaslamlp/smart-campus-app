import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../../supabase';
import { getDriverSession, setDriverSession } from './driver-login';
import { useBranch } from '../lib/tenant';
import {
  ActionBar, AppBar, Button, Card, DistancePanel, Loading, Notice, Page, PausedNotice, SectionHeader,
  StudentRow, color, space, type,
} from '../lib/ui';

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
  status: 'waiting' | 'dispatched' | 'arrived' | 'received';
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
    branchId: string;
    branchName: string;
    schoolName: string;
  } | null>(null);
  const branchId = getDriverSession()?.branchId ?? '';
  const { branch, loading: branchLoading, live: branchLive } = useBranch(branchId);

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [distance, setDistance] = useState<number | null>(null);
  const [schoolLocation, setSchoolLocation] = useState({ lat: 31.4501, lng: 74.3012 });
  const [geofenceRadius, setGeofenceRadius] = useState(150);
  const [dispatching, setDispatching] = useState(false);
  const [kidsArrivedLoading, setKidsArrivedLoading] = useState(false);
  const [locationStatus, requestLocationPermission] = Location.useForegroundPermissions();
  const [gpsLoading, setGpsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // ── Refs for auto-poll ──
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geofenceRadiusRef = useRef(geofenceRadius);
  const schoolLocationRef = useRef(schoolLocation);
  const linkedParentIdsRef = useRef<string[]>([]);

  // Keep refs in sync
  useEffect(() => { geofenceRadiusRef.current = geofenceRadius; }, [geofenceRadius]);
  useEffect(() => { schoolLocationRef.current = schoolLocation; }, [schoolLocation]);

  useEffect(() => {
    const s = getDriverSession();
    if (!s) {
      router.replace('/driver-login' as any);
      return;
    }
    setAuthed(true);
    setDriverInfo(s);
    linkedParentIdsRef.current = s.linkedParentIds;

    // Restore driver's own distance from session storage if present
    try {
      if (typeof window !== 'undefined') {
        const saved = window.sessionStorage?.getItem('driver_dist_' + s.driverId);
        if (saved) setDistance(Number(saved));
      }
    } catch {}

    fetchData(s.linkedParentIds);

    // ── Realtime subscription to this branch's students ──
    const sub = supabase
      .channel('driver_students_' + s.branchId + '_' + s.driverId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: `branch_id=eq.${s.branchId}` }, () => {
        fetchData(s.linkedParentIds);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
      stopAutoPoll();
    };
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
        .eq('branch_id', branchId)
        .in('parent_id', pids);
      if (error) throw error;
      setStudents(data || []);
      // Do NOT read last_distance_meters from students table (that is the parent's location)
    } catch (e: any) {
      console.error('[driverFetchData]', e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Geofence settings come from the driver's branch (updates live) ──
  useEffect(() => {
    if (!branch) return;
    setSchoolLocation({ lat: branch.lat, lng: branch.lng });
    schoolLocationRef.current = { lat: branch.lat, lng: branch.lng };
    setGeofenceRadius(branch.geofence_radius);
    geofenceRadiusRef.current = branch.geofence_radius;
  }, [branch]);

  // ── Auto-poll: start when any student is dispatched but not yet received ──
  const dispatchedStudents = students.filter(s => s.status === 'dispatched');
  const receivedStudents = students.filter(s => s.status === 'received');
  const allDispatched = dispatchedStudents.length > 0 || receivedStudents.length > 0;
  const allReceived = dispatchedStudents.length === 0 && receivedStudents.length > 0 && students.filter(s => s.status === 'waiting').length === 0;

  useEffect(() => {
    if (dispatchedStudents.length > 0 && branchLive) {
      startAutoPoll();
    } else {
      stopAutoPoll();
    }
  }, [dispatchedStudents.length, branchLive]);

  const startAutoPoll = () => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(() => {
      silentLocationCheck();
    }, 30000);
  };

  const stopAutoPoll = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const silentLocationCheck = async () => {
    if (!linkedParentIdsRef.current.length) return;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const dist = haversine(
        loc.coords.latitude, loc.coords.longitude,
        schoolLocationRef.current.lat, schoolLocationRef.current.lng
      );
      const rounded = Math.round(dist);
      // If driver has left the geofence → kids are safely in vehicle, auto-mark received
      if (rounded > geofenceRadiusRef.current) {
        await markKidsReceived(linkedParentIdsRef.current);
      }
    } catch (e: any) {
      console.warn('[AutoPoll] Driver location check failed:', e.message);
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
    setNotice(null);
    setGpsLoading(true);
    try {
      let perm = locationStatus;
      if (!perm || perm.status !== 'granted') perm = await requestLocationPermission();
      if (perm.status !== 'granted') {
        setNotice('Location access is needed to check in. Allow it in your browser or phone settings.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const dist = haversine(
        loc.coords.latitude, loc.coords.longitude,
        schoolLocation.lat, schoolLocation.lng
      );
      const roundedDist = Math.round(dist);
      await updateDistance(roundedDist);
    } catch (e: any) {
      setNotice(`Couldn’t get your location: ${e.message}`);
    } finally {
      setGpsLoading(false);
    }
  };

  const isCloseEnough = distance !== null && distance <= geofenceRadius;

  // ── Dispatch all waiting students assigned to this driver ──
  const handleCheckInAll = async () => {
    if (!branchLive || !driverInfo || !driverInfo.linkedParentIds.length) return;
    if (!isCloseEnough) {
      setNotice(`You’re ${distance ?? '—'} m from the gate. Check-in opens within ${geofenceRadius} m.`);
      return;
    }
    const waitingKids = students.filter(s => s.status === 'waiting');
    if (waitingKids.length === 0) {
      setNotice('Every child on your route has already been sent to the gate.');
      return;
    }

    setNotice(null);
    setDispatching(true);
    try {
      const { error } = await supabase
        .from('students')
        .update({ status: 'dispatched' })
        .eq('branch_id', branchId)
        .in('parent_id', driverInfo.linkedParentIds)
        .eq('status', 'waiting');
      if (error) throw error;
    } catch (e: any) {
      setNotice(`Check-in didn’t go through: ${e.message}`);
    } finally {
      setDispatching(false);
    }
  };

  // ── Kids Arrived — driver confirms kids have boarded ──
  const markKidsReceived = async (pids: string[]) => {
    try {
      const { error } = await supabase
        .from('students')
        .update({ status: 'received' })
        .eq('branch_id', branchId)
        .in('parent_id', pids)
        .eq('status', 'dispatched');
      if (error) throw error;
      stopAutoPoll();
    } catch (e: any) {
      console.error('[markKidsReceived]', e.message);
      throw e;
    }
  };

  const handleKidsArrived = async () => {
    if (!driverInfo) return;
    setKidsArrivedLoading(true);
    try {
      await markKidsReceived(driverInfo.linkedParentIds);
    } catch (e: any) {
      setNotice(`Couldn’t confirm pickup: ${e.message}`);
    } finally {
      setKidsArrivedLoading(false);
    }
  };

  const handleLogout = () => {
    stopAutoPoll();
    setDriverSession(null);
    router.replace('/');
  };

  if (authed && !branchLoading && !branchLive) {
    return <PausedNotice branch={branch} onExit={handleLogout} />;
  }

  if (!authed || !driverInfo || branchLoading) return <Loading />;

  const waitingCount = students.filter(s => s.status === 'waiting').length;
  const dispatchedCount = students.filter(s => s.status === 'dispatched').length;
  const receivedCount = students.filter(s => s.status === 'received').length;

  const renderAction = () => {
    if (allReceived) {
      return (
        <Notice tone="success" title="Everyone is on board">
          The school has been told all {receivedCount} children were picked up.
        </Notice>
      );
    }
    if (dispatchedCount > 0) {
      return (
        <>
          <Text style={[type.small, { textAlign: 'center' }]}>
            {dispatchedCount} {dispatchedCount === 1 ? 'child is' : 'children are'} on the way to the gate.
          </Text>
          <Button label={`Confirm pickup (${dispatchedCount})`} variant="success" size="lg" full
            onPress={handleKidsArrived} loading={kidsArrivedLoading} />
        </>
      );
    }
    if (waitingCount === 0) {
      return <Text style={[type.small, { textAlign: 'center', paddingVertical: space.md }]}>No children waiting on your route.</Text>;
    }
    return (
      <Button
        label={isCloseEnough ? `Check in for ${waitingCount} ${waitingCount === 1 ? 'child' : 'children'}` : `Check-in opens within ${geofenceRadius} m`}
        size="lg" full disabled={!isCloseEnough} loading={dispatching} onPress={handleCheckInAll}
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <AppBar
        title={driverInfo.driverName}
        subtitle={[driverInfo.vehicleType, driverInfo.vehicleNumber, branch?.name].filter(Boolean).join(' · ')}
        right={<Button label="Sign out" variant="ghost" size="sm" onPress={handleLogout} />}
      />

      <Page bottomInset={140}>
        <View style={{ gap: space.md }}>
          {notice ? <Notice tone="error">{notice}</Notice> : null}

          <Card padded={false} style={{ flexDirection: 'row' }}>
            {[
              { label: 'In class', value: waitingCount, fg: color.waiting },
              { label: 'Sent to gate', value: dispatchedCount, fg: color.sent },
              { label: 'Picked up', value: receivedCount, fg: color.done },
            ].map((x, i) => (
              <View key={x.label} style={{
                flex: 1, paddingVertical: space.md, paddingHorizontal: space.md, gap: 2,
                borderLeftWidth: i ? 1 : 0, borderLeftColor: color.border,
              }}>
                <Text style={{ fontSize: 24, fontWeight: '700', color: x.fg, fontVariant: ['tabular-nums'] }}>{x.value}</Text>
                <Text style={type.small}>{x.label}</Text>
              </View>
            ))}
          </Card>

          <DistancePanel
            distance={distance}
            radius={geofenceRadius}
            locating={gpsLoading}
            onLocate={checkRealGPS}
            onSimulate={updateDistance}
            footnote={dispatchedCount > 0
              ? 'When you drive away from the school, pickup is confirmed automatically.'
              : undefined}
          />
        </View>

        <SectionHeader
          title="Your route"
          aside={`${driverInfo.linkedParentIds.length} ${driverInfo.linkedParentIds.length === 1 ? 'family' : 'families'} · ${students.length} children`}
        />
        {loading ? (
          <Card><Text style={type.small}>Loading…</Text></Card>
        ) : students.length === 0 ? (
          <Card>
            <Text style={type.body}>No families are assigned to your route yet.</Text>
            <Text style={[type.small, { marginTop: space.xs }]}>Ask the school office to add them to {driverInfo.driverId}.</Text>
          </Card>
        ) : (
          <Card padded={false}>
            {students.map((item, i) => (
              <StudentRow
                key={item.id}
                name={item.name}
                meta={[item.grade, item.gate, item.parent_id].filter(Boolean).join(' · ')}
                status={item.status}
                last={i === students.length - 1}
              />
            ))}
          </Card>
        )}
      </Page>

      <ActionBar>{renderAction()}</ActionBar>
    </View>
  );
}
