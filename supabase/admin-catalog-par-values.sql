-- Incremental validation fix, after admin-catalog-par-workflow.sql.
-- No row updates or new constraints: historical Par remains unchanged.
begin;

-- Keep existing RPC bodies, locks, ownership/CAS checks and permissions.
-- Validate only the newly requested/saved Par, immediately before planning
-- and before the publisher can perform any writes.
do $$
declare item record; body text; needle text; replacement text;
begin
  for item in select * from (values
    ('public.admin_catalog_par_save(uuid,bigint,integer)',
      'p:=public.admin_catalog_par_plan(d.physical_hole_id,p_new_par,d.id);', 'p_new_par'),
    ('public.admin_catalog_par_publish(uuid,bigint,text,text,boolean)',
      'p:=public.admin_catalog_par_plan(d.physical_hole_id,d.new_par,d.id);', 'd.new_par'),
    ('public.admin_catalog_local_par_save(uuid,bigint,integer,boolean)',
      'plan:=public.admin_catalog_local_par_plan(d.target_type,d.target_id,d.hole_id,p_par,p_override,d.id);', 'p_par'),
    ('public.admin_catalog_local_par_publish(uuid,bigint,text,text,boolean)',
      'plan:=public.admin_catalog_local_par_plan(d.target_type,d.target_id,d.hole_id,d.new_par,d.create_override,d.id);', 'd.new_par')
  ) x(signature,plan_call,value_expression) loop
    select pg_get_functiondef(item.signature::regprocedure) into body;
    needle:=item.plan_call;
    if strpos(body,needle)=0 or strpos(body,'New Par must be 3, 4 or 5')>0 then
      raise exception 'Unexpected or already patched Par RPC contract: %',item.signature;
    end if;
    replacement:=format('if %1$s is null or %1$s not between 3 and 5 then raise exception ''New Par must be 3, 4 or 5'' using errcode=''22023'';end if;',item.value_expression);
    execute replace(body,needle,replacement||E'\n  '||needle);
  end loop;
end $$;

-- The grid still accepts an unchanged historical value, identified by the
-- exact row ID in its immutable base. A changed value must be 3, 4 or 5.
-- Snapshot allowlists, immutable identities, SI and publication checks stay.
do $$
declare item record; body text; needle text;
begin
  for item in select * from (values
    ('public.admin_course_hole_grid_validate_snapshot(jsonb,jsonb)',
      '(h -> ''par'' <> ''null''::jsonb and (h ->> ''par'') !~ ''^[3-6]$'')'),
    ('public.admin_hole_grid_validate_snapshot(jsonb,jsonb)',
      '(h -> ''par'' <> ''null''::jsonb and ((h ->> ''par'') !~ ''^[3-6]$''))')
  ) x(signature,old_par_check) loop
    select pg_get_functiondef(item.signature::regprocedure) into body;
    if strpos(body,item.old_par_check)=0 or strpos(body,'items := items || jsonb_build_array(h);')=0 then
      raise exception 'Unexpected hole grid validation contract: %',item.signature;
    end if;
    -- Do not impose the new range on the captured historical value.
    body:=replace(body,item.old_par_check,
      '(h -> ''par'' <> ''null''::jsonb and (h ->> ''par'') !~ ''^-?[0-9]+$'')');
    needle:='items := items || jsonb_build_array(h);';
    execute replace(body,needle,
      'if h -> ''par'' is distinct from expected -> ''par'' and h -> ''par'' <> ''null''::jsonb and (h ->> ''par'') !~ ''^[3-5]$'' then
        raise exception ''New Par must be 3, 4 or 5'' using errcode=''22023'';
      end if;
      '||needle);
  end loop;
end $$;

notify pgrst,'reload schema';
commit;
