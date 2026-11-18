-- SafePass multi-tenant · Step 5a: token-checked action RPCs + broadcast change pings
-- Additive only: the currently deployed site keeps working until Step 5b (RLS) goes live.
--
-- * app_sessions: parent / driver session tokens (login_parent / login_driver now return one)
-- * parent_* / driver_* RPCs: read state, update distance, check in, kids arrived
--     server enforces: session valid, campus live, geofence radius on check-in
-- * admin_* RPCs (admin_sessions token, any admin role with access to the branch;
--     branch admins are blocked while their campus is paused)
-- * Broadcast pings: statement triggers send an empty 'changed' event on topic
--   'branch:<id>' so clients refetch through the RPCs (no row data leaves the DB).

-- ── Parent / driver sessions ─────────────────────────────────────────────────
create table if not exists public.app_sessions (
  token      uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('parent', 'driver')),
  branch_id  uuid not null references public.branches(id) on delete cascade,
  login_id   text not null,               -- parent_id or driver_id within the branch
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists app_sessions_branch_idx on public.app_sessions(branch_id);
alter table public.app_sessions enable row level security;

create or replace function public.login_parent(p_branch_id uuid, p_parent_id text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare a parent_accounts%rowtype; v_token uuid;
begin
  if not exists (select 1 from branches where id = p_branch_id and status <> 'archived') then
    return jsonb_build_object('ok', false, 'error', 'no_branch');
  end if;
  if not branch_is_live(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'paused');
  end if;
  select * into a from parent_accounts
   where branch_id = p_branch_id and parent_id = lower(trim(p_parent_id));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if a.is_active is false then return jsonb_build_object('ok', false, 'error', 'inactive'); end if;
  if a.password_hash is null or a.password_hash <> crypt(p_password, a.password_hash) then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;
  delete from app_sessions where expires_at < now();
  insert into app_sessions(kind, branch_id, login_id) values ('parent', a.branch_id, a.parent_id)
  returning token into v_token;
  return jsonb_build_object('ok', true, 'parent_id', a.parent_id, 'full_name', a.full_name,
                            'branch_id', a.branch_id, 'token', v_token);
end $$;

create or replace function public.login_driver(p_branch_id uuid, p_driver_id text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare a transporter_accounts%rowtype; v_token uuid;
begin
  if not exists (select 1 from branches where id = p_branch_id and status <> 'archived') then
    return jsonb_build_object('ok', false, 'error', 'no_branch');
  end if;
  if not branch_is_live(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'paused');
  end if;
  select * into a from transporter_accounts
   where branch_id = p_branch_id and driver_id = lower(trim(p_driver_id));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if a.is_active is false then return jsonb_build_object('ok', false, 'error', 'inactive'); end if;
  if a.password_hash is null or a.password_hash <> crypt(p_password, a.password_hash) then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;
  delete from app_sessions where expires_at < now();
  insert into app_sessions(kind, branch_id, login_id) values ('driver', a.branch_id, a.driver_id)
  returning token into v_token;
  return jsonb_build_object(
    'ok', true, 'driver_id', a.driver_id, 'driver_name', a.driver_name,
    'vehicle_type', a.vehicle_type, 'vehicle_number', a.vehicle_number,
    'linked_parent_ids', coalesce(to_jsonb(a.linked_parent_ids), '[]'::jsonb), 'branch_id', a.branch_id,
    'token', v_token);
end $$;

-- Resolve a parent/driver token. Raises session_expired / inactive; returns the session row.
create or replace function public.app_session(p_token uuid, p_kind text)
returns app_sessions language plpgsql stable security definer set search_path = public as $$
declare s app_sessions%rowtype;
begin
  select * into s from app_sessions where token = p_token and kind = p_kind and expires_at > now();
  if not found then raise exception 'session_expired'; end if;
  if p_kind = 'parent' and not exists (
       select 1 from parent_accounts where branch_id = s.branch_id and parent_id = s.login_id and is_active is not false) then
    raise exception 'inactive';
  end if;
  if p_kind = 'driver' and not exists (
       select 1 from transporter_accounts where branch_id = s.branch_id and driver_id = s.login_id and is_active is not false) then
    raise exception 'inactive';
  end if;
  return s;
end $$;

create or replace function public.app_require_live(p_branch_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not branch_is_live(p_branch_id) then raise exception 'paused'; end if;
end $$;

create or replace function public.app_logout(p_token uuid)
returns void language sql volatile security definer set search_path = public as $$
  delete from app_sessions where token = p_token;
$$;

-- ── Parent actions ───────────────────────────────────────────────────────────
create or replace function public.parent_state(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s app_sessions%rowtype;
begin
  s := app_session(p_token, 'parent');
  return jsonb_build_object(
    'branch', get_branch(s.branch_id),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'grade', x.grade, 'gate', x.gate, 'parent_id', x.parent_id,
        'status', x.status, 'last_distance_meters', x.last_distance_meters) order by x.name)
      from students x where x.branch_id = s.branch_id and x.parent_id = s.login_id), '[]'::jsonb));
