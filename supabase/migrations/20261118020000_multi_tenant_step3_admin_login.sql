-- SafePass multi-tenant · Step 3: admin login RPC + branch access list
-- owner  → every non-archived branch
-- super  → branches of scoped schools + individually scoped branches
-- branch → individually scoped branches (blocked when none of them is live)

create or replace function public.admin_branch_list(p_admin_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'branch_id', b.id, 'branch_code', b.code, 'branch_name', b.name,
           'school_id', s.id, 'school_name', s.name,
           'status', case when s.status <> 'active' then s.status else b.status end)
         order by s.name, b.name), '[]'::jsonb)
  from branches b
  join schools s on s.id = b.school_id
  join admin_accounts a on a.id = p_admin_id
  where b.status <> 'archived' and s.status <> 'archived'
    and (a.role = 'owner'
         or exists (select 1 from admin_scopes sc
                    where sc.admin_id = a.id and (sc.branch_id = b.id or sc.school_id = s.id)));
$$;

-- Returns {ok:true, admin_id, username, full_name, role, branches:[...]}
--      or {ok:false, error:'not_found'|'inactive'|'bad_password'|'paused'|'no_branch'}
create or replace function public.login_admin(p_username text, p_password text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  a admin_accounts%rowtype;
  v_branches jsonb;
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

  return jsonb_build_object('ok', true, 'admin_id', a.id, 'username', a.username,
    'full_name', a.full_name, 'role', a.role, 'branches', v_branches);
end $$;

revoke execute on function public.admin_branch_list(uuid) from public, anon, authenticated;
grant execute on function public.login_admin(text, text) to anon, authenticated;

-- NOTE: the temporary Branch1 defaults on branch_id stay until the branch-aware admin
-- is deployed (the live site still inserts without branch_id). Drop them afterwards.

-- Admin realtime for account tables (students already published).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'parent_accounts') then
    execute 'alter publication supabase_realtime add table public.parent_accounts';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transporter_accounts') then
    execute 'alter publication supabase_realtime add table public.transporter_accounts';
  end if;
end $$;
