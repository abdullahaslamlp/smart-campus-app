-- Demo mode: per-campus switch that shows the "simulate distance" shortcut in the parent and
-- driver apps. Off by default; an admin turns it on for installation demos.

alter table public.branches add column if not exists demo_mode boolean not null default false;

create or replace function public.get_branch(p_branch_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'code', b.code, 'name', b.name, 'school_id', s.id, 'school_name', s.name,
    'status', case when s.status <> 'active' then s.status else b.status end,
    'lat', b.lat, 'lng', b.lng, 'geofence_radius', b.geofence_radius, 'demo_mode', b.demo_mode)
  from branches b join schools s on s.id = b.school_id where b.id = p_branch_id;
$$;

create or replace function public.admin_set_demo_mode(p_token uuid, p_branch_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare a admin_accounts%rowtype;
begin
  a := adm(p_token, p_branch_id);
  update branches set demo_mode = coalesce(p_enabled, false) where id = p_branch_id;
end $$;

grant execute on function public.admin_set_demo_mode(uuid, uuid, boolean) to anon, authenticated;