end $$;

create or replace function public.parent_set_distance(p_token uuid, p_meters integer)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s app_sessions%rowtype;
begin
  s := app_session(p_token, 'parent');
  perform app_require_live(s.branch_id);
  update students set last_distance_meters = greatest(0, p_meters)
  where branch_id = s.branch_id and parent_id = s.login_id;
end $$;

create or replace function public.parent_check_in(p_token uuid, p_meters integer)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare s app_sessions%rowtype; v_radius integer; n integer;
begin
  s := app_session(p_token, 'parent');
  perform app_require_live(s.branch_id);
  select geofence_radius into v_radius from branches where id = s.branch_id;
  if p_meters is null or p_meters > v_radius then raise exception 'outside_geofence'; end if;
  update students set status = 'dispatched', last_distance_meters = greatest(0, p_meters)
  where branch_id = s.branch_id and parent_id = s.login_id and status in ('waiting', 'arrived');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.parent_mark_received(p_token uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare s app_sessions%rowtype; n integer;
begin
  s := app_session(p_token, 'parent');
  perform app_require_live(s.branch_id);
  update students set status = 'received'
  where branch_id = s.branch_id and parent_id = s.login_id and status = 'dispatched';
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Driver actions ───────────────────────────────────────────────────────────
create or replace function public.driver_state(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s app_sessions%rowtype; d transporter_accounts%rowtype;
begin
  s := app_session(p_token, 'driver');
  select * into d from transporter_accounts where branch_id = s.branch_id and driver_id = s.login_id;
  return jsonb_build_object(
    'branch', get_branch(s.branch_id),
    'driver', jsonb_build_object(
      'driver_id', d.driver_id, 'driver_name', d.driver_name, 'vehicle_type', d.vehicle_type,
      'vehicle_number', d.vehicle_number, 'linked_parent_ids', coalesce(to_jsonb(d.linked_parent_ids), '[]'::jsonb)),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'grade', x.grade, 'gate', x.gate, 'parent_id', x.parent_id,
        'status', x.status) order by x.parent_id, x.name)
      from students x
      where x.branch_id = s.branch_id and x.parent_id = any(coalesce(d.linked_parent_ids, '{}'))), '[]'::jsonb));
end $$;

