-- Explicit Data API grants for current public tables.
--
-- Why this file exists:
-- Supabase is changing the default exposure of new public-schema tables to the
-- Data API. RLS alone is not enough; future tables also need explicit GRANTs
-- to be reachable through PostgREST / GraphQL / supabase-js.
--
-- This script is intentionally additive:
-- - no REVOKE statements
-- - no policy changes
-- - no schema changes
--
-- Safe usage:
-- 1. Run after schema creation and RLS/policies.
-- 2. Re-run after adding new tables to keep grants aligned.

grant usage on schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read-only FIG catalog exposed to authenticated app clients.
-- ---------------------------------------------------------------------------
grant select on table public.fig_clubs to authenticated, service_role;
grant select on table public.fig_playable_courses to authenticated, service_role;
grant select on table public.fig_course_tees to authenticated, service_role;

-- Import batches are internal/admin-facing.
grant select, insert, update, delete on table public.fig_import_batches to service_role;

-- ---------------------------------------------------------------------------
-- Shared Stablr catalog and gameplay tables.
-- We grant CRUD to `authenticated` and rely on RLS to enforce who can really do
-- what (own rows vs admin-only updates, etc.).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on table public.profiles to authenticated, service_role;
grant select, insert, update, delete on table public.clubs to authenticated, service_role;
grant select, insert, update, delete on table public.course_routes to authenticated, service_role;
grant select, insert, update, delete on table public.route_holes to authenticated, service_role;
grant select, insert, update, delete on table public.route_combinations to authenticated, service_role;
grant select, insert, update, delete on table public.route_combination_holes to authenticated, service_role;
grant select, insert, update, delete on table public.route_tees to authenticated, service_role;
grant select, insert, update, delete on table public.combination_tees to authenticated, service_role;

grant select, insert, update, delete on table public.rounds to authenticated, service_role;
grant select, insert, update, delete on table public.round_holes to authenticated, service_role;
grant select, insert, update, delete on table public.favorite_clubs to authenticated, service_role;
grant select, insert, update, delete on table public.club_reports to authenticated, service_role;
grant select, insert, update, delete on table public.club_requests to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Scorecard staging / review tables.
-- Again, CRUD is granted to `authenticated`, while RLS keeps drafts private,
-- limits photo contribution, and protects publish/admin flows.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on table public.scorecard_submissions to authenticated, service_role;
grant select, insert, update, delete on table public.scorecard_submission_images to authenticated, service_role;
grant select, insert, update, delete on table public.scorecard_extracted_holes to authenticated, service_role;
grant select, insert, update, delete on table public.scorecard_versions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Template for future tables:
--
-- create table public.example (...);
-- alter table public.example enable row level security;
-- create policy ...;
-- grant select, insert, update, delete on table public.example to authenticated, service_role;
--
-- If the table should be read-only for clients:
-- grant select on table public.example to authenticated, service_role;
--
-- If the table should be service-only:
-- grant select, insert, update, delete on table public.example to service_role;
-- ---------------------------------------------------------------------------
