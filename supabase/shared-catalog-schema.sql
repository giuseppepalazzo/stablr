create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  player_name text,
  hcp numeric,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'first_name'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'player_name'
  ) then
    alter table public.profiles rename column first_name to player_name;
  end if;
end
$$;

drop table if exists public.round_holes cascade;
drop table if exists public.route_combination_holes cascade;
drop table if exists public.route_combinations cascade;
drop table if exists public.route_holes cascade;
drop table if exists public.course_routes cascade;
drop table if exists public.favorite_clubs cascade;
drop table if exists public.club_reports cascade;
drop table if exists public.rounds cascade;
drop table if exists public.favorite_courses cascade;
drop table if exists public.course_reports cascade;
drop table if exists public.clubs cascade;

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text not null,
  city text,
  country text,
  created_by uuid not null references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_routes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  holes_count integer not null check (holes_count in (9, 18)),
  total_par integer,
  display_order integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.route_holes (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.course_routes(id) on delete cascade,
  physical_hole_number integer not null check (physical_hole_number between 1 and 18),
  par integer not null check (par between 3 and 6),
  stroke_index integer check (stroke_index between 1 and 18),
  display_label text,
  created_at timestamptz not null default now()
);

create table public.route_combinations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  front_route_id uuid not null references public.course_routes(id) on delete restrict,
  back_route_id uuid not null references public.course_routes(id) on delete restrict,
  holes_count integer not null default 18 check (holes_count = 18),
  total_par integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_combinations_routes_distinct check (front_route_id <> back_route_id)
);

create table public.route_combination_holes (
  id uuid primary key default gen_random_uuid(),
  route_combination_id uuid not null references public.route_combinations(id) on delete cascade,
  round_hole_number integer not null check (round_hole_number between 1 and 18),
  route_id uuid not null references public.course_routes(id) on delete restrict,
  route_position integer not null check (route_position in (1, 2)),
  physical_hole_number integer not null check (physical_hole_number between 1 and 18),
  par integer not null check (par between 3 and 6),
  stroke_index integer not null check (stroke_index between 1 and 18),
  source_stroke_index integer check (source_stroke_index between 1 and 18),
  display_label text,
  created_at timestamptz not null default now()
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  route_combination_id uuid references public.route_combinations(id) on delete set null,
  holes_count integer not null check (holes_count in (9, 18)),
  total_par integer not null,
  round_type text not null check (
    round_type in ('single_9', 'single_18', 'repeat_9', 'combined_9x2')
  ),
  selected_routes jsonb not null default '[]'::jsonb,
  gross_total integer,
  net_total integer,
  stableford_gross_total integer,
  stableford_net_total integer,
  estimated_hcp_after_round numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.round_holes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  route_id uuid not null references public.course_routes(id) on delete restrict,
  route_combination_id uuid references public.route_combinations(id) on delete set null,
  round_hole_number integer not null check (round_hole_number between 1 and 18),
  route_position integer not null check (route_position in (1, 2)),
  physical_hole_number integer not null check (physical_hole_number between 1 and 18),
  par integer not null check (par between 3 and 6),
  stroke_index integer check (stroke_index between 1 and 18),
  source_stroke_index integer check (source_stroke_index between 1 and 18),
  received_shots integer not null default 0 check (received_shots between 0 and 3),
  strokes integer not null default 0 check (strokes between 0 and 20),
  stableford_points integer not null default 0 check (stableford_points between 0 and 10),
  created_at timestamptz not null default now()
);

create table public.favorite_clubs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorite_clubs_user_id_club_id_key unique (user_id, club_id)
);