create or replace function public.driver_check_in(p_token uuid, p_meters integer)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare s app_sessions%rowtype; v_radius integer; v_pids text[]; n integer;
begin
  s := app_session(p_token, 'driver');
  perform app_require_live(s.branch_id);
  select geofence_radius into v_radius from branches where id = s.branch_id;
  if p_meters is null or p_meters > v_radius then raise exception 'outside_geofence'; end if;
  select linked_parent_ids into v_pids from transporter_accounts where branch_id = s.branch_id and driver_id = s.login_id;
  update students set status = 'dispatched'
  where branch_id = s.branch_id and parent_id = any(coalesce(v_pids, '{}')) and status = 'waiting';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.driver_mark_received(p_token uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare s app_sessions%rowtype; v_pids text[]; n integer;
begin
  s := app_session(p_token, 'driver');
  perform app_require_live(s.branch_id);
  select linked_parent_ids into v_pids from transporter_accounts where branch_id = s.branch_id and driver_id = s.login_id;
  update students set status = 'received'
  where branch_id = s.branch_id and parent_id = any(coalesce(v_pids, '{}')) and status = 'dispatched';
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Branch admin actions (admin_sessions token) ──────────────────────────────
create or replace function public.adm(p_token uuid, p_branch_id uuid)
returns admin_accounts language plpgsql stable security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  select ac.* into a
  from admin_sessions se join admin_accounts ac on ac.id = se.admin_id
  where se.token = p_token and se.expires_at > now() and ac.is_active;
  if not found then raise exception 'session_expired'; end if;
  if not admin_can_branch(a.id, p_branch_id) then raise exception 'forbidden'; end if;
  if a.role = 'branch' and not branch_is_live(p_branch_id) then raise exception 'paused'; end if;
  return a;
end $$;

create or replace function public.admin_branch_data(p_token uuid, p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  a := adm(p_token, p_branch_id);
  return jsonb_build_object(
    'branch', get_branch(p_branch_id),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'grade', x.grade, 'gate', x.gate, 'parent_id', x.parent_id,
        'status', x.status, 'last_distance_meters', x.last_distance_meters, 'branch_id', x.branch_id) order by x.status, x.name)
      from students x where x.branch_id = p_branch_id), '[]'::jsonb),
    'parents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'parent_id', x.parent_id, 'full_name', x.full_name, 'phone', x.phone,
        'is_active', x.is_active, 'created_at', x.created_at) order by x.created_at desc)
      from parent_accounts x where x.branch_id = p_branch_id), '[]'::jsonb),
    'transporters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'driver_id', x.driver_id, 'driver_name', x.driver_name, 'vehicle_type', x.vehicle_type,
        'vehicle_number', x.vehicle_number, 'phone', x.phone,
        'linked_parent_ids', coalesce(to_jsonb(x.linked_parent_ids), '[]'::jsonb),
        'is_active', x.is_active, 'created_at', x.created_at) order by x.created_at desc)
      from transporter_accounts x where x.branch_id = p_branch_id), '[]'::jsonb));
end $$;

