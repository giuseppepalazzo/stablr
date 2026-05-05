alter table public.clubs
  add column if not exists data_status text not null default 'community'
    check (data_status in ('verified', 'community', 'needs_review'));

alter table public.clubs
  add column if not exists source_type text not null default 'user'
    check (source_type in ('stablr', 'user', 'fig_import'));

alter table public.clubs
  add column if not exists is_complex boolean not null default false;

alter table public.clubs
  add column if not exists playable boolean not null default true;

create table if not exists public.club_requests (
  id uuid primary key default gen_random_uuid(),
  club_name text not null,
  club_id uuid references public.clubs(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  status text not null default 'requested'
    check (status in ('requested', 'in_review', 'configured', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists clubs_data_status_idx on public.clubs(data_status);
create index if not exists clubs_source_type_idx on public.clubs(source_type);
create index if not exists clubs_is_complex_idx on public.clubs(is_complex);
create index if not exists clubs_playable_idx on public.clubs(playable);
create index if not exists club_requests_user_id_idx on public.club_requests(user_id);
create index if not exists club_requests_status_idx on public.club_requests(status);
create index if not exists club_requests_club_id_idx on public.club_requests(club_id);

alter table public.club_requests enable row level security;

drop policy if exists "club_requests_select_own_or_admin" on public.club_requests;
create policy "club_requests_select_own_or_admin"
on public.club_requests
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "club_requests_insert_own" on public.club_requests;
create policy "club_requests_insert_own"
on public.club_requests
for insert
with check (user_id = auth.uid());

drop policy if exists "club_requests_update_admin" on public.club_requests;
create policy "club_requests_update_admin"
on public.club_requests
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "club_requests_delete_admin" on public.club_requests;
create policy "club_requests_delete_admin"
on public.club_requests
for delete
using (public.is_admin());
