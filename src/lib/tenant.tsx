// Shared multi-tenant helpers: session storage, branch search, live branch status, paused screen.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../supabase';

// ─── Session storage (web: sessionStorage; native: in-memory) ────────────────
const memory: Record<string, string> = {};

export function saveSession<T>(key: string, value: T | null) {
  const raw = value ? JSON.stringify(value) : null;
  if (raw) memory[key] = raw; else delete memory[key];
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    if (raw) sessionStorage.setItem(key, raw); else sessionStorage.removeItem(key);
  }
}

export function loadSession<T>(key: string): T | null {
  let raw: string | null = memory[key] ?? null;
  if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
    raw = sessionStorage.getItem(key) ?? raw;
  }
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// Remember the last picked campus on this device (convenience only).
const LAST_BRANCH_KEY = 'safepass_last_branch';
export function rememberBranch(b: BranchOption | null) {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      if (b) localStorage.setItem(LAST_BRANCH_KEY, JSON.stringify(b)); else localStorage.removeItem(LAST_BRANCH_KEY);
    }
  } catch {}
}
export function lastBranch(): BranchOption | null {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LAST_BRANCH_KEY);
      return raw ? JSON.parse(raw) : null;
    }
  } catch {}
  return null;
}

// ─── Types ───────────────────────────────────────────────────────────────────
export type BranchStatus = 'active' | 'paused' | 'archived';

export interface BranchOption {
  branch_id: string;
  branch_code: string;
  branch_name: string;
  school_name: string;
  status: BranchStatus;
}

export interface BranchInfo {
  id: string;
  code: string;
  name: string;
  school_id: string;
  school_name: string;
  status: BranchStatus;
  lat: number;
  lng: number;
  geofence_radius: number;
}

export const PAUSED_MESSAGE = 'This campus portal is temporarily paused. Please contact administration.';

export const LOGIN_ERRORS: Record<string, string> = {
  no_branch: 'That campus could not be found. Please pick it again.',
  paused: PAUSED_MESSAGE,
  not_found: 'No account found with that ID at this campus.',
  inactive: 'Your account has been deactivated. Contact the school office.',
  bad_password: 'Incorrect password. Please try again.',
};

export async function searchBranches(query: string): Promise<BranchOption[]> {
  const { data, error } = await supabase.rpc('search_branches', { p_query: query });
  if (error) throw error;
  return (data || []) as BranchOption[];
}

export async function fetchBranch(branchId: string): Promise<BranchInfo | null> {
  const { data, error } = await supabase.rpc('get_branch', { p_branch_id: branchId });
  if (error) throw error;
  return (data as BranchInfo) ?? null;
}

// ─── Live branch status ──────────────────────────────────────────────────────
// Re-reads the branch whenever its row or its school's row changes, so a pause
// in the Super Admin portal blocks an already-open app immediately.
const BRANCH_POLL_MS = 15000;

