-- Seed Aosta Arsanieres from FIG + GesGolf normalized import.
-- Idempotente: aggiorna solo club, route, buche e tee con source_external_id FIG di Aosta.

do $$
declare
  v_created_by uuid := '257b01b3-32eb-4b6d-be0b-8ce2e4afc397';
  v_club_id uuid;
  v_route_18 uuid;
  v_route_9 uuid;
begin
  insert into public.clubs (
    name, name_normalized, city, country, created_by, data_status, source_type,
    is_complex, playable, is_active, source_system, source_external_id, source_payload
  ) values (
    'Aosta Arsanieres', 'aosta arsanieres', null, 'Italia', v_created_by, 'verified', 'fig_import',
    false, true, true, 'fig', 'fig-club-aosta-arsanieres', '{"kind":"club","official_catalog":"fig","hole_by_hole_source":"gesgolf","physical_hole_count":9,"import_profile":"physical_9_with_official_18_variants","gesgolf":{"circolo_id":"105","gesgolf_club":"AOSTA ARSANIERES"}}'::jsonb
  )
  on conflict (source_system, source_external_id) where source_system is not null and source_external_id is not null
  do update set
    name = excluded.name,
    name_normalized = excluded.name_normalized,
    city = excluded.city,
    country = excluded.country,
    data_status = excluded.data_status,
    source_type = excluded.source_type,
    is_complex = excluded.is_complex,
    playable = excluded.playable,
    is_active = excluded.is_active,
    source_payload = excluded.source_payload
  returning id into v_club_id;

  insert into public.course_routes (
    club_id, name, holes_count, total_par, display_order, is_active, source_system, source_external_id, source_payload
  ) values (
    v_club_id, '18 Buche', 18, 62, 1, true, 'fig', 'fig-course-aosta-arsanieres-18-buche', '{"kind":"route","official_catalog":"fig","hole_by_hole_source":"gesgolf","gesgolf":{"circolo_id":"105","gesgolf_club":"AOSTA ARSANIERES","route_name":"Aosta 18 buche","playable_kind":"official_18","percorso_id":"2460"}}'::jsonb
  )
  on conflict (source_system, source_external_id) where source_system is not null and source_external_id is not null
  do update set
    club_id = excluded.club_id,
    name = excluded.name,
    holes_count = excluded.holes_count,
    total_par = excluded.total_par,
    display_order = excluded.display_order,
    is_active = excluded.is_active,
    source_payload = excluded.source_payload
  returning id into v_route_18;

  delete from public.route_holes where route_id = v_route_18;
  insert into public.route_holes (route_id, physical_hole_number, par, stroke_index, display_label) values
    (v_route_18, 1, 3, 15, '1'),
    (v_route_18, 2, 4, 5, '2'),
    (v_route_18, 3, 4, 7, '3'),
    (v_route_18, 4, 4, 9, '4'),
    (v_route_18, 5, 3, 11, '5'),
    (v_route_18, 6, 3, 17, '6'),
    (v_route_18, 7, 3, 1, '7'),
    (v_route_18, 8, 4, 3, '8'),
    (v_route_18, 9, 3, 13, '9'),
    (v_route_18, 10, 3, 16, '10'),
    (v_route_18, 11, 4, 6, '11'),
    (v_route_18, 12, 4, 8, '12'),
    (v_route_18, 13, 4, 10, '13'),
    (v_route_18, 14, 3, 12, '14'),
    (v_route_18, 15, 3, 18, '15'),
    (v_route_18, 16, 3, 2, '16'),
    (v_route_18, 17, 4, 4, '17'),
    (v_route_18, 18, 3, 14, '18');

  delete from public.route_tees where route_id = v_route_18;
  insert into public.route_tees (
    route_id, tee_name, tee_color, gender, course_rating, slope_rating, par_total, source_system, source_external_id, source_payload, is_active
  ) values
    (v_route_18, 'Giallo', 'yellow', 'men', 61.1, 112, 62, 'fig', 'fig-tee-aosta-arsanieres-18-buche-giallo-men', '{"kind":"tee","source_cells":{"course_rating":"61.1","slope_rating":"112"},"official_catalog":"fig"}'::jsonb, true),
    (v_route_18, 'Verde', 'green', 'men', 58.6, 106, 62, 'fig', 'fig-tee-aosta-arsanieres-18-buche-verde-men', '{"kind":"tee","source_cells":{"course_rating":"58.6","slope_rating":"106"},"official_catalog":"fig"}'::jsonb, true),
    (v_route_18, 'Rosso', 'red', 'women', 59.2, 107, 62, 'fig', 'fig-tee-aosta-arsanieres-18-buche-rosso-women', '{"kind":"tee","source_cells":{"course_rating":"59.2","slope_rating":"107"},"official_catalog":"fig"}'::jsonb, true),
    (v_route_18, 'Arancio', 'orange', 'women', 59.2, 107, 62, 'fig', 'fig-tee-aosta-arsanieres-18-buche-arancio-women', '{"kind":"tee","source_cells":{"course_rating":"59.2","slope_rating":"107"},"official_catalog":"fig"}'::jsonb, true);

  insert into public.course_routes (
    club_id, name, holes_count, total_par, display_order, is_active, source_system, source_external_id, source_payload
  ) values (
    v_club_id, '9 Buche', 9, 31, 2, true, 'fig', 'fig-course-aosta-arsanieres-9-buche', '{"kind":"route","official_catalog":"fig","hole_by_hole_source":"gesgolf","gesgolf":{"circolo_id":"105","gesgolf_club":"AOSTA ARSANIERES","route_name":"9 buche","playable_kind":"base_9","percorso_id":"2487"}}'::jsonb
  )
  on conflict (source_system, source_external_id) where source_system is not null and source_external_id is not null
  do update set
    club_id = excluded.club_id,
    name = excluded.name,
    holes_count = excluded.holes_count,
    total_par = excluded.total_par,
    display_order = excluded.display_order,
    is_active = excluded.is_active,
    source_payload = excluded.source_payload
  returning id into v_route_9;

  delete from public.route_holes where route_id = v_route_9;
  insert into public.route_holes (route_id, physical_hole_number, par, stroke_index, display_label) values
    (v_route_9, 1, 3, 15, '1'),
    (v_route_9, 2, 4, 5, '2'),
    (v_route_9, 3, 4, 7, '3'),
    (v_route_9, 4, 4, 9, '4'),
    (v_route_9, 5, 3, 11, '5'),
    (v_route_9, 6, 3, 17, '6'),
    (v_route_9, 7, 3, 1, '7'),
    (v_route_9, 8, 4, 3, '8'),
    (v_route_9, 9, 3, 13, '9');

  delete from public.route_tees where route_id = v_route_9;
  insert into public.route_tees (
    route_id, tee_name, tee_color, gender, course_rating, slope_rating, par_total, source_system, source_external_id, source_payload, is_active
  ) values
    (v_route_9, 'Giallo', 'yellow', 'men', 30.6, 112, 31, 'fig', 'fig-tee-aosta-arsanieres-9-buche-giallo-men', '{"kind":"tee","source_cells":{"course_rating":"30.6","slope_rating":"112"},"official_catalog":"fig"}'::jsonb, true),
    (v_route_9, 'Verde', 'green', 'men', 29.3, 106, 31, 'fig', 'fig-tee-aosta-arsanieres-9-buche-verde-men', '{"kind":"tee","source_cells":{"course_rating":"29.3","slope_rating":"106"},"official_catalog":"fig"}'::jsonb, true),
    (v_route_9, 'Rosso', 'red', 'women', 29.6, 107, 31, 'fig', 'fig-tee-aosta-arsanieres-9-buche-rosso-women', '{"kind":"tee","source_cells":{"course_rating":"29.6","slope_rating":"107"},"official_catalog":"fig"}'::jsonb, true);
end $$;

select
  c.name,
  c.source_external_id,
  c.source_payload ->> 'physical_hole_count' as physical_hole_count,
  c.source_payload ->> 'import_profile' as import_profile
from public.clubs c
where c.source_external_id = 'fig-club-aosta-arsanieres';

select
  cr.name,
  cr.holes_count,
  cr.total_par,
  count(rh.id) as loaded_holes
from public.course_routes cr
left join public.route_holes rh on rh.route_id = cr.id
where cr.source_external_id in (
  'fig-course-aosta-arsanieres-18-buche',
  'fig-course-aosta-arsanieres-9-buche'
)
group by cr.id, cr.name, cr.holes_count, cr.total_par
order by cr.holes_count desc;
