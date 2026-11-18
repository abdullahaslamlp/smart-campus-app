@AGENTS.md

# SafePass — Smart Campus Dismissal System (`smart-campus-app`)

## 1. Vision & Product Overview
**SafePass** is a web-first mobile & desktop application (built with Expo + Expo Router + Supabase) designed to modernize and organize school dismissal. Instead of chaotic gate announcements and crowded pickup lanes, SafePass uses **GPS geofencing** and **real-time status syncing** between:
1. **Parents** — check in when they arrive within the school's geofence radius, notify teachers/guards to send their children to the gate, and confirm pickup (**"Kids Arrived"**).
2. **Transporters / Drivers** (Rickshaws, School Vans, Carpools) — manage multiple linked parents/students in a single route, check in for all assigned students at once, and confirm pickup (**"Kids Arrived"**).
3. **School Administrators & Guards** — monitor live dismissal queues, manage students/parents/transporters, configure the school's GPS coordinates & geofence radius, and see who has been dispatched vs. safely received.

---

## 2. Tech Stack & Deployment

- **Framework:** Expo SDK `~56.0.16` with **Expo Router** (`~56.2.15`), React `19.2.3`, React Native `0.85.3`, `react-native-web ~0.21.0`, TypeScript `~6.0.3`
- **Important Rule:** Expo SDK v56 has breaking changes. Always check `https://docs.expo.dev/versions/v56.0.0/` before writing new Expo API code (per `AGENTS.md`).
- **Location:** `expo-location ~56.0.21` (foreground GPS via `Location.getCurrentPositionAsync` + Haversine distance calculation).
- **Backend / Database:** Supabase (`@supabase/supabase-js ^2.108.2`)
  - Client config: `supabase.js` (`https://spmjuieierhsgjtzznoo.supabase.co`)
  - Uses Supabase PostgreSQL + Realtime (`postgres_changes` on `students` table, etc.)
- **Hosting:** Vercel — Production URL: `https://smart-campus-app-seven.vercel.app`
  - Repo: `https://github.com/abdullahaslamlp/smart-campus-app` (branch `main`)
  - Static web output (`app.json` → `"web": { "output": "static" }`) exports into `dist/`.
  - **Build & Deploy Workflow:**
    ```powershell
    npx expo export --platform web   # Rebuilds static web bundle into dist/
    npx vercel --prod --yes          # Deploys to smart-campus-app-seven.vercel.app
    ```
    (`package.json` also has `"build": "expo export --platform web"`.)

---

## 3. Codebase Map

| File | Purpose |
|------|---------|
| `supabase.js` | Initializes and exports the `supabase` client. |
| `src/app/_layout.tsx` | Expo Router root layout. |
| `src/app/index.tsx` | **SafePass Landing Page** — portal selector (Admin Portal, Parent Login, Transporter/Driver Login). |
| `src/app/parent-login.tsx` | Parent authentication against `parent_accounts` + session helpers (`setParentSession` / `getParentSession`, using `sessionStorage` on web). |
| `src/app/parent-app.tsx` | **Parent Portal** — GPS distance tracker, geofence check-in, **"Kids Arrived"** button, 30-second auto-departure polling, realtime student status list. |
| `src/app/driver-login.tsx` | Driver authentication against `transporter_accounts` + session helpers (`setDriverSession` / `getDriverSession`). |
| `src/app/driver-app.tsx` | **Transporter / Driver Portal** — route roster across `linked_parent_ids`, GPS geofence check-in, batch dispatch, **"Kids Arrived"** button, 30-second auto-departure polling, 3-box stats (Waiting / Dispatched / Received). |
| `src/app/admin.tsx` | **Admin Portal** (~1,910 lines) — PIN-gated (`safepass2025`), responsive desktop sidebar + mobile bottom nav, 8 tabs (`dashboard`, `students`, `guardians`, `geofence`, `logs`, `accounts`, `transporters`, `tests`). |
| `src/app/parent.tsx` | Legacy/older parent screen (pre-existing TS warning on line 25; active flow uses `parent-login.tsx` → `parent-app.tsx`). |
| `src/app/explore.tsx` | Default Expo template screen (unused in main flow). |

