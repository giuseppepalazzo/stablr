-- STABLR Admin: incremental repair for public.admin_user_directory().
-- Apply manually in the Supabase SQL Editor after admin-users-and-rounds.sql.
-- It preserves the RPC contract and its existing Admin-only security boundary.

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
  with round_stats as (
    select
      rounds.user_id,
      count(*)::bigint as round_count,
      max(rounds.created_at) as last_round_at
    from public.rounds
    group by rounds.user_id
  )
  select
    auth_user.id::uuid,
    coalesce(
      profile.player_name,
      auth_user.raw_user_meta_data ->> 'player_name',
      auth_user.raw_user_meta_data ->> 'full_name',
      auth_user.raw_user_meta_data ->> 'name'
    )::text,
    auth_user.email::text,
    coalesce(profile.role, 'user')::text,
    auth_user.created_at::timestamptz,
    auth_user.last_sign_in_at::timestamptz,
    activity.last_seen_at::timestamptz,
    coalesce(round_stats.round_count, 0::bigint)::bigint,
    round_stats.last_round_at::timestamptz
  from auth.users as auth_user
  left join public.profiles as profile on profile.id = auth_user.id
  left join public.user_activity as activity on activity.user_id = auth_user.id
  left join round_stats on round_stats.user_id = auth_user.id
  order by auth_user.created_at desc;
end;
$$;

revoke all on function public.admin_user_directory() from public;
grant execute on function public.admin_user_directory() to authenticated;
