-- Confirm pickup for ONE child at a time (parent or driver), so a driver who notified the
-- gate for several children but only collected two can confirm just those two.

create or replace function public.parent_mark_student_received(p_token uuid, p_student_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare s app_sessions%rowtype; n integer;
begin
  s := app_session(p_token, 'parent');
  perform app_require_live(s.branch_id);
  update students set status = 'received'
  where id = p_student_id and branch_id = s.branch_id and parent_id = s.login_id and status = 'dispatched';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.driver_mark_student_received(p_token uuid, p_student_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare s app_sessions%rowtype; v_pids text[]; n integer;
begin
  s := app_session(p_token, 'driver');
  perform app_require_live(s.branch_id);
  select linked_parent_ids into v_pids from transporter_accounts where branch_id = s.branch_id and driver_id = s.login_id;
  update students set status = 'received'
  where id = p_student_id and branch_id = s.branch_id
    and parent_id = any(coalesce(v_pids, '{}')) and status = 'dispatched';
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.parent_mark_student_received(uuid, uuid), public.driver_mark_student_received(uuid, uuid) to anon, authenticated;