create table public.club_reports (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  reported_by uuid not null references auth.users(id) on delete cascade,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index clubs_name_normalized_idx on public.clubs(name_normalized);
create index clubs_created_by_idx on public.clubs(created_by);
create index course_routes_club_id_idx on public.course_routes(club_id);
create index route_holes_route_id_idx on public.route_holes(route_id);
create index route_combinations_club_id_idx on public.route_combinations(club_id);
create index route_combinations_front_route_id_idx on public.route_combinations(front_route_id);
create index route_combinations_back_route_id_idx on public.route_combinations(back_route_id);
create index route_combination_holes_combination_id_idx on public.route_combination_holes(route_combination_id);
create index route_combination_holes_route_id_idx on public.route_combination_holes(route_id);
create index rounds_user_id_idx on public.rounds(user_id);
create index rounds_club_id_idx on public.rounds(club_id);
create index rounds_route_combination_id_idx on public.rounds(route_combination_id);
create index round_holes_round_id_idx on public.round_holes(round_id);
create index round_holes_user_id_idx on public.round_holes(user_id);
create index round_holes_club_id_idx on public.round_holes(club_id);
create index round_holes_route_id_idx on public.round_holes(route_id);
create index round_holes_route_combination_id_idx on public.round_holes(route_combination_id);
create index favorite_clubs_user_id_idx on public.favorite_clubs(user_id);
create index favorite_clubs_club_id_idx on public.favorite_clubs(club_id);
create index club_reports_club_id_idx on public.club_reports(club_id);
create index club_reports_reported_by_idx on public.club_reports(reported_by);

alter table public.route_holes
  add constraint route_holes_route_id_physical_hole_number_key
  unique (route_id, physical_hole_number);

alter table public.route_combinations
  add constraint route_combinations_club_id_front_route_id_back_route_id_key
  unique (club_id, front_route_id, back_route_id);

alter table public.route_combination_holes
  add constraint route_combination_holes_round_hole_number_key
  unique (route_combination_id, round_hole_number);

alter table public.round_holes
  add constraint round_holes_round_id_round_hole_number_key
  unique (round_id, round_hole_number);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists clubs_set_updated_at on public.clubs;
create trigger clubs_set_updated_at
before update on public.clubs
for each row
execute function public.set_updated_at();

drop trigger if exists course_routes_set_updated_at on public.course_routes;
create trigger course_routes_set_updated_at
before update on public.course_routes
for each row
execute function public.set_updated_at();

drop trigger if exists route_combinations_set_updated_at on public.route_combinations;
create trigger route_combinations_set_updated_at
before update on public.route_combinations
for each row
execute function public.set_updated_at();

drop trigger if exists rounds_set_updated_at on public.rounds;
create trigger rounds_set_updated_at
before update on public.rounds
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.course_routes enable row level security;
alter table public.route_holes enable row level security;
alter table public.route_combinations enable row level security;
alter table public.route_combination_holes enable row level security;
alter table public.rounds enable row level security;
alter table public.round_holes enable row level security;
alter table public.favorite_clubs enable row level security;
alter table public.club_reports enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles
for select
using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
on public.profiles
for update
using (auth.uid() = id or public.is_admin())
with check (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin"
on public.profiles
for delete
using (public.is_admin());

drop policy if exists "clubs_select_authenticated" on public.clubs;
create policy "clubs_select_authenticated"
on public.clubs
for select
using (auth.role() = 'authenticated');

drop policy if exists "clubs_insert_authenticated" on public.clubs;
create policy "clubs_insert_authenticated"
on public.clubs
for insert
with check (
  auth.role() = 'authenticated'
  and created_by = auth.uid()
);

drop policy if exists "clubs_update_admin" on public.clubs;
create policy "clubs_update_admin"
on public.clubs
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "clubs_delete_admin" on public.clubs;
create policy "clubs_delete_admin"
on public.clubs
for delete
using (public.is_admin());

drop policy if exists "course_routes_select_authenticated" on public.course_routes;
create policy "course_routes_select_authenticated"
on public.course_routes
for select
using (auth.role() = 'authenticated');

drop policy if exists "course_routes_insert_authenticated" on public.course_routes;
create policy "course_routes_insert_authenticated"
on public.course_routes
for insert
with check (auth.role() = 'authenticated');

drop policy if exists "course_routes_update_admin" on public.course_routes;
create policy "course_routes_update_admin"
on public.course_routes
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "course_routes_delete_admin" on public.course_routes;
create policy "course_routes_delete_admin"
on public.course_routes
for delete
using (public.is_admin());

drop policy if exists "route_holes_select_authenticated" on public.route_holes;
create policy "route_holes_select_authenticated"
on public.route_holes
for select
using (auth.role() = 'authenticated');

drop policy if exists "route_holes_insert_authenticated" on public.route_holes;
create policy "route_holes_insert_authenticated"
on public.route_holes
for insert
with check (auth.role() = 'authenticated');

drop policy if exists "route_holes_update_admin" on public.route_holes;
create policy "route_holes_update_admin"
on public.route_holes
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "route_holes_delete_admin" on public.route_holes;
create policy "route_holes_delete_admin"
on public.route_holes
for delete
using (public.is_admin());

drop policy if exists "route_combinations_select_authenticated" on public.route_combinations;
create policy "route_combinations_select_authenticated"
on public.route_combinations
for select
using (auth.role() = 'authenticated');

drop policy if exists "route_combinations_insert_authenticated" on public.route_combinations;
create policy "route_combinations_insert_authenticated"
on public.route_combinations
for insert
with check (auth.role() = 'authenticated');

drop policy if exists "route_combinations_update_admin" on public.route_combinations;
create policy "route_combinations_update_admin"
on public.route_combinations
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "route_combinations_delete_admin" on public.route_combinations;
create policy "route_combinations_delete_admin"
on public.route_combinations
for delete
using (public.is_admin());

drop policy if exists "route_combination_holes_select_authenticated" on public.route_combination_holes;
create policy "route_combination_holes_select_authenticated"
on public.route_combination_holes
for select
using (auth.role() = 'authenticated');

drop policy if exists "route_combination_holes_insert_authenticated" on public.route_combination_holes;
create policy "route_combination_holes_insert_authenticated"
on public.route_combination_holes
for insert
with check (auth.role() = 'authenticated');

drop policy if exists "route_combination_holes_update_admin" on public.route_combination_holes;
create policy "route_combination_holes_update_admin"
on public.route_combination_holes
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "route_combination_holes_delete_admin" on public.route_combination_holes;
create policy "route_combination_holes_delete_admin"
on public.route_combination_holes
for delete
using (public.is_admin());

drop policy if exists "rounds_select_own" on public.rounds;
create policy "rounds_select_own"
on public.rounds
for select
using (auth.uid() = user_id);

drop policy if exists "rounds_insert_own" on public.rounds;
create policy "rounds_insert_own"
on public.rounds
for insert
with check (auth.uid() = user_id);

drop policy if exists "rounds_update_own" on public.rounds;
create policy "rounds_update_own"
on public.rounds
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "rounds_delete_own" on public.rounds;
create policy "rounds_delete_own"
on public.rounds
for delete
using (auth.uid() = user_id);

drop policy if exists "round_holes_select_own" on public.round_holes;
create policy "round_holes_select_own"
on public.round_holes
for select
using (auth.uid() = user_id);

drop policy if exists "round_holes_insert_own" on public.round_holes;
create policy "round_holes_insert_own"
on public.round_holes
for insert
with check (auth.uid() = user_id);

drop policy if exists "round_holes_update_own" on public.round_holes;
create policy "round_holes_update_own"
on public.round_holes
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "round_holes_delete_own" on public.round_holes;
create policy "round_holes_delete_own"
on public.round_holes
for delete
using (auth.uid() = user_id);

drop policy if exists "favorite_clubs_select_own" on public.favorite_clubs;
create policy "favorite_clubs_select_own"
on public.favorite_clubs
for select
using (auth.uid() = user_id);

drop policy if exists "favorite_clubs_insert_own" on public.favorite_clubs;
create policy "favorite_clubs_insert_own"
on public.favorite_clubs
for insert
with check (auth.uid() = user_id);

drop policy if exists "favorite_clubs_delete_own" on public.favorite_clubs;
create policy "favorite_clubs_delete_own"
on public.favorite_clubs
for delete
using (auth.uid() = user_id);

drop policy if exists "club_reports_select_own_or_admin" on public.club_reports;
create policy "club_reports_select_own_or_admin"
on public.club_reports
for select
using (reported_by = auth.uid() or public.is_admin());

drop policy if exists "club_reports_insert_authenticated" on public.club_reports;
create policy "club_reports_insert_authenticated"
on public.club_reports
for insert
with check (
  auth.role() = 'authenticated'
  and reported_by = auth.uid()
);

drop policy if exists "club_reports_update_admin" on public.club_reports;
create policy "club_reports_update_admin"
on public.club_reports
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "club_reports_delete_admin" on public.club_reports;
create policy "club_reports_delete_admin"
on public.club_reports
for delete
using (public.is_admin());
