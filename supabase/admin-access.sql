-- STABLR Admin access foundation
-- Apply after supabase/shared-catalog-schema.sql.
--
-- The existing public.is_admin() helper remains the source of truth for both
-- RLS policies and the /admin client gate. This migration prevents a regular
-- authenticated user from assigning themselves the admin role through the
-- otherwise self-service profiles table.

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.role() = 'authenticated' and new.role <> 'user' then
      raise exception 'Only a database administrator can assign an admin role';
    end if;
  elsif new.role is distinct from old.role
    and auth.role() = 'authenticated'
    and not public.is_admin() then
    raise exception 'Only an admin can change a profile role';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
before insert or update of role on public.profiles
for each row
execute function public.guard_profile_role();

-- Keep the database-side permission check callable by authenticated sessions
-- and by existing RLS policies, without exposing it to anonymous callers.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;
