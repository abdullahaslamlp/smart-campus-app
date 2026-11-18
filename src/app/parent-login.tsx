import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../supabase';
import {
  BranchOption, LOGIN_ERRORS, lastBranch, loadSession, rememberBranch, saveSession, searchBranches,
} from '../lib/tenant';
import { AuthLayout, Button, CampusPicker, Notice, PasswordField, TextField } from '../lib/ui';

// ─── Simple session store (web: sessionStorage; native: module-level var) ──────
export type ParentSession = {
  parentId: string;
  fullName: string;
  branchId: string;
  branchName: string;
  schoolName: string;
};

const PARENT_KEY = 'parentSession_v2';

export function setParentSession(s: ParentSession | null) {
  saveSession(PARENT_KEY, s);
}

export function getParentSession(): ParentSession | null {
  const s = loadSession<ParentSession>(PARENT_KEY);
  return s && s.branchId ? s : null;
}

// Pre-select a campus from ?branch=CODE, falling back to the last one used on this device.
export function useInitialBranch() {
  const { branch } = useLocalSearchParams<{ branch?: string }>();
  const [selected, setSelected] = useState<BranchOption | null>(() => (branch ? null : lastBranch()));
  useEffect(() => {
    if (!branch) return;
    searchBranches(String(branch))
      .then(r => {
        const exact = r.find(b => b.branch_code.toLowerCase() === String(branch).toLowerCase());
        if (exact) setSelected(exact);
      })
      .catch(() => {});
  }, [branch]);
  return [selected, setSelected] as const;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ParentLogin() {
  const router = useRouter();
  const [branch, setBranch] = useInitialBranch();
  const [parentId, setParentId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    // ── Whitebox: basic client-side validation ──
    const trimId = parentId.trim().toLowerCase();
    const trimPw = password.trim();
    if (!branch) {
      setError('Choose your school first.');
      return;
    }
    if (!trimId || !trimPw) {
      setError('Enter your Parent ID and password.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      // ── Server-side check: campus live, account active, password hash ──
      const { data, error: dbErr } = await supabase.rpc('login_parent', {
        p_branch_id: branch.branch_id, p_parent_id: trimId, p_password: trimPw,
      });
      if (dbErr) {
        setError('Couldn’t reach the server. Check your connection and try again.');
        console.error('[login]', dbErr.message);
        return;
      }
      if (!data?.ok) {
        setError(LOGIN_ERRORS[data?.error] ?? 'Sign-in failed. Please try again.');
        return;
      }

      // ── Success: store session and navigate ──
      rememberBranch(branch);
      setParentSession({
        parentId: data.parent_id, fullName: data.full_name, branchId: data.branch_id,
        branchName: branch.branch_name, schoolName: branch.school_name,
      });
      router.replace('/parent-app');

    } catch (e: any) {
      setError('Something went wrong. Please try again.');
      console.error('[login]', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Parent sign in"
      subtitle="Use the Parent ID and password your school gave you."
      onBack={() => router.replace('/')}
      footer="Forgot your details? The school office can reset them."
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      <CampusPicker value={branch} onChange={setBranch} />
      <TextField
        label="Parent ID"
        placeholder="e.g. parent_001"
        value={parentId}
        onChangeText={setParentId}
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
