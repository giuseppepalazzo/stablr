-- Apply ONCE after foundation Phases 1–3c, BEFORE admin-catalog-multi9.sql.
-- No data migration, table/policy changes, live DML or new public endpoint.
begin;

-- The existing club row is a stable, collision-free namespace. All structure
-- writers and the multi9 batch acquire this same transaction-duration lock.
-- NO KEY UPDATE conflicts with another reviewer, but not player FK KEY SHARE.
create function public.admin_catalog_structure_club_lock(p_club_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.admin_catalog_require_admin();
  -- Re-inspection after the lock must see the latest committed structures.
  -- A pre-existing REPEATABLE READ snapshot cannot provide that guarantee.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Club structure operations require READ COMMITTED isolation' using errcode='25001';
  end if;
  if p_club_id is null then raise exception 'Existing club required' using errcode='22023'; end if;
  perform id from public.clubs where id=p_club_id for no key update nowait;
  if not found then raise exception 'Existing club required' using errcode='22023'; end if;
end $$;

create or replace function public.admin_catalog_foundation_create_structure(
  p_club_id uuid,p_label text,p_source_system text,p_source_reference text,p_reason text
)
returns public.admin_catalog_physical_structures language plpgsql security definer set search_path=pg_catalog as $$
declare result public.admin_catalog_physical_structures;
begin
  perform public.admin_catalog_require_admin();
  perform public.admin_catalog_structure_club_lock(p_club_id);
  insert into public.admin_catalog_physical_structures(club_id,label,source_system,source_reference,reason)
    values(p_club_id,btrim(p_label),p_source_system,btrim(p_source_reference),btrim(p_reason)) returning * into result;
  return result;
end $$;

create or replace function public.admin_catalog_foundation_review_structure(
  p_structure_id uuid,p_expected_revision bigint,p_classification text,
  p_source_system text,p_source_reference text,p_reason text,p_confirm_verified boolean default false
)
returns public.admin_catalog_physical_structures language plpgsql security definer set search_path=pg_catalog as $$
declare result public.admin_catalog_physical_structures; target_club_id uuid;
begin
  perform public.admin_catalog_require_admin();
  if p_confirm_verified is null then raise exception 'Explicit review confirmation required' using errcode='22023'; end if;
  select club_id into target_club_id from public.admin_catalog_physical_structures where id=p_structure_id;
  if not found then raise exception 'Structure missing or revision changed' using errcode='40001'; end if;
  perform public.admin_catalog_structure_club_lock(target_club_id);
  -- Re-read the structure only after locking the whole club, before any DML.
  select s.* into result from public.admin_catalog_physical_structures s where s.id=p_structure_id for update nowait;
  if not found or result.club_id is distinct from target_club_id
    or p_expected_revision is null or result.revision<>p_expected_revision then
    raise exception 'Structure missing or revision changed' using errcode='40001';
  end if;
  if p_confirm_verified and p_classification='non_classificato' then
    raise exception 'Unclassified structure cannot be verified' using errcode='22023';
  end if;
  update public.admin_catalog_physical_structures set classification=p_classification,
    review_status=case when p_confirm_verified then 'verified' else 'needs_review' end,
    source_system=p_source_system,source_reference=btrim(p_source_reference),reason=btrim(p_reason)
    where id=p_structure_id returning * into result;
  return result;
end $$;

revoke all on function public.admin_catalog_structure_club_lock(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_create_structure(uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_catalog_foundation_review_structure(uuid,bigint,text,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_foundation_create_structure(uuid,text,text,text,text) to authenticated;
grant execute on function public.admin_catalog_foundation_review_structure(uuid,bigint,text,text,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