create or replace function public.admin_add_student(
  p_token uuid, p_branch_id uuid, p_name text, p_grade text, p_gate text, p_parent_id text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; v_id uuid;
begin
  a := adm(p_token, p_branch_id);
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_parent_id), '') = '' then raise exception 'missing_fields'; end if;
  insert into students(branch_id, name, grade, gate, parent_id, status, last_distance_meters)
  values (p_branch_id, trim(p_name), nullif(trim(p_grade), ''), coalesce(nullif(trim(p_gate), ''), 'Gate A'),
          lower(trim(p_parent_id)), 'waiting', null)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_set_student_status(p_token uuid, p_branch_id uuid, p_student_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  a := adm(p_token, p_branch_id);
  if p_status not in ('waiting', 'dispatched', 'arrived', 'received') then raise exception 'invalid_status'; end if;
  update students set status = p_status where id = p_student_id and branch_id = p_branch_id;
end $$;

create or replace function public.admin_reset_demo(p_token uuid, p_branch_id uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; n integer;
begin
  a := adm(p_token, p_branch_id);
  update students set status = 'waiting', last_distance_meters = null where branch_id = p_branch_id;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_save_geofence(
  p_token uuid, p_branch_id uuid, p_lat double precision default null, p_lng double precision default null,
  p_radius integer default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  a := adm(p_token, p_branch_id);
  if p_radius is not null and p_radius not between 50 and 500 then raise exception 'invalid_radius'; end if;
  if (p_lat is not null and p_lat not between -90 and 90) or (p_lng is not null and p_lng not between -180 and 180) then
    raise exception 'invalid_location';
  end if;
  update branches set lat = coalesce(p_lat, lat), lng = coalesce(p_lng, lng),
                      geofence_radius = coalesce(p_radius, geofence_radius)
  where id = p_branch_id;
end $$;

-- Parents: password is only changed when a non-empty value is given.
create or replace function public.admin_save_parent(
  p_token uuid, p_branch_id uuid, p_id uuid, p_parent_id text, p_full_name text,
  p_password text default null, p_phone text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; v_id uuid;
begin
  a := adm(p_token, p_branch_id);
  if coalesce(trim(p_full_name), '') = '' then raise exception 'missing_fields'; end if;
  if p_id is null then
    if coalesce(trim(p_parent_id), '') = '' or coalesce(p_password, '') = '' then raise exception 'missing_fields'; end if;
    insert into parent_accounts(branch_id, parent_id, full_name, password, phone, is_active)
    values (p_branch_id, lower(trim(p_parent_id)), trim(p_full_name), p_password, nullif(trim(p_phone), ''), true)
    returning id into v_id;
  else
    update parent_accounts set full_name = trim(p_full_name), phone = nullif(trim(p_phone), ''),
           password = case when coalesce(p_password, '') <> '' then p_password else password end
    where id = p_id and branch_id = p_branch_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.admin_set_parent_active(p_token uuid, p_branch_id uuid, p_id uuid, p_active boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  a := adm(p_token, p_branch_id);
  update parent_accounts set is_active = p_active where id = p_id and branch_id = p_branch_id;
  if not p_active then
    delete from app_sessions s using parent_accounts p
    where p.id = p_id and s.kind = 'parent' and s.branch_id = p.branch_id and s.login_id = p.parent_id;
  end if;
end $$;

create or replace function public.admin_delete_parent(p_token uuid, p_branch_id uuid, p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; v_pid text;
begin
  a := adm(p_token, p_branch_id);
  delete from parent_accounts where id = p_id and branch_id = p_branch_id returning parent_id into v_pid;
  delete from app_sessions where kind = 'parent' and branch_id = p_branch_id and login_id = v_pid;
end $$;

create or replace function public.admin_save_transporter(
  p_token uuid, p_branch_id uuid, p_id uuid, p_driver_id text, p_driver_name text,
  p_vehicle_type text, p_vehicle_number text, p_password text default null, p_phone text default null,
  p_linked_parent_ids text[] default '{}')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; v_id uuid;
begin
  a := adm(p_token, p_branch_id);
  if coalesce(trim(p_driver_name), '') = '' or coalesce(trim(p_vehicle_number), '') = '' then
    raise exception 'missing_fields';
  end if;
  if p_id is null then
    if coalesce(trim(p_driver_id), '') = '' or coalesce(p_password, '') = '' then raise exception 'missing_fields'; end if;
    insert into transporter_accounts(branch_id, driver_id, driver_name, vehicle_type, vehicle_number,
                                     password, phone, linked_parent_ids, is_active)
    values (p_branch_id, lower(trim(p_driver_id)), trim(p_driver_name), coalesce(nullif(trim(p_vehicle_type), ''), 'Rickshaw'),
            trim(p_vehicle_number), p_password, nullif(trim(p_phone), ''), coalesce(p_linked_parent_ids, '{}'), true)
    returning id into v_id;
  else
    update transporter_accounts set
      driver_name = trim(p_driver_name),
      vehicle_type = coalesce(nullif(trim(p_vehicle_type), ''), vehicle_type),
      vehicle_number = trim(p_vehicle_number),
      phone = nullif(trim(p_phone), ''),
      linked_parent_ids = coalesce(p_linked_parent_ids, '{}'),
      password = case when coalesce(p_password, '') <> '' then p_password else password end
    where id = p_id and branch_id = p_branch_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.admin_set_transporter_active(p_token uuid, p_branch_id uuid, p_id uuid, p_active boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  a := adm(p_token, p_branch_id);
  update transporter_accounts set is_active = p_active where id = p_id and branch_id = p_branch_id;
  if not p_active then
    delete from app_sessions s using transporter_accounts t
    where t.id = p_id and s.kind = 'driver' and s.branch_id = t.branch_id and s.login_id = t.driver_id;
  end if;
end $$;

create or replace function public.admin_delete_transporter(p_token uuid, p_branch_id uuid, p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; v_did text;
begin
  a := adm(p_token, p_branch_id);
  delete from transporter_accounts where id = p_id and branch_id = p_branch_id returning driver_id into v_did;
  delete from app_sessions where kind = 'driver' and branch_id = p_branch_id and login_id = v_did;
end $$;

-- ── Broadcast "changed" pings (no row data) ──────────────────────────────────
create or replace function public.ping_branch(p_branch_id uuid, p_what text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform realtime.send(jsonb_build_object('what', p_what), 'changed', 'branch:' || p_branch_id::text, false);
exception when others then
  null;  -- never let a notification failure break a write
end $$;

create or replace function public.ping_from_new()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct branch_id from new_rows loop perform ping_branch(r.branch_id, tg_table_name); end loop;
  return null;
end $$;

create or replace function public.ping_from_old()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct branch_id from old_rows loop perform ping_branch(r.branch_id, tg_table_name); end loop;
  return null;
end $$;

create or replace function public.ping_branches_new()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from new_rows loop perform ping_branch(r.id, 'branches'); end loop;
  return null;
end $$;

create or replace function public.ping_schools_new()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select b.id from branches b join new_rows n on n.id = b.school_id loop
    perform ping_branch(r.id, 'schools');
  end loop;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['students', 'parent_accounts', 'transporter_accounts'] loop
    execute format('drop trigger if exists %1$s_ping_ins on public.%1$s', t);
    execute format('drop trigger if exists %1$s_ping_upd on public.%1$s', t);
    execute format('drop trigger if exists %1$s_ping_del on public.%1$s', t);
    execute format('create trigger %1$s_ping_ins after insert on public.%1$s referencing new table as new_rows for each statement execute function public.ping_from_new()', t);
    execute format('create trigger %1$s_ping_upd after update on public.%1$s referencing new table as new_rows for each statement execute function public.ping_from_new()', t);
    execute format('create trigger %1$s_ping_del after delete on public.%1$s referencing old table as old_rows for each statement execute function public.ping_from_old()', t);
  end loop;
end $$;

drop trigger if exists branches_ping_upd on public.branches;
create trigger branches_ping_upd after update on public.branches
  referencing new table as new_rows for each statement execute function public.ping_branches_new();
drop trigger if exists schools_ping_upd on public.schools;
create trigger schools_ping_upd after update on public.schools
  referencing new table as new_rows for each statement execute function public.ping_schools_new();

-- ── Permissions ──────────────────────────────────────────────────────────────
revoke execute on function
  public.app_session(uuid, text), public.app_require_live(uuid), public.adm(uuid, uuid),
  public.ping_branch(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.login_parent(uuid, text, text), public.login_driver(uuid, text, text), public.app_logout(uuid),
  public.parent_state(uuid), public.parent_set_distance(uuid, integer),
  public.parent_check_in(uuid, integer), public.parent_mark_received(uuid),
  public.driver_state(uuid), public.driver_check_in(uuid, integer), public.driver_mark_received(uuid),
  public.admin_branch_data(uuid, uuid), public.admin_add_student(uuid, uuid, text, text, text, text),
  public.admin_set_student_status(uuid, uuid, uuid, text), public.admin_reset_demo(uuid, uuid),
  public.admin_save_geofence(uuid, uuid, double precision, double precision, integer),
  public.admin_save_parent(uuid, uuid, uuid, text, text, text, text),
  public.admin_set_parent_active(uuid, uuid, uuid, boolean), public.admin_delete_parent(uuid, uuid, uuid),
  public.admin_save_transporter(uuid, uuid, uuid, text, text, text, text, text, text, text[]),
  public.admin_set_transporter_active(uuid, uuid, uuid, boolean), public.admin_delete_transporter(uuid, uuid, uuid)
to anon, authenticated;
