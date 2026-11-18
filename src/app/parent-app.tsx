import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../../supabase';
import { getParentSession, setParentSession } from './parent-login';
import { isSessionError, rpcMessage, useBranch, useBranchPings } from '../lib/tenant';
import {
  ActionBar, AppBar, Button, Card, DistancePanel, Loading, Notice, Page, PausedNotice, SectionHeader,
  StudentRow, color, space, type,
} from '../lib/ui';

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

export default function ParentApp() {
  const router = useRouter();

  // ── Auth guard ──
  const session = getParentSession();
  const [authed, setAuthed] = useState(!!session);
  const [currentParentId, setCurrentParentId] = useState(session?.parentId ?? '');
  const [currentFullName, setCurrentFullName] = useState(session?.fullName ?? '');
  const branchId = session?.branchId ?? '';
  const token = session?.token ?? '';
  const { branch, loading: branchLoading, live: branchLive } = useBranch(branchId);

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
  const [checkingIn, setCheckingIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

    return () => {
      stopAutoPoll();
    };
  }, []);

  // ── Live updates: the campus broadcasts a contentless ping on every change ──
  useBranchPings(branchId, what => {
    if (what === 'students') fetchData(currentParentIdRef.current);
  });

  // A session the server no longer accepts (expired, account deactivated) signs the parent out.
  const handleRpcError = (e: any, prefix: string) => {
    if (isSessionError(e)) { handleLogout(); return; }
    setNotice(`${prefix}: ${rpcMessage(e)}`);
  };

  // ── Start / stop auto-poll based on dispatched state ──
  useEffect(() => {
    if (isCheckedIn && !isReceived && branchLive) {
      startAutoPoll();
    } else {
      stopAutoPoll();
    }
  }, [isCheckedIn, isReceived, branchLive]);

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
        await markKidsReceived();
      }
    } catch (e: any) {
      if (isSessionError(e)) handleLogout();
      else console.warn('[AutoPoll] Location check failed:', e.message);
    }
  };

  const fetchData = async (_pid?: string) => {
    setLoadingStudents(true);
    try {
      const { data: state, error } = await supabase.rpc('parent_state', { p_token: token });
      if (error) throw error;
      const data: any[] = state?.students ?? [];
      setStudents(data);
      // Sync status flags from DB — resets when admin clears status
      const dispatched = (data || []).some((s: any) => s.status === 'dispatched');
      const received = (data || []).some((s: any) => s.status === 'received');
      setIsCheckedIn(dispatched || received);
      setIsReceived(received);
      // Restore last known distance; reset to null if admin cleared it
      const distRow = (data || []).find((s: any) => s.last_distance_meters != null);
      setDistance(distRow ? distRow.last_distance_meters : null);
    } catch (e: any) {
      if (isSessionError(e)) handleLogout();
      else console.error('[fetchData]', e.message);
    } finally {
      setLoadingStudents(false);
    }
  };

  // ── Geofence settings come from the user's branch (updates live) ──
  useEffect(() => {
    if (!branch) return;
    setSchoolLocation({ lat: branch.lat, lng: branch.lng });
    schoolLocationRef.current = { lat: branch.lat, lng: branch.lng };
    setGeofenceRadius(branch.geofence_radius);
    geofenceRadiusRef.current = branch.geofence_radius;
  }, [branch]);

  // ── Stop the departure poll the moment the campus is paused ──
  useEffect(() => {
    if (branch && !branchLive) stopAutoPoll();
  }, [branch, branchLive]);

  // ─── Distance update (GPS real + simulation) ──────────────────────────────
  const updateDistance = async (newDist: number) => {
    setDistance(newDist);
    try {
      const { error } = await supabase.rpc('parent_set_distance', { p_token: token, p_meters: newDist });
      if (error) throw error;
    } catch (e: any) {
      if (isSessionError(e)) handleLogout();
      else console.error('[updateDistance]', e.message);
    }
  };

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
      const loc = await Location.getCurrentPositionAsync({});
      const dist = haversine(
        loc.coords.latitude, loc.coords.longitude,
        schoolLocation.lat, schoolLocation.lng
      );
      await updateDistance(Math.round(dist));
    } catch (e: any) {
      setNotice(`Couldn’t get your location: ${e.message}`);
    } finally {
      setGpsLoading(false);
    }
  };

  // ─── Check-in (arrive at school) ──────────────────────────────────────────
  const handleCheckIn = async () => {
    if (!branchLive || distance == null || distance > geofenceRadius) return;
    setNotice(null);
    setCheckingIn(true);
    try {
      // Server re-checks the campus status and the geofence radius.
      const { error } = await supabase.rpc('parent_check_in', { p_token: token, p_meters: distance });
      if (error) throw error;
      setIsCheckedIn(true);
      fetchData();
    } catch (e: any) {
      handleRpcError(e, 'Check-in didn’t go through');
    } finally {
      setCheckingIn(false);
    }
  };

  // ─── Kids Arrived (kids boarded, parent leaving school) ───────────────────
  const markKidsReceived = async (_pid?: string) => {
    const { error } = await supabase.rpc('parent_mark_received', { p_token: token });
    if (error) throw error;
    setIsReceived(true);
    stopAutoPoll();
    fetchData();
  };

  const handleKidsArrived = async () => {
    setKidsArrivedLoading(true);
    try {
      await markKidsReceived();
    } catch (e: any) {
      handleRpcError(e, 'Couldn’t confirm pickup');
    } finally {
      setKidsArrivedLoading(false);
    }
  };

  // ─── Logout ───────────────────────────────────────────────────────────────
  const handleLogout = () => {
    stopAutoPoll();
    if (token) supabase.rpc('app_logout', { p_token: token }).then(() => {}, () => {});
    setParentSession(null);
    router.replace('/');
  };

  const isCloseEnough = distance != null && distance <= geofenceRadius;

  if (authed && !branchLoading && !branchLive) {
    return <PausedNotice branch={branch} onExit={handleLogout} />;
  }

  if (!authed || branchLoading) return <Loading />;

  const firstName = currentFullName.split(' ')[0] || 'there';
  const sentCount = students.filter(c => c.status === 'dispatched' || c.status === 'arrived').length;

  const renderAction = () => {
    if (isReceived) {
      return (
        <Notice tone="success" title="Pickup confirmed">
          The school has been told your children are with you.
        </Notice>
      );
    }
    if (isCheckedIn) {
      return (
        <>
          <Text style={[type.small, { textAlign: 'center' }]}>
            {sentCount > 0 ? `${sentCount} ${sentCount === 1 ? 'child is' : 'children are'} on the way to the gate.` : 'The school has been notified.'}
          </Text>
          <Button label="I have my children" variant="success" size="lg" full
            onPress={handleKidsArrived} loading={kidsArrivedLoading} />
        </>
      );
    }
    return (
      <Button
        label={isCloseEnough ? 'I’m at the school — check in' : `Check-in opens within ${geofenceRadius} m`}
        size="lg" full disabled={!isCloseEnough} loading={checkingIn} onPress={handleCheckIn}
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <AppBar
        title={`Hello, ${firstName}`}
        subtitle={branch ? `${branch.school_name} · ${branch.name}` : currentParentId}
        right={<Button label="Sign out" variant="ghost" size="sm" onPress={handleLogout} />}
      />

      <Page bottomInset={140}>
        <View style={{ gap: space.md }}>
          {notice ? <Notice tone="error">{notice}</Notice> : null}
          <DistancePanel
            distance={distance}
            radius={geofenceRadius}
            locating={gpsLoading}
            onLocate={checkRealGPS}
            onSimulate={updateDistance}
            footnote={isCheckedIn && !isReceived
              ? 'When you drive away from the school, pickup is confirmed automatically.'
              : undefined}
          />
        </View>

        <SectionHeader title="Your children" aside={students.length ? `${students.length}` : undefined} />
        {loadingStudents ? (
          <Card><Text style={type.small}>Loading…</Text></Card>
        ) : students.length === 0 ? (
          <Card>
            <Text style={type.body}>No children are linked to your account yet.</Text>
            <Text style={[type.small, { marginTop: space.xs }]}>Ask the school office to link them to {currentParentId}.</Text>
          </Card>
        ) : (
          <Card padded={false}>
            {students.map((child, i) => (
              <StudentRow
                key={child.id}
                name={child.name}
                meta={[child.grade, child.gate].filter(Boolean).join(' · ') || '—'}
                status={child.status}
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
