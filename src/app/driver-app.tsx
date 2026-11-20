import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../../supabase';
import { getDriverSession, setDriverSession } from './driver-login';
import { isSessionError, rpcMessage, useBranch, useBranchPings } from '../lib/tenant';
import { DepartureTracker, POLL_SECONDS, haversine, judgeFix } from '../lib/departure';
import {
  ActionBar, AppBar, Button, Card, DistancePanel, Loading, Notice, Page, PausedNotice, SectionHeader,
  StudentRow, color, space, type,
} from '../lib/ui';

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
  const token = getDriverSession()?.token ?? '';
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
  const [autoConfirmed, setAutoConfirmed] = useState(false);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const trackerRef = useRef(new DepartureTracker());

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

    fetchData();

    return () => {
      stopAutoPoll();
    };
  }, []);

  // ── Live updates: refetch on the campus ping for students / driver accounts ──
  useBranchPings(branchId, what => {
    if (what === 'students' || what === 'transporter_accounts') fetchData();
  });

  // Students + the driver's current route come from the server (route edits by the admin apply live).
  const fetchData = async () => {
    try {
      const { data, error } = await supabase.rpc('driver_state', { p_token: token });
      if (error) throw error;
      const linked: string[] = data?.driver?.linked_parent_ids ?? [];
      linkedParentIdsRef.current = linked;
      setDriverInfo(prev => (prev ? { ...prev, linkedParentIds: linked } : prev));
      setStudents(data?.students ?? []);
      // Do NOT read last_distance_meters (that is the parents' location)
    } catch (e: any) {
      if (isSessionError(e)) handleLogout();
      else console.error('[driverFetchData]', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRpcError = (e: any, prefix: string) => {
    if (isSessionError(e)) { handleLogout(); return; }
    setNotice(`${prefix}: ${rpcMessage(e)}`);
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
    if (!(dispatchedStudents.length > 0 && branchLive)) { stopAutoPoll(); return; }
    startAutoPoll();
    // Browsers pause timers in background tabs: check again as soon as the page is visible.
    if (Platform.OS !== 'web') return;
    const onVisible = () => { if (document.visibilityState === 'visible') silentLocationCheck(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [dispatchedStudents.length, branchLive]);

  // Being measured inside the pickup zone is what makes a later departure count.
  useEffect(() => {
    if (distance != null && distance <= geofenceRadius) trackerRef.current.noteInside();
  }, [distance, geofenceRadius]);

  const startAutoPoll = () => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(() => {
      silentLocationCheck();
    }, POLL_SECONDS * 1000);
  };

  const stopAutoPoll = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    trackerRef.current.reset();
  };

  const silentLocationCheck = async () => {
    if (!linkedParentIdsRef.current.length) return;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setLocationWarning('Location access is off, so pickup can’t be confirmed automatically. Allow location, or confirm pickup yourself.');
        return;
      }
      setLocationWarning(null);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const dist = haversine(
        loc.coords.latitude, loc.coords.longitude,
        schoolLocationRef.current.lat, schoolLocationRef.current.lng
      );
      // Clearly outside the pickup zone on consecutive checks → the children are in the vehicle.
      const verdict = judgeFix(dist, loc.coords.accuracy, geofenceRadiusRef.current);
      if (trackerRef.current.feed(verdict)) await markKidsReceived(true);
    } catch (e: any) {
      if (isSessionError(e)) handleLogout();
      else console.warn('[AutoPoll] Driver location check failed:', e.message);
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
      // Server re-checks the campus status and the geofence radius.
      const { error } = await supabase.rpc('driver_check_in', { p_token: token, p_meters: distance });
      if (error) throw error;
      fetchData();
    } catch (e: any) {
      handleRpcError(e, 'Check-in didn’t go through');
    } finally {
      setDispatching(false);
    }
  };

  // ── Kids Arrived — driver confirms kids have boarded ──
  const markKidsReceived = async (auto = false) => {
    const { error } = await supabase.rpc('driver_mark_received', { p_token: token });
    if (error) throw error;
    if (auto) setAutoConfirmed(true);
    stopAutoPoll();
    fetchData();
  };

  const handleKidsArrived = async () => {
    if (!driverInfo) return;
    setKidsArrivedLoading(true);
    try {
      await markKidsReceived();
    } catch (e: any) {
      handleRpcError(e, 'Couldn’t confirm pickup');
    } finally {
      setKidsArrivedLoading(false);
    }
  };

  const handleLogout = () => {
    stopAutoPoll();
    if (token) supabase.rpc('app_logout', { p_token: token }).then(() => {}, () => {});
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
          {autoConfirmed
            ? `We noticed you left the school area, so all ${receivedCount} children were confirmed as picked up.`
            : `The school has been told all ${receivedCount} children were picked up.`}
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
          {locationWarning && dispatchedCount > 0 ? <Notice tone="warn">{locationWarning}</Notice> : null}

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
            onSimulate={branch?.demo_mode ? updateDistance : undefined}
            footnote={dispatchedCount > 0
              ? 'Keep this page open. When you drive away from the school, pickup is confirmed automatically.'
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
