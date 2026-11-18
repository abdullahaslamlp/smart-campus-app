-- SafePass multi-tenant · Step 1 (additive, zero data loss)
-- * schools / branches hierarchy (branches replace school_settings)
-- * admin_accounts + admin_scopes (owner / scoped super admins / branch admins)
-- * branch_id on students, parent_accounts, transporter_accounts; existing rows -> "School" / "Branch1"
-- * login IDs unique per branch instead of globally
-- * password_hash (bcrypt) kept in sync by trigger; plaintext column kept until the RPC switch-over
-- The old school_settings table is left untouched (read-only legacy) for rollback.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ── Hierarchy ────────────────────────────────────────────────────────────────
create table public.schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  status      text not null default 'active' check (status in ('active','paused','archived')),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table public.branches (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  name            text not null,
  code            text not null unique,              -- e.g. 'BRANCH1', used in links (?branch=)
  status          text not null default 'active' check (status in ('active','paused','archived')),
  lat             double precision not null,
  lng             double precision not null,
  geofence_radius integer not null default 150 check (geofence_radius between 50 and 500),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index branches_school_id_idx on public.branches(school_id);

-- A branch is usable only when it AND its school are active.
create or replace function public.branch_is_live(p_branch_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.branches b join public.schools s on s.id = b.school_id
    where b.id = p_branch_id and b.status = 'active' and s.status = 'active'
  );
$$;

-- ── Admin accounts ───────────────────────────────────────────────────────────
-- role 'owner'  : platform owner, sees every school
-- role 'super'  : super admin limited to the schools/branches listed in admin_scopes
-- role 'branch' : branch admin (dashboard of the branches listed in admin_scopes)
create table public.admin_accounts (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  full_name     text,
  role          text not null check (role in ('owner','super','branch')),
  password_hash text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.admin_scopes (
  id        uuid primary key default gen_random_uuid(),
  admin_id  uuid not null references public.admin_accounts(id) on delete cascade,
  school_id uuid references public.schools(id) on delete cascade,   -- whole school
  branch_id uuid references public.branches(id) on delete cascade,  -- single branch
  check ((school_id is null) <> (branch_id is null))
);
create unique index admin_scopes_uniq on public.admin_scopes(admin_id, coalesce(school_id, branch_id));

create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.admin_accounts(id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   uuid,
  detail      jsonb,
  at          timestamptz not null default now()
);

-- ── Default tenant from existing data ────────────────────────────────────────
do $$
declare
  v_school uuid;
  v_branch uuid;
  v_lat double precision := 31.4501;
  v_lng double precision := 74.3012;
  v_rad integer := 150;
begin
  select lat, lng, coalesce(geofence_radius, 150) into v_lat, v_lng, v_rad
  from public.school_settings where id = 'primary';

  insert into public.schools(name, slug) values ('School', 'school') returning id into v_school;
  insert into public.branches(school_id, name, code, lat, lng, geofence_radius)
  values (v_school, 'Branch1', 'BRANCH1', coalesce(v_lat, 31.4501), coalesce(v_lng, 74.3012), coalesce(v_rad, 150))
  returning id into v_branch;

  -- tenant columns: add, backfill, then enforce
  alter table public.students             add column branch_id uuid references public.branches(id) on delete cascade;
  alter table public.parent_accounts      add column branch_id uuid references public.branches(id) on delete cascade;
  alter table public.transporter_accounts add column branch_id uuid references public.branches(id) on delete cascade;

  update public.students             set branch_id = v_branch;
  update public.parent_accounts      set branch_id = v_branch;
  update public.transporter_accounts set branch_id = v_branch;

  -- Temporary default so the current (not yet branch-aware) app keeps inserting into Branch1.
  -- Dropped in Step 2 once every insert passes branch_id explicitly.
  execute format('alter table public.students             alter column branch_id set default %L::uuid', v_branch);
  execute format('alter table public.parent_accounts      alter column branch_id set default %L::uuid', v_branch);
  execute format('alter table public.transporter_accounts alter column branch_id set default %L::uuid', v_branch);

  -- Branch admin for Branch1; initial password = the current hardcoded admin PIN.
  insert into public.admin_accounts(username, full_name, role, password_hash)
  values ('branch1_admin', 'Branch1 Admin', 'branch', extensions.crypt('safepass2025', extensions.gen_salt('bf')));
  insert into public.admin_scopes(admin_id, branch_id)
  select id, v_branch from public.admin_accounts where username = 'branch1_admin';

  -- Platform owner; initial password = the current hardcoded admin PIN. Change it after first login.
  insert into public.admin_accounts(username, full_name, role, password_hash)
  values ('owner', 'Platform Owner', 'owner', extensions.crypt('safepass2025', extensions.gen_salt('bf')));
end $$;

alter table public.students             alter column branch_id set not null;
alter table public.parent_accounts      alter column branch_id set not null;
alter table public.transporter_accounts alter column branch_id set not null;

create index students_branch_idx             on public.students(branch_id);
create index students_branch_parent_idx      on public.students(branch_id, parent_id);
create index parent_accounts_branch_idx      on public.parent_accounts(branch_id);
create index transporter_accounts_branch_idx on public.transporter_accounts(branch_id);

-- ── Login IDs unique per branch (same parent_001 may exist in two branches) ──
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'u'
      and c.conrelid in ('public.parent_accounts'::regclass, 'public.transporter_accounts'::regclass)
      and array_length(c.conkey, 1) = 1
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.parent_accounts      add constraint parent_accounts_branch_parent_uniq      unique (branch_id, parent_id);
alter table public.transporter_accounts add constraint transporter_accounts_branch_driver_uniq unique (branch_id, driver_id);

-- ── Hashed passwords (kept in sync while the plaintext column still exists) ──
alter table public.parent_accounts      add column password_hash text;
alter table public.transporter_accounts add column password_hash text;

create or replace function public.sync_password_hash()
returns trigger language plpgsql as $$
begin
  if new.password is not null and (tg_op = 'INSERT' or new.password is distinct from old.password) then
    new.password_hash := extensions.crypt(new.password, extensions.gen_salt('bf'));
  end if;
  return new;
end $$;

create trigger parent_accounts_hash      before insert or update on public.parent_accounts
  for each row execute function public.sync_password_hash();
create trigger transporter_accounts_hash before insert or update on public.transporter_accounts
  for each row execute function public.sync_password_hash();

update public.parent_accounts      set password_hash = extensions.crypt(password, extensions.gen_salt('bf')) where password is not null;
update public.transporter_accounts set password_hash = extensions.crypt(password, extensions.gen_salt('bf')) where password is not null;

-- ── Realtime: branches table so clients see pause/resume instantly ───────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.branches, public.schools';
  end if;
end $$;

-- Admin tables must never be readable with the anon key.
alter table public.admin_accounts enable row level security;
alter table public.admin_scopes   enable row level security;
alter table public.audit_log      enable row level security;

commit;