---

## 4. Current Database Schema (Supabase — Single-Tenant Today)

> **Note:** Currently RLS is disabled on all tables and the app is single-tenant (one school/campus).

1. **`students`**
   - `id` (uuid, PK)
   - `name` (text)
   - `grade` (text, e.g., `"Grade 3-C"`)
   - `gate` (text, e.g., `"Gate A"`, `"Gate B"`)
   - `parent_id` (text, links to `parent_accounts.parent_id`, e.g., `"parent_033"`)
   - `status` (text — values: `'waiting' | 'dispatched' | 'arrived' | 'received'`)
   - `last_distance_meters` (numeric/int, nullable — updated by parent GPS)
2. **`parent_accounts`**
   - `id` (uuid, PK)
   - `parent_id` (text, unique login ID)
   - `full_name` (text)
   - `password` (text — currently plaintext, masked in Admin UI)
   - `phone` (text, nullable)
   - `is_active` (boolean)
   - `created_at` (timestamp)
3. **`transporter_accounts`**
   - `id` (uuid, PK)
   - `driver_id` (text, unique login ID)
   - `driver_name` (text)
   - `vehicle_type` (text, e.g., `"School Van"`, `"Rickshaw"`)
   - `vehicle_number` (text)
   - `password` (text — currently plaintext)
   - `phone` (text, nullable)
   - `linked_parent_ids` (text[] — array of `parent_id` strings assigned to this driver)
   - `is_active` (boolean)
   - `created_at` (timestamp)
4. **`school_settings`**
   - Single row with `id = 'primary'`
   - `lat` (float — school gate latitude)
   - `lng` (float — school gate longitude)
   - `geofence_radius` (int — meters, e.g. `150`, slider range `50m–500m`)

---

## 5. What Has Been Achieved Until Now

### Student Dismissal Lifecycle (`waiting` → `dispatched` → `received`)
- **GPS Geofencing:** Calculates Haversine distance from user's live GPS to `school_settings` (`lat`, `lng`). Check-in / Notify Gate button is strictly disabled if distance exceeds `geofence_radius`. Includes demo distance simulator buttons for testing.
- **Parent Portal (`parent-app.tsx`):**
  - Displays distance, geofence badge, linked children, and 3-state bottom action bar:
    1. *Check In for Dismissal* (within geofence → sets students to `dispatched`)
    2. *🧒 Kids Arrived — Tap to Confirm* (indigo button → sets students to `received`)
    3. *🏠 Kids Safely Received!* confirmation card
  - **Automatic 30-Second Departure Detection:** Once status is `dispatched` and not yet `received`, a `setInterval` polls `Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })` every 30 seconds. If the parent leaves the geofence radius without pressing the button, it automatically marks their students as `received`. Uses `useRef` mirrors (`pollIntervalRef`, `geofenceRadiusRef`, `schoolLocationRef`, `isReceivedRef`, `currentParentIdRef`) to avoid stale closures.
- **Transporter / Driver Portal (`driver-app.tsx`):**
  - Mirrors parent flow for drivers covering multiple parents (`linked_parent_ids`).
  - Decouples driver GPS distance via `sessionStorage` so it does not clobber parent `last_distance_meters` in DB.
  - Shows 3 live counters (Waiting / Dispatched / Received), batch check-in, batch **"Kids Arrived"** button, and 30-second auto-departure polling.
