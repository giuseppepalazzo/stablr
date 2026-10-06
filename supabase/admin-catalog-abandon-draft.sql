-- Admin-only non-destructive draft abandonment.
-- Apply manually AFTER admin-catalog-workflow.sql and admin-club-editor.sql.
-- Compatible with Club drafts and Percorso drafts from admin-course-editor.sql.
-- One-shot transaction. No live writes, deletes, versions or policy changes.
begin;

create function public.admin_catalog_archive_draft(
  p_draft_id uuid,
  p_entity_type text,
  p_expected_revision bigint
)
returns public.admin_catalog_drafts
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  result public.admin_catalog_drafts;
begin
  actor := public.admin_catalog_require_admin();
  if p_entity_type is null or p_entity_type not in (
    'club', 'course', 'route', 'route_combination', 'hole',
    'combination_hole', 'route_tee', 'combination_tee'
  ) then
    raise exception 'Unsupported catalog entity type' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'Expected draft revision is required' using errcode = '22023';
  end if;

  -- Atomic compare-and-swap. Ownership, type and open state must all match.
  -- No live table or versions table is referenced or changed.
  update public.admin_catalog_drafts as d
    set workflow_status = 'archived', revision = d.revision + 1,
        updated_by = actor, updated_at = clock_timestamp()
    where d.draft_id = p_draft_id
      and d.entity_type = p_entity_type
      and d.created_by = actor
      and d.workflow_status = 'draft'
      and d.revision = p_expected_revision
    returning d.* into result;
  if not found then
    raise exception 'Owned open draft missing or changed' using errcode = '40001';
  end if;
  return result;
end;
$$;

revoke all on function public.admin_catalog_archive_draft(uuid, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_catalog_archive_draft(uuid, text, bigint)
  to authenticated;

notify pgrst, 'reload schema';
commit;
