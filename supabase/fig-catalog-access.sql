alter table public.fig_clubs enable row level security;
alter table public.fig_playable_courses enable row level security;
alter table public.fig_course_tees enable row level security;

drop policy if exists "fig_clubs_select_authenticated" on public.fig_clubs;
create policy "fig_clubs_select_authenticated"
on public.fig_clubs
for select
to authenticated
using (true);

drop policy if exists "fig_playable_courses_select_authenticated" on public.fig_playable_courses;
create policy "fig_playable_courses_select_authenticated"
on public.fig_playable_courses
for select
to authenticated
using (true);

drop policy if exists "fig_course_tees_select_authenticated" on public.fig_course_tees;
create policy "fig_course_tees_select_authenticated"
on public.fig_course_tees
for select
to authenticated
using (true);
