select
  c.id as club_id,
  c.name as club_name,
  c.name_normalized,
  c.data_status,
  c.source_type,
  c.source_system,
  c.source_external_id,
  c.playable,
  c.is_complex
from public.clubs c
where c.source_external_id = 'fig-club-albisola';

select
  cr.id as route_id,
  cr.name as route_name,
  cr.holes_count,
  cr.total_par,
  cr.display_order,
  cr.source_system,
  cr.source_external_id,
  count(distinct rh.id) as holes_count_loaded,
  count(distinct rt.id) as tees_count_loaded
from public.course_routes cr
left join public.route_holes rh on rh.route_id = cr.id
left join public.route_tees rt on rt.route_id = cr.id
where cr.source_external_id in (
  'fig-course-albisola-18-buche-par-64',
  'fig-course-albisola-18-buche-par-65',
  'fig-course-albisola-18-buche-par-66',
  'fig-course-albisola-9-buche-par-32',
  'fig-course-albisola-9-buche-par-33'
)
group by cr.id, cr.name, cr.holes_count, cr.total_par, cr.display_order, cr.source_system, cr.source_external_id
order by cr.display_order asc, cr.name asc;

select
  cr.name as route_name,
  rh.physical_hole_number,
  rh.par,
  rh.stroke_index
from public.course_routes cr
join public.route_holes rh on rh.route_id = cr.id
where cr.source_external_id = 'fig-course-albisola-9-buche-par-32'
order by rh.physical_hole_number asc;
