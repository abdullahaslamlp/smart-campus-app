-- SafePass multi-tenant · Step 4: Super Admin RPCs
-- * admin_sessions: login_admin now issues a 12h session token
-- * every sa_* function takes that token and checks the caller's role + scope
--     owner → everything · super → own schools (all branches) + individually scoped branches
-- * pause / resume / archive / restore / permanent delete (archive first, typed confirmation)
-- * admin account management, audit log on every change

-- ── Sessions ─────────────────────────────────────────────────────────────────
create table if not exists public.admin_sessions (
  token      uuid primary key default gen_random_uuid(),
  admin_id   uuid not null references public.admin_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
create index if not exists admin_sessions_admin_idx on public.admin_sessions(admin_id);
alter table public.admin_sessions enable row level security;

-- login_admin now also returns a session token (function becomes volatile).
create or replace function public.login_admin(p_username text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  a admin_accounts%rowtype;
  v_branches jsonb;
  v_token uuid;
begin
  select * into a from admin_accounts where username = lower(trim(p_username));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not a.is_active then return jsonb_build_object('ok', false, 'error', 'inactive'); end if;
  if a.password_hash <> crypt(p_password, a.password_hash) then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;

  v_branches := admin_branch_list(a.id);
  if a.role = 'branch' then
    if jsonb_array_length(v_branches) = 0 then
      return jsonb_build_object('ok', false, 'error', 'no_branch');
    end if;
    if not exists (select 1 from jsonb_array_elements(v_branches) e where e->>'status' = 'active') then
      return jsonb_build_object('ok', false, 'error', 'paused');
    end if;
  end if;

  delete from admin_sessions where expires_at < now();
  insert into admin_sessions(admin_id) values (a.id) returning token into v_token;

  return jsonb_build_object('ok', true, 'admin_id', a.id, 'username', a.username,
    'full_name', a.full_name, 'role', a.role, 'branches', v_branches, 'token', v_token);
end $$;

-- ── Internal helpers (not callable by clients) ───────────────────────────────
create or replace function public.sa_admin(p_token uuid)
returns admin_accounts language plpgsql stable security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  select ac.* into a
  from admin_sessions se join admin_accounts ac on ac.id = se.admin_id
  where se.token = p_token and se.expires_at > now() and ac.is_active;
  if not found then raise exception 'session_expired'; end if;
  if a.role not in ('owner', 'super') then raise exception 'forbidden'; end if;
  return a;
end $$;

create or replace function public.admin_can_school(p_admin_id uuid, p_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admin_accounts a
    where a.id = p_admin_id and a.is_active
      and (a.role = 'owner'
           or (a.role = 'super' and exists (
                 select 1 from admin_scopes s where s.admin_id = a.id and s.school_id = p_school_id))));
$$;

create or replace function public.admin_can_branch(p_admin_id uuid, p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admin_accounts a
    where a.id = p_admin_id and a.is_active
      and (a.role = 'owner'
           or exists (
                select 1 from admin_scopes s
                where s.admin_id = a.id
                  and (s.branch_id = p_branch_id
                       or s.school_id = (select school_id from branches where id = p_branch_id)))));
$$;

create or replace function public.sa_log(p_actor uuid, p_action text, p_type text, p_target uuid, p_detail jsonb default null)
returns void language sql volatile security definer set search_path = public as $$
  insert into audit_log(actor_id, action, target_type, target_id, detail)
  values (p_actor, p_action, p_type, p_target, p_detail);
$$;

create or replace function public.sa_check_branch_input(p_name text, p_code text, p_lat double precision, p_lng double precision, p_radius integer)
returns void language plpgsql immutable as $$
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'invalid_branch_name'; end if;
  if p_code !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$' then raise exception 'invalid_branch_code'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_location';
  end if;
  if p_radius is null or p_radius not between 50 and 500 then raise exception 'invalid_radius'; end if;
end $$;

create or replace function public.sa_make_admin(p_username text, p_password text, p_full_name text, p_role text)
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if lower(trim(p_username)) !~ '^[a-z0-9_.]{3,32}$' then raise exception 'invalid_username'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'weak_password'; end if;
  insert into admin_accounts(username, full_name, role, password_hash)
  values (lower(trim(p_username)), nullif(trim(p_full_name), ''), p_role, crypt(p_password, gen_salt('bf')))
  returning id into v_id;
  return v_id;
end $$;

-- ── Overview ─────────────────────────────────────────────────────────────────
create or replace function public.sa_overview(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a admin_accounts%rowtype; v jsonb;
begin
  a := sa_admin(p_token);
  select coalesce(jsonb_agg(q.sch order by q.sch->>'name'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status, 'created_at', s.created_at,
      'can_manage', admin_can_school(a.id, s.id),
      'branches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'code', b.code, 'status', b.status,
          'lat', b.lat, 'lng', b.lng, 'geofence_radius', b.geofence_radius, 'created_at', b.created_at,
          'students', (select count(*) from students x where x.branch_id = b.id),
          'active_dismissals', (select count(*) from students x where x.branch_id = b.id and x.status = 'dispatched'),
          'received', (select count(*) from students x where x.branch_id = b.id and x.status = 'received'),
          'parents', (select count(*) from parent_accounts x where x.branch_id = b.id),
          'drivers', (select count(*) from transporter_accounts x where x.branch_id = b.id),
          'admins', (select coalesce(jsonb_agg(ac.username order by ac.username), '[]'::jsonb)
                     from admin_scopes sc join admin_accounts ac on ac.id = sc.admin_id
                     where sc.branch_id = b.id))
          order by b.name)
        from branches b where b.school_id = s.id and admin_can_branch(a.id, b.id)), '[]'::jsonb)
    ) as sch
    from schools s
    where admin_can_school(a.id, s.id)
       or exists (select 1 from branches b where b.school_id = s.id and admin_can_branch(a.id, b.id))
  ) q;
  return jsonb_build_object(
    'admin', jsonb_build_object('id', a.id, 'username', a.username, 'full_name', a.full_name, 'role', a.role),
    'schools', v);
