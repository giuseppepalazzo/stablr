-- STABLR Admin: utenti e giri (apply manually in the Supabase SQL Editor).
-- This migration deliberately does not expose auth.users, email, or activity rows
-- to the player app.

-- Fail closed if a non-standard SELECT/ALL policy is already present: RLS policies
-- are additive, so an unknown policy could otherwise widen visibility of rounds.
do $$
declare
  unexpected_policy text;
begin
  select policyname
  into unexpected_policy
  from pg_policies
  where schemaname = 'public'
    and tablename in ('rounds', 'round_holes')
    and cmd in ('SELECT', 'ALL')
    and policyname not in (
      'rounds_select_own',
      'rounds_select_own_or_admin',
      'round_holes_select_own',
      'round_holes_select_own_or_admin'
    )
  limit 1;

  if unexpected_policy is not null then
    raise exception 'Unexpected SELECT policy found on rounds data: %', unexpected_policy;
  end if;
end;
$$;

create table if not exists public.user_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_activity enable row level security;
revoke all on table public.user_activity from public;
revoke all on table public.user_activity from anon, authenticated;

create or replace function public.record_current_user_activity()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rows_updated integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  insert into public.user_activity (user_id, last_seen_at)
  values (auth.uid(), now())
  on conflict (user_id) do update
  set last_seen_at = excluded.last_seen_at,
      updated_at = now()
  where public.user_activity.last_seen_at <= excluded.last_seen_at - interval '15 minutes';

  get diagnostics rows_updated = row_count;
  return rows_updated > 0;
end;
$$;

revoke all on function public.record_current_user_activity() from public;
grant execute on function public.record_current_user_activity() to authenticated;

create or replace function public.admin_user_directory()
returns table (
  user_id uuid,
  player_name text,
  email text,
  role text,
  joined_at timestamptz,
  last_login_at timestamptz,
  last_seen_at timestamptz,
  round_count bigint,
  last_round_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select
    auth_user.id,
    coalesce(profile.player_name, auth_user.raw_user_meta_data ->> 'player_name', auth_user.raw_user_meta_data ->> 'full_name', auth_user.raw_user_meta_data ->> 'name'),
    auth_user.email,
    coalesce(profile.role, 'user'),
    auth_user.created_at,
    auth_user.last_sign_in_at,
    activity.last_seen_at,
    coalesce(round_stats.round_count, 0),
    round_stats.last_round_at
  from auth.users as auth_user
  left join public.profiles as profile on profile.id = auth_user.id
  left join public.user_activity as activity on activity.user_id = auth_user.id
  left join lateral (
    select count(*)::bigint as round_count, max(round.created_at) as last_round_at
    from public.rounds as round
    where round.user_id = auth_user.id
  ) as round_stats on true
  order by auth_user.created_at desc;
end;
$$;

revoke all on function public.admin_user_directory() from public;
grant execute on function public.admin_user_directory() to authenticated;

drop policy if exists "rounds_select_own" on public.rounds;
drop policy if exists "rounds_select_own_or_admin" on public.rounds;
create policy "rounds_select_own_or_admin"
on public.rounds
for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "round_holes_select_own" on public.round_holes;
drop policy if exists "round_holes_select_own_or_admin" on public.round_holes;
create policy "round_holes_select_own_or_admin"
on public.round_holes
for select
to authenticated
using (auth.uid() = user_id or public.is_admin());
