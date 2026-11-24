// Shared multi-tenant helpers: session storage, branch search, live branch status, paused screen.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
  /** Installation-demo switch: shows the simulate-distance shortcut in the parent and driver apps. */
  demo_mode?: boolean;
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
// in the Super Admin portal blocks an already-open app within a few seconds.
// ─── Polling that is gentle on the server ────────────────────────────────────
// Parents and drivers do not hold a live connection (a free Supabase plan allows only a
// couple of hundred at once). They poll instead, and the poll:
//   * runs at a fast rate only while something is happening, and a slow rate otherwise
//   * stops while the page or app is in the background
//   * refreshes once, immediately, when the user comes back
//   * is randomly offset and varied, so thousands of apps never hit the server together
const isBackground = () =>
  Platform.OS === 'web' ? typeof document !== 'undefined' && document.visibilityState === 'hidden' : AppState.currentState !== 'active';

/** Call `cb` whenever the page / app returns to the foreground. */
export function onForeground(cb: () => void): () => void {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return () => {};
    const handler = () => { if (document.visibilityState === 'visible') cb(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }
  const sub = AppState.addEventListener('change', state => { if (state === 'active') cb(); });
  return () => sub.remove();
}

export function usePoll(
  fn: () => void | Promise<void>,
  opts: { enabled: boolean; fast: boolean; fastMs: number; slowMs: number },
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // A returning user always gets fresh data, even when polling has stopped.
  useEffect(() => onForeground(() => { void fnRef.current(); }), []);

  useEffect(() => {
    if (!opts.enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const interval = () => (opts.fast ? opts.fastMs : opts.slowMs) * (0.8 + Math.random() * 0.4);
    const tick = async () => {
      if (stopped) return;
      if (!isBackground()) { try { await fnRef.current(); } catch { /* the caller reports its own errors */ } }
      if (!stopped) timer = setTimeout(tick, interval());
    };
    timer = setTimeout(tick, interval());
    return () => { stopped = true; clearTimeout(timer); };
  }, [opts.enabled, opts.fast, opts.fastMs, opts.slowMs]);
}

// Fallback status check. The live pings below cover urgent changes, so this can be slow;
// each client also starts at a random point so thousands of apps never poll in step.
const BRANCH_POLL_MS = 30000;

// ─── Change pings ────────────────────────────────────────────────────────────
// Database triggers broadcast an empty 'changed' event on topic 'branch:<id>'
// (payload: { what: <table name> }). No row data is sent; clients refetch
// through the token-checked RPCs. Returns an unsubscribe function.
//
// Every change at a campus reaches every open app there, and each app answers by
// reloading. Left alone, the work grows with (apps × changes) and a busy dismissal
// would flood the server. So pings are throttled per browser:
//   * one shared channel per campus, however many components listen
//   * pings are merged: a listener hears each kind of change at most once per window
//   * a random delay spreads the reloads of different apps over a couple of seconds
//   * at most one reload per PING_MIN_GAP_MS, which caps the load per app no matter
//     how fast changes arrive
export const PING_JITTER_MS = 2000;
export const PING_MIN_GAP_MS = 4000;

type PingListener = (what: string) => void;
interface PingHub {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<PingListener>;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  lastFire: number;
}
const hubs = new Map<string, PingHub>();

function flushHub(hub: PingHub) {
  hub.timer = null;
  hub.lastFire = Date.now();
  const kinds = [...hub.pending];
  hub.pending.clear();
  kinds.forEach(what => hub.listeners.forEach(fn => fn(what)));
}

function schedule(hub: PingHub) {
  if (hub.timer) return; // already scheduled: merge into that reload
  const earliest = hub.lastFire + PING_MIN_GAP_MS;
  const delay = Math.max(Math.random() * PING_JITTER_MS, earliest - Date.now());
  hub.timer = setTimeout(() => flushHub(hub), delay);
}

export function subscribeBranchPings(branchId: string, onPing: PingListener): () => void {
  let hub = hubs.get(branchId);
  if (!hub) {
    const created: PingHub = {
      channel: supabase.channel('branch:' + branchId), listeners: new Set(), pending: new Set(), timer: null, lastFire: 0,
    };
    created.channel
      .on('broadcast', { event: 'changed' }, msg => {
        created.pending.add(String(msg.payload?.what ?? ''));
        schedule(created);
      })
      .subscribe();
    hubs.set(branchId, created);
    hub = created;
  }
  hub.listeners.add(onPing);
  const mine = hub;
  return () => {
    mine.listeners.delete(onPing);
    if (mine.listeners.size === 0) {
      if (mine.timer) clearTimeout(mine.timer);
      supabase.removeChannel(mine.channel);
      hubs.delete(branchId);
    }
  };
}

// Subscribe for the lifetime of a component; the latest callback is always used.
export function useBranchPings(branchId: string | null | undefined, onPing: (what: string) => void) {
  const ref = useRef(onPing);
  ref.current = onPing;
  useEffect(() => {
    if (!branchId) return;
    return subscribeBranchPings(branchId, what => ref.current(what));
  }, [branchId]);
}

// ─── RPC errors ──────────────────────────────────────────────────────────────
export const RPC_ERRORS: Record<string, string> = {
  session_expired: 'Your session has ended. Please sign in again.',
  inactive: 'Your account has been deactivated. Contact the school office.',
  paused: PAUSED_MESSAGE,
  forbidden: 'You do not have access to this campus.',
  outside_geofence: 'You are outside the school geofence. Move closer to the gate and update your location.',
  missing_fields: 'Please fill in all required fields.',
  invalid_radius: 'Geofence radius must be between 50 and 500 metres.',
  invalid_location: 'Please choose a valid location.',
  invalid_status: 'Invalid status.',
  not_found: 'That record no longer exists.',
  parent_accounts_branch_parent_uniq: 'A parent account with that ID already exists at this campus.',
  transporter_accounts_branch_driver_uniq: 'A driver account with that ID already exists at this campus.',
};

export function rpcErrorCode(e: any): string | null {
  const msg: string = e?.message || String(e ?? '');
  return Object.keys(RPC_ERRORS).find(k => msg.includes(k)) ?? null;
}

export function rpcMessage(e: any): string {
  const code = rpcErrorCode(e);
  return code ? RPC_ERRORS[code] : (e?.message || String(e));
}

// The session is no longer usable → the screen should sign out.
export const isSessionError = (e: any) => ['session_expired', 'inactive'].includes(rpcErrorCode(e) ?? '');

export function useBranch(branchId: string | null | undefined, options: { live?: boolean } = {}) {
  const [branch, setBranch] = useState<BranchInfo | null>(null);
  const [loading, setLoading] = useState(!!branchId);
  const liveUpdates = !!options.live;

  const load = async () => {
    if (!branchId) return;
    try {
      setBranch(await fetchBranch(branchId));
    } catch (e: any) {
      console.error('[useBranch]', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!branchId) { setLoading(false); return; }
    load();
    // Only staff screens keep a live connection; they see a pause or resume within seconds.
    if (!liveUpdates) return;
    return subscribeBranchPings(branchId, what => {
      if (what === 'branches' || what === 'schools') load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, liveUpdates]);

  // Everyone else (parents, drivers) learns of a pause on the next check.
  usePoll(load, { enabled: !!branchId, fast: false, fastMs: BRANCH_POLL_MS, slowMs: BRANCH_POLL_MS });

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