end $$;

-- ── Create ───────────────────────────────────────────────────────────────────
create or replace function public.sa_create_branch(
  p_token uuid, p_school_id uuid, p_name text, p_code text,
  p_lat double precision, p_lng double precision, p_radius integer default 150,
  p_admin_username text default null, p_admin_password text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; v_branch uuid; v_admin uuid; v_code text := upper(trim(p_code));
begin
  a := sa_admin(p_token);
  if not admin_can_school(a.id, p_school_id) then raise exception 'forbidden'; end if;
  perform sa_check_branch_input(p_name, v_code, p_lat, p_lng, p_radius);
  insert into branches(school_id, name, code, lat, lng, geofence_radius)
  values (p_school_id, trim(p_name), v_code, p_lat, p_lng, p_radius) returning id into v_branch;
  if coalesce(trim(p_admin_username), '') <> '' then
    v_admin := sa_make_admin(p_admin_username, p_admin_password, trim(p_name) || ' Admin', 'branch');
    insert into admin_scopes(admin_id, branch_id) values (v_admin, v_branch);
  end if;
  perform sa_log(a.id, 'create_branch', 'branch', v_branch, jsonb_build_object('code', v_code, 'admin', p_admin_username));
  return jsonb_build_object('branch_id', v_branch, 'admin_id', v_admin);
end $$;

create or replace function public.sa_create_school(
  p_token uuid, p_name text, p_slug text,
  p_branch_name text, p_branch_code text,
  p_lat double precision, p_lng double precision, p_radius integer default 150,
  p_admin_username text default null, p_admin_password text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; v_school uuid; v_slug text := lower(trim(p_slug)); r jsonb;
begin
  a := sa_admin(p_token);
  if a.role <> 'owner' then raise exception 'forbidden'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'invalid_school_name'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,47}$' then raise exception 'invalid_slug'; end if;
  insert into schools(name, slug) values (trim(p_name), v_slug) returning id into v_school;
  perform sa_log(a.id, 'create_school', 'school', v_school, jsonb_build_object('slug', v_slug));
  r := sa_create_branch(p_token, v_school, p_branch_name, p_branch_code, p_lat, p_lng, p_radius,
                        p_admin_username, p_admin_password);
  return jsonb_build_object('school_id', v_school) || r;
end $$;

-- ── Status: pause / resume / archive / restore ───────────────────────────────
create or replace function public.sa_set_school_status(p_token uuid, p_school_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  a := sa_admin(p_token);
  if not admin_can_school(a.id, p_school_id) then raise exception 'forbidden'; end if;
  if p_status not in ('active', 'paused', 'archived') then raise exception 'invalid_status'; end if;
  update schools set status = p_status,
         archived_at = case when p_status = 'archived' then now() else null end
  where id = p_school_id;
  if not found then raise exception 'not_found'; end if;
  perform sa_log(a.id, 'school_' || p_status, 'school', p_school_id);
end $$;

create or replace function public.sa_set_branch_status(p_token uuid, p_branch_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  a := sa_admin(p_token);
  if not admin_can_branch(a.id, p_branch_id) then raise exception 'forbidden'; end if;
  if p_status not in ('active', 'paused', 'archived') then raise exception 'invalid_status'; end if;
  update branches set status = p_status,
         archived_at = case when p_status = 'archived' then now() else null end
  where id = p_branch_id;
  if not found then raise exception 'not_found'; end if;
  perform sa_log(a.id, 'branch_' || p_status, 'branch', p_branch_id);
end $$;

-- ── Permanent delete (must be archived first + typed confirmation) ───────────
create or replace function public.sa_delete_branch(p_token uuid, p_branch_id uuid, p_confirm text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; b branches%rowtype;
begin
  a := sa_admin(p_token);
  if not admin_can_branch(a.id, p_branch_id) then raise exception 'forbidden'; end if;
  select * into b from branches where id = p_branch_id;
  if not found then raise exception 'not_found'; end if;
  if b.status <> 'archived' then raise exception 'archive_first'; end if;
  if p_confirm is distinct from b.code then raise exception 'confirm_mismatch'; end if;
  perform sa_log(a.id, 'delete_branch', 'branch', b.id, jsonb_build_object('code', b.code, 'name', b.name));
  delete from branches where id = b.id;   -- cascades: students, parents, transporters, scopes
  delete from admin_accounts ac where ac.role = 'branch'
    and not exists (select 1 from admin_scopes s where s.admin_id = ac.id);
end $$;

create or replace function public.sa_delete_school(p_token uuid, p_school_id uuid, p_confirm text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; s schools%rowtype;
begin
  a := sa_admin(p_token);
  if not admin_can_school(a.id, p_school_id) then raise exception 'forbidden'; end if;
  select * into s from schools where id = p_school_id;
  if not found then raise exception 'not_found'; end if;
  if s.status <> 'archived' then raise exception 'archive_first'; end if;
  if p_confirm is distinct from s.slug then raise exception 'confirm_mismatch'; end if;
  perform sa_log(a.id, 'delete_school', 'school', s.id, jsonb_build_object('slug', s.slug, 'name', s.name));
  delete from schools where id = s.id;    -- cascades through branches
  delete from admin_accounts ac where ac.role in ('branch', 'super')
    and not exists (select 1 from admin_scopes x where x.admin_id = ac.id);
end $$;

-- ── Open a branch dashboard (impersonation, audited) ─────────────────────────
create or replace function public.sa_open_branch(p_token uuid, p_branch_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; r jsonb;
begin
  a := sa_admin(p_token);
  if not admin_can_branch(a.id, p_branch_id) then raise exception 'forbidden'; end if;
  select jsonb_build_object('branch_id', b.id, 'branch_code', b.code, 'branch_name', b.name,
           'school_id', s.id, 'school_name', s.name,
           'status', case when s.status <> 'active' then s.status else b.status end)
    into r
  from branches b join schools s on s.id = b.school_id where b.id = p_branch_id;
  perform sa_log(a.id, 'open_dashboard', 'branch', p_branch_id);
  return r;
end $$;

-- ── Admin accounts ───────────────────────────────────────────────────────────
-- An admin is manageable by the caller when the caller is owner, or when every
-- scope of that (branch-role) admin is a branch the caller can manage.
create or replace function public.sa_can_manage_admin(p_caller uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select role from admin_accounts where id = p_caller) = 'owner' then true
    else exists (select 1 from admin_accounts t where t.id = p_target and t.role = 'branch')
     and exists (select 1 from admin_scopes s where s.admin_id = p_target)
     and not exists (select 1 from admin_scopes s where s.admin_id = p_target
                     and (s.branch_id is null or not admin_can_branch(p_caller, s.branch_id)))
  end;
$$;

create or replace function public.sa_list_admins(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a admin_accounts%rowtype; v jsonb;
begin
  a := sa_admin(p_token);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'username', t.username, 'full_name', t.full_name, 'role', t.role,
      'is_active', t.is_active, 'created_at', t.created_at, 'is_self', t.id = a.id,
      'scopes', (select coalesce(jsonb_agg(jsonb_build_object(
                   'type', case when sc.school_id is not null then 'school' else 'branch' end,
                   'id', coalesce(sc.school_id, sc.branch_id),
                   'name', coalesce(sch.name, bs.name || ' — ' || br.name))), '[]'::jsonb)
                 from admin_scopes sc
                 left join schools sch on sch.id = sc.school_id
                 left join branches br on br.id = sc.branch_id
                 left join schools bs on bs.id = br.school_id
                 where sc.admin_id = t.id))
    order by t.role, t.username), '[]'::jsonb) into v
  from admin_accounts t
  where t.id = a.id or sa_can_manage_admin(a.id, t.id);
  return v;
end $$;

create or replace function public.sa_create_admin(
  p_token uuid, p_username text, p_password text, p_full_name text, p_role text,
  p_school_ids uuid[] default '{}', p_branch_ids uuid[] default '{}')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare a admin_accounts%rowtype; v_id uuid; x uuid;
begin
  a := sa_admin(p_token);
  if p_role not in ('owner', 'super', 'branch') then raise exception 'invalid_role'; end if;
  if p_role in ('owner', 'super') and a.role <> 'owner' then raise exception 'forbidden'; end if;
  if p_role = 'branch' and (coalesce(cardinality(p_branch_ids), 0) = 0 or coalesce(cardinality(p_school_ids), 0) > 0) then
    raise exception 'branch_admin_needs_branches';
  end if;
  if p_role = 'super' and coalesce(cardinality(p_school_ids), 0) + coalesce(cardinality(p_branch_ids), 0) = 0 then
    raise exception 'super_admin_needs_scope';
  end if;
  foreach x in array coalesce(p_school_ids, '{}') loop
    if not admin_can_school(a.id, x) then raise exception 'forbidden'; end if;
  end loop;
  foreach x in array coalesce(p_branch_ids, '{}') loop
    if not admin_can_branch(a.id, x) then raise exception 'forbidden'; end if;
  end loop;

  v_id := sa_make_admin(p_username, p_password, p_full_name, p_role);
  if p_role <> 'owner' then
    insert into admin_scopes(admin_id, school_id) select v_id, unnest(coalesce(p_school_ids, '{}'));
    insert into admin_scopes(admin_id, branch_id) select v_id, unnest(coalesce(p_branch_ids, '{}'));
  end if;
  perform sa_log(a.id, 'create_admin', 'admin', v_id, jsonb_build_object('username', p_username, 'role', p_role));
  return v_id;
end $$;

create or replace function public.sa_update_admin(
  p_token uuid, p_admin_id uuid, p_is_active boolean default null, p_new_password text default null)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare a admin_accounts%rowtype;
begin
  a := sa_admin(p_token);
  if p_admin_id <> a.id and not sa_can_manage_admin(a.id, p_admin_id) then raise exception 'forbidden'; end if;
  if p_is_active is not null then
    if p_admin_id = a.id then raise exception 'cannot_deactivate_self'; end if;
    update admin_accounts set is_active = p_is_active where id = p_admin_id;
    if not p_is_active then delete from admin_sessions where admin_id = p_admin_id; end if;
    perform sa_log(a.id, case when p_is_active then 'activate_admin' else 'deactivate_admin' end, 'admin', p_admin_id);
  end if;
  if p_new_password is not null then
    if length(p_new_password) < 8 then raise exception 'weak_password'; end if;
    update admin_accounts set password_hash = crypt(p_new_password, gen_salt('bf')) where id = p_admin_id;
    perform sa_log(a.id, 'reset_password', 'admin', p_admin_id);
  end if;
end $$;

create or replace function public.admin_logout(p_token uuid)
returns void language sql volatile security definer set search_path = public as $$
  delete from admin_sessions where token = p_token;
$$;

-- ── Permissions ──────────────────────────────────────────────────────────────
revoke execute on function
  public.sa_admin(uuid), public.admin_can_school(uuid, uuid), public.admin_can_branch(uuid, uuid),
  public.sa_log(uuid, text, text, uuid, jsonb), public.sa_make_admin(text, text, text, text),
  public.sa_can_manage_admin(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.login_admin(text, text), public.admin_logout(uuid),
  public.sa_overview(uuid),
  public.sa_create_school(uuid, text, text, text, text, double precision, double precision, integer, text, text),
  public.sa_create_branch(uuid, uuid, text, text, double precision, double precision, integer, text, text),
  public.sa_set_school_status(uuid, uuid, text), public.sa_set_branch_status(uuid, uuid, text),
  public.sa_delete_school(uuid, uuid, text), public.sa_delete_branch(uuid, uuid, text),
  public.sa_open_branch(uuid, uuid),
  public.sa_list_admins(uuid),
  public.sa_create_admin(uuid, text, text, text, text, uuid[], uuid[]),
  public.sa_update_admin(uuid, uuid, boolean, text)
to anon, authenticated;
