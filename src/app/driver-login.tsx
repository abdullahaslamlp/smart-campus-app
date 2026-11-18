import { useState } from 'react';
import { useRouter } from 'expo-router';
import { supabase } from '../../supabase';
import { LOGIN_ERRORS, loadSession, rememberBranch, saveSession } from '../lib/tenant';
import { AuthLayout, Button, CampusPicker, Notice, PasswordField, TextField } from '../lib/ui';
import { useInitialBranch } from './parent-login';

// ─── Simple session store (web: sessionStorage; native: module-level var) ──────
export type DriverSession = {
  driverId: string;
  driverName: string;
  vehicleType: string;
  vehicleNumber: string;
  linkedParentIds: string[];
  branchId: string;
  branchName: string;
  schoolName: string;
};

const DRIVER_KEY = 'driverSession_v2';

export function setDriverSession(s: DriverSession | null) {
  saveSession(DRIVER_KEY, s);
}

export function getDriverSession(): DriverSession | null {
  const s = loadSession<DriverSession>(DRIVER_KEY);
  return s && s.branchId ? s : null;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function DriverLogin() {
  const router = useRouter();
  const [branch, setBranch] = useInitialBranch();
  const [driverId, setDriverId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    const trimId = driverId.trim().toLowerCase();
    const trimPw = password.trim();
    if (!branch) {
      setError('Choose your school first.');
      return;
    }
    if (!trimId || !trimPw) {
      setError('Enter your Driver ID and password.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      // ── Server-side check: campus live, account active, password hash ──
      const { data, error: dbErr } = await supabase.rpc('login_driver', {
        p_branch_id: branch.branch_id, p_driver_id: trimId, p_password: trimPw,
      });
      if (dbErr) {
        setError('Couldn’t reach the server. Check your connection and try again.');
        console.error('[driverLogin]', dbErr.message);
        return;
      }
      if (!data?.ok) {
        setError(LOGIN_ERRORS[data?.error] ?? 'Sign-in failed. Please try again.');
        return;
      }

      // Store session and navigate to driver portal app
      rememberBranch(branch);
      setDriverSession({
        driverId: data.driver_id,
        driverName: data.driver_name,
        vehicleType: data.vehicle_type,
        vehicleNumber: data.vehicle_number,
        linkedParentIds: data.linked_parent_ids || [],
        branchId: data.branch_id,
        branchName: branch.branch_name,
        schoolName: branch.school_name,
      });
      router.replace('/driver-app' as any);

    } catch (e: any) {
      setError('Something went wrong. Please try again.');
      console.error('[driverLogin]', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Driver sign in"
      subtitle="For vans, rickshaws and carpools collecting children on a route."
      onBack={() => router.replace('/')}
      footer="Your route and the families on it are set up by the school office."
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      <CampusPicker value={branch} onChange={setBranch} />
      <TextField
        label="Driver ID"
        placeholder="e.g. driver_001"
        value={driverId}
        onChangeText={setDriverId}
        autoComplete="username"
        returnKeyType="next"
      />
      <PasswordField
        label="Password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={handleLogin}
        returnKeyType="go"
      />
      <Button label="Sign in" size="lg" onPress={handleLogin} loading={loading} full />
    </AuthLayout>
  );
}
