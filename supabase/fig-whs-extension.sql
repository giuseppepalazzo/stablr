-- Stablr FIG / WHS extension
--
-- Product direction:
-- FIG scraper -> JSON raw -> JSON normalizzato Stablr -> seed Supabase
--
-- This migration is additive and safe for the current schema.
-- It does not remove or rewrite the existing club / route flow.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Optional source metadata for curated FIG / WHS imports
-- ---------------------------------------------------------------------------

alter table public.clubs
  add column if not exists source_system text,
  add column if not exists source_external_id text,
  add column if not exists source_payload jsonb;

alter table public.course_routes
  add column if not exists source_system text,
  add column if not exists source_external_id text,
  add column if not exists source_payload jsonb;

alter table public.route_combinations
  add column if not exists source_system text,
  add column if not exists source_external_id text,
  add column if not exists source_payload jsonb;

create unique index if not exists clubs_source_system_source_external_id_key
  on public.clubs(source_system, source_external_id)
  where source_system is not null and source_external_id is not null;

create unique index if not exists course_routes_source_system_source_external_id_key
  on public.course_routes(source_system, source_external_id)
  where source_system is not null and source_external_id is not null;

create unique index if not exists route_combinations_source_system_source_external_id_key
  on public.route_combinations(source_system, source_external_id)
  where source_system is not null and source_external_id is not null;

-- ---------------------------------------------------------------------------
-- 2) FIG / WHS tee tables
-- ---------------------------------------------------------------------------

create table if not exists public.route_tees (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.course_routes(id) on delete cascade,
  tee_name text not null,
  tee_color text,
  gender text,
  course_rating numeric,
  slope_rating integer,
  par_total integer,
  source_system text,
  source_external_id text,
  source_payload jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_tees_slope_rating_check check (
    slope_rating is null or slope_rating between 55 and 155
  )
);

create table if not exists public.combination_tees (
  id uuid primary key default gen_random_uuid(),
  route_combination_id uuid not null references public.route_combinations(id) on delete cascade,
  tee_name text not null,
  tee_color text,
  gender text,
  course_rating numeric,
  slope_rating integer,
  par_total integer,
  source_system text,
  source_external_id text,
  source_payload jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint combination_tees_slope_rating_check check (
    slope_rating is null or slope_rating between 55 and 155
  )
);

create unique index if not exists route_tees_route_id_tee_name_key
  on public.route_tees(route_id, tee_name);

create unique index if not exists combination_tees_route_combination_id_tee_name_key
  on public.combination_tees(route_combination_id, tee_name);

create unique index if not exists route_tees_source_system_source_external_id_key
  on public.route_tees(source_system, source_external_id)
  where source_system is not null and source_external_id is not null;

create unique index if not exists combination_tees_source_system_source_external_id_key
  on public.combination_tees(source_system, source_external_id)
  where source_system is not null and source_external_id is not null;

create index if not exists route_tees_route_id_idx
  on public.route_tees(route_id);

create index if not exists combination_tees_route_combination_id_idx
  on public.combination_tees(route_combination_id);

-- ---------------------------------------------------------------------------
-- 3) Optional WHS snapshots on rounds
-- ---------------------------------------------------------------------------

alter table public.rounds
  add column if not exists selected_route_tee_id uuid references public.route_tees(id) on delete set null,
  add column if not exists selected_combination_tee_id uuid references public.combination_tees(id) on delete set null,
  add column if not exists handicap_index_snapshot numeric,
  add column if not exists playing_handicap integer,
  add column if not exists whs_source text;

create index if not exists rounds_selected_route_tee_id_idx
  on public.rounds(selected_route_tee_id);

create index if not exists rounds_selected_combination_tee_id_idx
  on public.rounds(selected_combination_tee_id);

-- ---------------------------------------------------------------------------
-- 4) updated_at triggers for new tee tables
-- ---------------------------------------------------------------------------

drop trigger if exists route_tees_set_updated_at on public.route_tees;
create trigger route_tees_set_updated_at
before update on public.route_tees
for each row
execute function public.set_updated_at();

drop trigger if exists combination_tees_set_updated_at on public.combination_tees;
create trigger combination_tees_set_updated_at
before update on public.combination_tees
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) RLS for new tee tables
-- ---------------------------------------------------------------------------

alter table public.route_tees enable row level security;
alter table public.combination_tees enable row level security;

drop policy if exists "route_tees_select_authenticated" on public.route_tees;
create policy "route_tees_select_authenticated"
on public.route_tees
for select
using (auth.role() = 'authenticated');

drop policy if exists "route_tees_insert_admin" on public.route_tees;
create policy "route_tees_insert_admin"
on public.route_tees
for insert
with check (public.is_admin());

drop policy if exists "route_tees_update_admin" on public.route_tees;
create policy "route_tees_update_admin"
on public.route_tees
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "route_tees_delete_admin" on public.route_tees;
create policy "route_tees_delete_admin"
on public.route_tees
for delete
using (public.is_admin());

drop policy if exists "combination_tees_select_authenticated" on public.combination_tees;
create policy "combination_tees_select_authenticated"
on public.combination_tees
for select
using (auth.role() = 'authenticated');

drop policy if exists "combination_tees_insert_admin" on public.combination_tees;
create policy "combination_tees_insert_admin"
on public.combination_tees
for insert
with check (public.is_admin());

drop policy if exists "combination_tees_update_admin" on public.combination_tees;
create policy "combination_tees_update_admin"
on public.combination_tees
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "combination_tees_delete_admin" on public.combination_tees;
create policy "combination_tees_delete_admin"
on public.combination_tees
for delete
using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6) Safe deletion helper for the local test club created during development
-- ---------------------------------------------------------------------------
--
-- 1. Inspect the target first:
--
-- select
--   c.id,
--   c.name,
--   c.name_normalized,
--   count(cr.id) as route_count
-- from public.clubs c
-- left join public.course_routes cr on cr.club_id = c.id
-- where c.name_normalized = 'mare di roma'
-- group by c.id, c.name, c.name_normalized
-- order by c.created_at desc;
--
-- 2. Then delete by exact id after verification:
--
-- begin;
--
-- delete from public.round_holes
-- where club_id = 'REPLACE_WITH_TARGET_CLUB_ID';
--
-- delete from public.rounds
-- where club_id = 'REPLACE_WITH_TARGET_CLUB_ID';
--
-- delete from public.clubs
-- where id = 'REPLACE_WITH_TARGET_CLUB_ID';
--
-- commit;
--
-- Notes:
-- - delete on clubs will cascade to:
--   course_routes
--   route_holes
--   route_combinations
--   route_combination_holes
--   route_tees
--   combination_tees
--   favorite_clubs
--   club_reports
-- - rounds / round_holes are deleted explicitly first because club_id uses restrict
