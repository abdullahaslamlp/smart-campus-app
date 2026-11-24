#!/usr/bin/env node
// SafePass load test (Node 18+, no dependencies).
//
// Drives the same read-only RPCs the apps use against the Supabase project and reports
// latency and errors at rising request rates, stopping at the first rate that fails.
//
//   node scripts/loadtest.mjs                          # ramp 5 → 60 requests/second
//   node scripts/loadtest.mjs --steps 10,50,150,300 --seconds 15
//   node scripts/loadtest.mjs --parent parent_001:safepass123   # also hit parent_state
//
// Point it at a STAGING project for heavy runs: past a few hundred requests per second it
// will slow down or rate-limit the project it targets, including for real users.
//
// Not covered: Realtime websocket limits (concurrent connections, messages/second). Those
// are plan limits shown in the Supabase dashboard; test them with a websocket tool.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const steps = arg('steps', '5,10,20,40,60').split(',').map(Number);
const seconds = Number(arg('seconds', '8'));
const maxErrorRate = Number(arg('max-error-rate', '0.02'));
const maxP95 = Number(arg('max-p95-ms', '1500'));
const parentLogin = arg('parent', '');          // "id:password" → also test parent_state
const branchCode = arg('branch', 'BRANCH1');

// Read the project URL and public key from the app's own client file.
const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(join(here, '..', 'supabase.js'), 'utf8');
const url = (arg('url') ?? clientSrc.match(/supabaseUrl\s*=\s*'([^']+)'/)?.[1] ?? '').replace(/\/$/, '');
const key = arg('key') ?? clientSrc.match(/supabaseAnonKey\s*=\s*'([^']+)'/)?.[1] ?? '';
if (!url || !key) { console.error('Could not read the Supabase URL / key.'); process.exit(1); }

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const rpc = async (fn, body) => {
  const t0 = performance.now();
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const ok = res.ok;
    const data = ok ? await res.json().catch(() => null) : null;
    if (!ok) await res.text().catch(() => '');
    return { ok, status: res.status, ms: performance.now() - t0, data };
  } catch {
    return { ok: false, status: 0, ms: performance.now() - t0, data: null };
  }
};

// ── Setup: find the campus and (optionally) a parent session token ──────────
const found = await rpc('search_branches', { p_query: branchCode });
const branch = found.data?.find(b => b.branch_code === branchCode);
if (!branch) { console.error(`Campus ${branchCode} not found (HTTP ${found.status}).`); process.exit(1); }

let parentToken = null;
if (parentLogin) {
  const [id, ...pw] = parentLogin.split(':');
  const r = await rpc('login_parent', { p_branch_id: branch.branch_id, p_parent_id: id, p_password: pw.join(':') });
  parentToken = r.data?.token ?? null;
  if (!parentToken) console.warn('Parent login failed; skipping parent_state.');
}

const calls = [() => rpc('get_branch', { p_branch_id: branch.branch_id })];
if (parentToken) calls.push(() => rpc('parent_state', { p_token: parentToken }));

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

// ── One step: send requests at a fixed rate (open loop) for N seconds ───────
async function runStep(rate) {
  const results = [];
  const pending = new Set();
  const started = performance.now();
  const total = rate * seconds;
  for (let i = 0; i < total; i++) {
    const due = started + (i * 1000) / rate;
    const wait = due - performance.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const p = calls[i % calls.length]().then(r => { results.push(r); pending.delete(p); });
    pending.add(p);
  }
  await Promise.all(pending);
  const elapsed = (performance.now() - started) / 1000;
  const ms = results.map(r => r.ms).sort((a, b) => a - b);
  const failed = results.filter(r => !r.ok);
  const byStatus = {};
  failed.forEach(r => { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; });
  return {
    rate, sent: results.length, achieved: results.length / elapsed,
    errorRate: failed.length / results.length, byStatus,
    p50: pct(ms, 0.5), p95: pct(ms, 0.95), p99: pct(ms, 0.99),
  };
}

console.log(`Target ${url}`);
console.log(`Campus ${branch.school_name} / ${branch.branch_name}; ${seconds}s per step; stops at >${maxErrorRate * 100}% errors or p95 >${maxP95} ms\n`);
console.log('rate/s  sent   errors   p50 ms   p95 ms   p99 ms');

let lastGood = 0;
let breakingPoint = null;
for (const rate of steps) {
  const r = await runStep(rate);
  const flag = r.errorRate > maxErrorRate || r.p95 > maxP95 ? '  <-- limit' : '';
  console.log(
    `${String(rate).padStart(6)}  ${String(r.sent).padStart(5)}  ${(r.errorRate * 100).toFixed(1).padStart(5)}%  ` +
    `${r.p50.toFixed(0).padStart(7)}  ${r.p95.toFixed(0).padStart(7)}  ${r.p99.toFixed(0).padStart(7)}${flag}` +
    (Object.keys(r.byStatus).length ? `   HTTP ${JSON.stringify(r.byStatus)}` : ''),
  );
  if (flag) { breakingPoint = rate; break; }
  lastGood = rate;
  await new Promise(r => setTimeout(r, 1500)); // let the server settle between steps
}

console.log(breakingPoint
  ? `\nHealthy up to ${lastGood} requests/second; degraded at ${breakingPoint}.`
  : `\nNo limit reached up to ${lastGood} requests/second. Try higher --steps (against staging).`);
console.log('\nRule of thumb: an idle open app makes about 1 request per 15 s, and one during a pickup about 1 per 10 s,\nso requests/second × 10 to 15 ≈ simultaneous open apps.');
