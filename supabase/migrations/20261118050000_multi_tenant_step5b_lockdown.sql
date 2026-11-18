-- SafePass multi-tenant · Step 5b: lock down direct table access
-- RUN ONLY TOGETHER WITH THE DEPLOY of the RPC-based app (Step 5a client code).
-- The currently deployed site reads tables directly and stops working once this runs.
--
-- * RLS on every app table with NO policies → the public (anon) key can no longer read or write rows
-- * table privileges revoked from anon / authenticated as a second layer
-- * plaintext password columns dropped (bcrypt password_hash only)
-- * temporary Branch1 defaults on branch_id removed
-- All app access goes through SECURITY DEFINER RPCs owned by the table owner, which bypass RLS.

begin;

-- ── Passwords: save RPCs write the hash directly, then drop plaintext ────────
create or replace function public.admin_save_parent(
  p_token uuid, p_branch_id uuid, p_id uuid, p_parent_id text, p_full_name text,
  p_password text default null, p_phone text default null)
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare a admin_accounts%rowtype; v_id uuid;
begin
  a := adm(p_token, p_branch_id);
  if coalesce(trim(p_full_name), '') = '' then raise exception 'missing_fields'; end if;
  if p_id is null then
    if coalesce(trim(p_parent_id), '') = '' or coalesce(p_password, '') = '' then raise exception 'missing_fields'; end if;
    insert into parent_accounts(branch_id, parent_id, full_name, password_hash, phone, is_active)
    values (p_branch_id, lower(trim(p_parent_id)), trim(p_full_name), crypt(p_password, gen_salt('bf')),
            nullif(trim(p_phone), ''), true)
    returning id into v_id;
  else
    update parent_accounts set full_name = trim(p_full_name), phone = nullif(trim(p_phone), ''),
           password_hash = case when coalesce(p_password, '') <> '' then crypt(p_password, gen_salt('bf')) else password_hash end
    where id = p_id and branch_id = p_branch_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.admin_save_transporter(
  p_token uuid, p_branch_id uuid, p_id uuid, p_driver_id text, p_driver_name text,
  p_vehicle_type text, p_vehicle_number text, p_password text default null, p_phone text default null,
  p_linked_parent_ids text[] default '{}')
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare a admin_accounts%rowtype; v_id uuid;
begin
  a := adm(p_token, p_branch_id);
  if coalesce(trim(p_driver_name), '') = '' or coalesce(trim(p_vehicle_number), '') = '' then
    raise exception 'missing_fields';
  end if;
  if p_id is null then
    if coalesce(trim(p_driver_id), '') = '' or coalesce(p_password, '') = '' then raise exception 'missing_fields'; end if;
    insert into transporter_accounts(branch_id, driver_id, driver_name, vehicle_type, vehicle_number,
                                     password_hash, phone, linked_parent_ids, is_active)
    values (p_branch_id, lower(trim(p_driver_id)), trim(p_driver_name), coalesce(nullif(trim(p_vehicle_type), ''), 'Rickshaw'),
            trim(p_vehicle_number), crypt(p_password, gen_salt('bf')), nullif(trim(p_phone), ''),
            coalesce(p_linked_parent_ids, '{}'), true)
    returning id into v_id;
  else
    update transporter_accounts set
      driver_name = trim(p_driver_name),
      vehicle_type = coalesce(nullif(trim(p_vehicle_type), ''), vehicle_type),
      vehicle_number = trim(p_vehicle_number),
      phone = nullif(trim(p_phone), ''),
      linked_parent_ids = coalesce(p_linked_parent_ids, '{}'),
      password_hash = case when coalesce(p_password, '') <> '' then crypt(p_password, gen_salt('bf')) else password_hash end
    where id = p_id and branch_id = p_branch_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

-- Every account must have a hash before the plaintext column goes.
do $$
begin
  if exists (select 1 from parent_accounts where password_hash is null)
     or exists (select 1 from transporter_accounts where password_hash is null) then
    raise exception 'Some accounts have no password_hash — aborting before dropping plaintext passwords';
  end if;
end $$;

drop trigger if exists parent_accounts_hash on public.parent_accounts;
drop trigger if exists transporter_accounts_hash on public.transporter_accounts;
drop function if exists public.sync_password_hash();

alter table public.parent_accounts      drop column password;
alter table public.transporter_accounts drop column password;
alter table public.parent_accounts      alter column password_hash set not null;
alter table public.transporter_accounts alter column password_hash set not null;

-- ── Remove temporary Branch1 defaults (every insert passes branch_id) ────────
alter table public.students             alter column branch_id drop default;
alter table public.parent_accounts      alter column branch_id drop default;
alter table public.transporter_accounts alter column branch_id drop default;

-- ── Row Level Security: no policies = no direct access for client keys ───────
alter table public.schools              enable row level security;
alter table public.branches             enable row level security;
alter table public.students             enable row level security;
alter table public.parent_accounts      enable row level security;
alter table public.transporter_accounts enable row level security;
alter table public.school_settings      enable row level security;

revoke all on table
  public.schools, public.branches, public.students, public.parent_accounts, public.transporter_accounts,
  public.school_settings, public.admin_accounts, public.admin_scopes, public.admin_sessions,
  public.app_sessions, public.audit_log
from anon, authenticated;

-- Row data no longer streams over postgres_changes; clients use the 'branch:<id>' broadcast pings.
do $$
declare t text;
begin
  foreach t in array array['students', 'parent_accounts', 'transporter_accounts', 'branches', 'schools'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

commit;
