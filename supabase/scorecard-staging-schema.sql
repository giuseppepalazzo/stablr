alter table public.clubs
  add column if not exists club_taxonomy text
    check (club_taxonomy in ('simple_single', 'simple_multi', 'complex_official'));

create index if not exists clubs_club_taxonomy_idx
  on public.clubs(club_taxonomy);

create table if not exists public.scorecard_submissions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id) on delete set null,
  fig_club_id uuid not null references public.fig_clubs(id) on delete restrict,
  fig_playable_course_id uuid not null references public.fig_playable_courses(id) on delete restrict,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  submission_type text not null
    check (submission_type in ('manual', 'photo', 'admin')),
  review_status text not null default 'draft_private'
    check (review_status in ('draft_private', 'in_review', 'rejected', 'published', 'superseded')),
  source_type text not null default 'community'
    check (source_type in ('community', 'stablr', 'photo_upload', 'admin')),
  confidence numeric,
  notes text,
  submitted_payload jsonb not null default '{}'::jsonb,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scorecard_submissions_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create table if not exists public.scorecard_submission_images (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.scorecard_submissions(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  image_order integer not null default 1 check (image_order >= 1),
  image_kind text not null default 'scorecard'
    check (image_kind in ('scorecard', 'supporting')),
  created_at timestamptz not null default now()
);

create table if not exists public.scorecard_extracted_holes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.scorecard_submissions(id) on delete cascade,
  hole_number integer not null check (hole_number between 1 and 18),
  par integer check (par between 3 and 6),
  stroke_index integer check (stroke_index between 1 and 18),
  display_label text,
  confidence numeric,
  raw_extraction jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scorecard_extracted_holes_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint scorecard_extracted_holes_submission_hole_key
    unique (submission_id, hole_number)
);

create table if not exists public.scorecard_versions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id) on delete set null,
  fig_club_id uuid not null references public.fig_clubs(id) on delete restrict,
  fig_playable_course_id uuid not null references public.fig_playable_courses(id) on delete restrict,
  source_submission_id uuid not null references public.scorecard_submissions(id) on delete restrict,
  route_id uuid references public.course_routes(id) on delete set null,
  route_combination_id uuid references public.route_combinations(id) on delete set null,
  version_number integer not null check (version_number >= 1),
  status text not null
    check (status in ('published', 'superseded')),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scorecard_versions_target_check
    check (
      (route_id is not null and route_combination_id is null)
      or (route_id is null and route_combination_id is not null)
    ),
  constraint scorecard_versions_version_key
    unique (fig_playable_course_id, version_number)
);

create index if not exists scorecard_submissions_club_id_idx
  on public.scorecard_submissions(club_id);

create index if not exists scorecard_submissions_fig_club_id_idx
  on public.scorecard_submissions(fig_club_id);

create index if not exists scorecard_submissions_fig_playable_course_id_idx
  on public.scorecard_submissions(fig_playable_course_id);

create index if not exists scorecard_submissions_submitted_by_idx
  on public.scorecard_submissions(submitted_by);

create index if not exists scorecard_submissions_review_status_idx
  on public.scorecard_submissions(review_status);

create index if not exists scorecard_submission_images_submission_id_idx
  on public.scorecard_submission_images(submission_id);

create index if not exists scorecard_submission_images_uploaded_by_idx
  on public.scorecard_submission_images(uploaded_by);

create index if not exists scorecard_extracted_holes_submission_id_idx
  on public.scorecard_extracted_holes(submission_id);

create index if not exists scorecard_versions_fig_playable_course_id_idx
  on public.scorecard_versions(fig_playable_course_id);

create index if not exists scorecard_versions_source_submission_id_idx
  on public.scorecard_versions(source_submission_id);

create unique index if not exists scorecard_submissions_active_per_course_idx
  on public.scorecard_submissions(fig_playable_course_id)
  where review_status in ('draft_private', 'in_review');

create unique index if not exists scorecard_versions_live_per_course_idx
  on public.scorecard_versions(fig_playable_course_id)
  where status = 'published';

create unique index if not exists scorecard_submissions_publish_source_once_idx
  on public.scorecard_versions(source_submission_id)
  where status = 'published';

create trigger set_scorecard_submissions_updated_at
before update on public.scorecard_submissions
for each row execute function public.set_updated_at();

create trigger set_scorecard_extracted_holes_updated_at
before update on public.scorecard_extracted_holes
for each row execute function public.set_updated_at();

create trigger set_scorecard_versions_updated_at
before update on public.scorecard_versions
for each row execute function public.set_updated_at();
