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

create table if not exists public.fig_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'fig' check (source_system in ('fig')),
  source_url text not null,
  source_version text,
  scraped_at timestamptz not null,
  imported_at timestamptz not null default now(),
  status text not null default 'imported' check (status in ('imported', 'failed', 'superseded')),
  notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fig_clubs (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.fig_import_batches(id) on delete set null,
  source_system text not null default 'fig' check (source_system in ('fig')),
  source_external_id text not null,
  name text not null,
  name_normalized text not null,
  city text,
  region text,
  country text not null default 'Italia',
  is_active boolean not null default true,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fig_clubs_source_key unique (source_system, source_external_id)
);

create table if not exists public.fig_playable_courses (
  id uuid primary key default gen_random_uuid(),
  fig_club_id uuid not null references public.fig_clubs(id) on delete cascade,
  source_system text not null default 'fig' check (source_system in ('fig')),
  source_external_id text not null,
  name text not null,
  name_normalized text not null,
  holes_count integer not null check (holes_count in (9, 18)),
  total_par integer,
  course_type text not null check (
    course_type in ('single_9', 'single_18', 'repeat_9', 'combination_18', 'other_18')
  ),
  route_family text not null default 'base' check (route_family in ('base', 'official', 'optional')),
  display_order integer,
  course_composition jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fig_playable_courses_source_key unique (source_system, source_external_id)
);

create table if not exists public.fig_course_tees (
  id uuid primary key default gen_random_uuid(),
  fig_playable_course_id uuid not null references public.fig_playable_courses(id) on delete cascade,
  source_system text not null default 'fig' check (source_system in ('fig')),
  source_external_id text not null,
  tee_name text not null,
  tee_color text,
  gender text not null default '',
  course_rating numeric,
  slope_rating integer,
  par_total integer,
  tee_order integer,
  is_active boolean not null default true,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fig_course_tees_source_key unique (source_system, source_external_id),
  constraint fig_course_tees_course_name_gender_key unique (
    fig_playable_course_id,
    tee_name,
    gender
  )
);

create index if not exists fig_import_batches_scraped_at_idx
  on public.fig_import_batches(scraped_at desc);

create index if not exists fig_clubs_name_normalized_idx
  on public.fig_clubs(name_normalized);

create index if not exists fig_clubs_city_idx
  on public.fig_clubs(city);

create index if not exists fig_clubs_region_idx
  on public.fig_clubs(region);

create index if not exists fig_playable_courses_club_id_idx
  on public.fig_playable_courses(fig_club_id);

create index if not exists fig_playable_courses_name_normalized_idx
  on public.fig_playable_courses(name_normalized);

create index if not exists fig_playable_courses_holes_count_idx
  on public.fig_playable_courses(holes_count);

create index if not exists fig_playable_courses_course_type_idx
  on public.fig_playable_courses(course_type);

create index if not exists fig_playable_courses_route_family_idx
  on public.fig_playable_courses(route_family);

create index if not exists fig_course_tees_course_id_idx
  on public.fig_course_tees(fig_playable_course_id);

create index if not exists fig_course_tees_tee_name_idx
  on public.fig_course_tees(tee_name);

drop trigger if exists fig_clubs_set_updated_at on public.fig_clubs;
create trigger fig_clubs_set_updated_at
before update on public.fig_clubs
for each row
execute function public.set_updated_at();

drop trigger if exists fig_playable_courses_set_updated_at on public.fig_playable_courses;
create trigger fig_playable_courses_set_updated_at
before update on public.fig_playable_courses
for each row
execute function public.set_updated_at();

drop trigger if exists fig_course_tees_set_updated_at on public.fig_course_tees;
create trigger fig_course_tees_set_updated_at
before update on public.fig_course_tees
for each row
execute function public.set_updated_at();
