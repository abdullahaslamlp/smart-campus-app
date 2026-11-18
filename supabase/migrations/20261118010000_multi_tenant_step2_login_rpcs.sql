-- SafePass multi-tenant · Step 2: branch search + parent/driver login RPCs
-- Passwords are verified server-side against password_hash; the client never receives a password.

-- Search campuses by school or branch name/code (archived ones are hidden).
create or replace function public.search_branches(p_query text default '')
returns table (branch_id uuid, branch_code text, branch_name text, school_name text, status text)
language sql stable security definer set search_path = public as $$
  select b.id, b.code, b.name, s.name,
         case when s.status <> 'active' then s.status else b.status end
  from branches b join schools s on s.id = b.school_id
  where b.status <> 'archived' and s.status <> 'archived'
    and (coalesce(trim(p_query), '') = ''
         or s.name ilike '%' || trim(p_query) || '%'
         or b.name ilike '%' || trim(p_query) || '%'
         or b.code ilike '%' || trim(p_query) || '%')
  order by s.name, b.name
  limit 25;
$$;

-- Returns {ok:true, ...} or {ok:false, error:'not_found'|'inactive'|'bad_password'|'paused'|'no_branch'}
create or replace function public.login_parent(p_branch_id uuid, p_parent_id text, p_password text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare a parent_accounts%rowtype;
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
  return jsonb_build_object('ok', true, 'parent_id', a.parent_id, 'full_name', a.full_name, 'branch_id', a.branch_id);
end $$;

create or replace function public.login_driver(p_branch_id uuid, p_driver_id text, p_password text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare a transporter_accounts%rowtype;
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
  return jsonb_build_object(
    'ok', true, 'driver_id', a.driver_id, 'driver_name', a.driver_name,
    'vehicle_type', a.vehicle_type, 'vehicle_number', a.vehicle_number,
    'linked_parent_ids', coalesce(to_jsonb(a.linked_parent_ids), '[]'::jsonb), 'branch_id', a.branch_id);
end $$;

-- Branch info + effective status (paused if the branch OR its school is paused).
create or replace function public.get_branch(p_branch_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'code', b.code, 'name', b.name, 'school_id', s.id, 'school_name', s.name,
    'status', case when s.status <> 'active' then s.status else b.status end,
    'lat', b.lat, 'lng', b.lng, 'geofence_radius', b.geofence_radius)
  from branches b join schools s on s.id = b.school_id where b.id = p_branch_id;
$$;

grant execute on function public.search_branches(text), public.login_parent(uuid, text, text),
  public.login_driver(uuid, text, text), public.get_branch(uuid) to anon, authenticated;
