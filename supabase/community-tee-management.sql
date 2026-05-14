alter table public.route_tees
  add column if not exists holes_count integer check (holes_count in (9, 18)),
  add column if not exists estimated boolean not null default false;

update public.route_tees rt
set holes_count = cr.holes_count
from public.course_routes cr
where rt.route_id = cr.id
  and rt.holes_count is null;

alter table public.combination_tees
  add column if not exists holes_count integer check (holes_count in (9, 18)),
  add column if not exists estimated boolean not null default false;

update public.combination_tees ct
set holes_count = rc.holes_count
from public.route_combinations rc
where ct.route_combination_id = rc.id
  and ct.holes_count is null;

drop index if exists public.route_tees_route_id_tee_name_key;
create unique index if not exists route_tees_route_id_tee_name_holes_count_key
  on public.route_tees(route_id, tee_name, holes_count);

drop index if exists public.combination_tees_route_combination_id_tee_name_key;
create unique index if not exists combination_tees_route_combination_id_tee_name_holes_count_key
  on public.combination_tees(route_combination_id, tee_name, holes_count);