- **Admin Portal (`admin.tsx`):**
  - Fully responsive (desktop sidebar + mobile bottom bar + horizontal scroll tables).
  - Live Supabase Realtime sync across all tables.
  - KPI row: Total Students, Active Dismissals, **Received Today 🏠**, Parent Accounts, Geofence Radius.
  - Class & Section filter bar across Dashboard, Student Directory, Guardian Roster, and Dispatch Logs.
  - Full CRUD for Students, Parent Accounts, and Transporters (with masked passwords + eye toggles, and filtering out already-assigned parents when creating a driver).
  - Interactive Geofence Config (map pin placement + radius slider + save).
  - Demo Reset button (resets all students back to `waiting`).
  - Built-in **System Tests** tab (whitebox / greybox / blackbox / responsiveness checks) + 50-student seed dataset.

### Known Implementation Details & Caveats
- `FormField` in `admin.tsx` is intentionally defined outside the main component so web `<input>` elements don't lose focus on re-render.
- Pre-existing minor TS issues (unrelated to recent work): `admin.tsx:1870` (`StyleSheet.absoluteFillObject` vs `absoluteFill`) and `parent.tsx:25` (`never[]` state typing).
- Always run `npx expo export --platform web` before deploying with Vercel CLI so `dist/` reflects the latest source changes.

---

## 6. Next Major Goal: Multi-Tenant / Multi-School Scaling & Super Admin

We now want to evolve SafePass from a **single-school prototype** into a **scalable multi-tenant SaaS platform** that can host and manage **multiple independent school systems** as well as **multiple branches/campuses under a single school** (e.g., *Beaconhouse — North Campus*, *Beaconhouse — Johar Town Campus*, plus *City School — Gulberg Campus*, etc.).

### Target Capabilities
1. **Organization & Branch Hierarchy:**
   - **Organizations / Schools** (top-level entity, e.g., "SafePass Academy" or a school network).
   - **Branches / Campuses** (child entity belonging to a school — each branch has its own GPS `lat`/`lng`, `geofence_radius`, gates, admin account(s), students, parents, and transporters).
   - A standalone single-campus school is simply a School with 1 Branch; a multi-branch school has 1 School with N Branches.

2. **Super Admin Portal (`/super-admin`):**
   - Platform-level owner dashboard (secured separately from branch admins).
   - **Create** new Schools and Branches (configuring name, unique branch code/slug, initial branch admin credentials, default geofence settings).
   - **Pause / Suspend** an entire School (pausing all its branches) OR pause a single Branch independently:
     - Paused status (`status = 'paused'`) must **preserve all data** while immediately blocking branch admin, parent, and driver logins/actions with a clear suspension notice (e.g., *"This campus portal is temporarily paused. Please contact administration."*).
     - Ability to **Resume / Unpause** (`status = 'active'`) at any time with zero data loss.
   - **Delete** a School or Branch:
     - Safe deletion workflow (typed confirmation modal, soft-delete / archive vs. permanent cascade delete) that cleanly removes or archives associated branch settings, students, parents, and transporters.
   - **Global Overview & Monitoring:**
     - KPIs across all schools/branches (total schools, active vs. paused branches, total students, live active dismissals across campuses).
     - Ability for Super Admin to inspect/impersonate or jump into a specific branch's admin dashboard if needed.

3. **Strict Tenant Isolation & Security Upgrade:**
   - Scope `students`, `parent_accounts`, `transporter_accounts`, and `school_settings` (or fold settings into `branches`) by `branch_id` (and `school_id`).
   - Scope all Supabase queries and Realtime subscriptions (`filter: 'branch_id=eq.<id>'`) strictly to the active branch so zero data leaks between schools/branches.
   - Replace the single hardcoded `ADMIN_PIN = 'safepass2025'` with per-branch admin credentials (and ideally proper auth + hashed passwords + Supabase RLS policies as we harden for production).
   - Update Login UX (`index.tsx`, `admin.tsx`, `parent-login.tsx`, `driver-login.tsx`) so users cleanly select or enter their School/Branch (or access via branch code / URL parameter) and are automatically validated against that branch's `active` / `paused` status.
   - Preserve existing single-campus data cleanly by migrating current records into a default initial School & Branch (zero data loss migration script).