export function useBranch(branchId: string | null | undefined) {
  const [branch, setBranch] = useState<BranchInfo | null>(null);
  const [loading, setLoading] = useState(!!branchId);

  useEffect(() => {
    if (!branchId) { setLoading(false); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const b = await fetchBranch(branchId);
        if (!cancelled) setBranch(b);
      } catch (e: any) {
        console.error('[useBranch]', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    const ch = supabase
      .channel('branch_status_' + branchId + '_' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branches', filter: `id=eq.${branchId}` }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'schools' }, load)
      .subscribe();

    // Fallback: Realtime delivery is not guaranteed, so re-check status periodically.
    const poll = setInterval(load, BRANCH_POLL_MS);

    return () => { cancelled = true; clearInterval(poll); supabase.removeChannel(ch); };
  }, [branchId]);

  const live = !!branch && branch.status === 'active';
  return { branch, loading, live };
}

// ─── Paused / unavailable screen ─────────────────────────────────────────────
export function PausedScreen({ branch, onExit }: { branch: BranchInfo | null; onExit: () => void }) {
  return (
    <View style={ps.root}>
      <View style={ps.card}>
        <Text style={{ fontSize: 44 }}>⏸️</Text>
        <Text style={ps.title}>Campus Portal Paused</Text>
        {branch ? <Text style={ps.sub}>{branch.school_name} — {branch.name}</Text> : null}
        <Text style={ps.msg}>{branch ? PAUSED_MESSAGE : 'This campus is no longer available. Please contact administration.'}</Text>
        <Pressable style={ps.btn} onPress={onExit}>
          <Text style={ps.btnText}>← Back to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── School / branch search picker ───────────────────────────────────────────
export function BranchPicker({ value, onChange }: { value: BranchOption | null; onChange: (b: BranchOption | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BranchOption[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (value) return;
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchBranches(query);
        if (!cancelled) setResults(r);
      } catch (e: any) {
        console.error('[BranchPicker]', e.message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, value]);

  if (value) {
    return (
      <View style={bp.selected}>
        <View style={{ flex: 1 }}>
          <Text style={bp.selSchool}>{value.school_name}</Text>
          <Text style={bp.selBranch}>{value.branch_name} · {value.branch_code}</Text>
        </View>
        <Pressable onPress={() => onChange(null)} style={bp.changeBtn}>
          <Text style={bp.changeText}>Change</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      {Platform.OS === 'web' ? (
        // @ts-ignore
        <input
          style={{ ...bp.inputWeb, outline: 'none', boxSizing: 'border-box' } as any}
          placeholder="Search your school or campus…"
          value={query}
          onChange={(e: any) => setQuery(e.target.value)}
        />
      ) : (
        <TextInput
          style={bp.input}
          placeholder="Search your school or campus…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          placeholderTextColor="#aaa"
        />
      )}
      <View style={bp.list}>
        {searching ? (
          <ActivityIndicator color="#466179" style={{ padding: 12 }} />
        ) : results.length === 0 ? (
          <Text style={bp.empty}>No campuses found.</Text>
        ) : results.map(r => (
          <Pressable key={r.branch_id} style={bp.row} onPress={() => onChange(r)}>
            <View style={{ flex: 1 }}>
              <Text style={bp.rowSchool}>{r.school_name}</Text>
              <Text style={bp.rowBranch}>{r.branch_name} · {r.branch_code}</Text>
            </View>
            {r.status === 'paused' ? <Text style={bp.paused}>PAUSED</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const ps = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f4f7fb', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 420, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#c3c7cd' },
  title: { fontSize: 22, fontWeight: '800', color: '#2d3f50' },
  sub: { fontSize: 13, color: '#767779', fontWeight: '600' },
  msg: { fontSize: 15, color: '#2d3f50', textAlign: 'center', lineHeight: 22 },
  btn: { marginTop: 8, backgroundColor: '#466179', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  btnText: { color: '#fff', fontWeight: '700' },
});

const bp = StyleSheet.create({
  input: { borderWidth: 1.5, borderColor: '#c3c7cd', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1a1c1d', backgroundColor: '#fafafa' },
  inputWeb: { borderWidth: 1.5, borderStyle: 'solid', borderColor: '#c3c7cd', borderRadius: 10, paddingLeft: 14, paddingRight: 14, height: 46, fontSize: 15, color: '#1a1c1d', backgroundColor: '#fafafa', fontFamily: 'inherit', width: '100%' } as any,
  list: { borderWidth: 1, borderColor: '#e3e6ea', borderRadius: 10, maxHeight: 200, overflow: 'scroll' as any },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f2f4' },
  rowSchool: { fontSize: 14, fontWeight: '700', color: '#2d3f50' },
  rowBranch: { fontSize: 12, color: '#767779' },
  paused: { fontSize: 10, fontWeight: '800', color: '#b45309', backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  empty: { padding: 12, color: '#aaa', fontSize: 13, textAlign: 'center' },
  selected: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8f0f8', borderRadius: 10, padding: 12 },
  selSchool: { fontSize: 15, fontWeight: '800', color: '#2d3f50' },
  selBranch: { fontSize: 12, color: '#466179', marginTop: 2 },
  changeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  changeText: { color: '#466179', fontWeight: '700', fontSize: 13 },
});
