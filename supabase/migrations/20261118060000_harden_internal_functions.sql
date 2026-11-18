-- SafePass · post-lockdown hardening (from the Supabase security advisor)
-- * Internal SECURITY DEFINER functions must not be callable with the public keys.
--   reset_daily_dismissals (pre-existing) reset every student at every school to 'waiting'
--   and was executable by anon. It stays available to the database owner (e.g. a future cron job).
-- * Pin search_path on the functions the advisor flagged.

revoke execute on function
  public.reset_daily_dismissals(),
  public.rls_auto_enable(),
  public.ping_from_new(), public.ping_from_old(), public.ping_branches_new(), public.ping_schools_new()
from public, anon, authenticated;

alter function public.reset_daily_dismissals() set search_path = public;
alter function public.branch_is_live(uuid) set search_path = public;
alter function public.sa_check_branch_input(text, text, double precision, double precision, integer) set search_path = public;
