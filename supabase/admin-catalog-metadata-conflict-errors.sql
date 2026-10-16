-- Apply ONCE, AFTER admin-catalog-editor-metadata.sql. No data migration.
-- Application conflicts must not escape as serialization_failure (40001):
-- affected PostgREST versions retry that SQLSTATE inside the server transaction.
begin;

-- Preserve the complete implementation, signature, checks and NOWAIT locks.
-- Only the guarded API boundary translates the error. Shared workflow helpers
-- and historical migrations retain their contracts.
alter function public.admin_catalog_metadata(text,uuid,text,uuid,bigint,jsonb,text,text,uuid)
  rename to admin_catalog_metadata_before_conflict_errors;
revoke all on function public.admin_catalog_metadata_before_conflict_errors(text,uuid,text,uuid,bigint,jsonb,text,text,uuid)
  from public,anon,authenticated,service_role;

create function public.admin_catalog_metadata(p_kind text,p_target uuid,p_action text,p_draft_id uuid default null,
  p_expected_revision bigint default null,p_snapshot jsonb default null,p_confirmation_hash text default null,p_note text default null,p_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare conflict_message text; conflict_detail text; conflict_hint text;
begin
  perform public.admin_catalog_require_admin();
  -- The exception block is a subtransaction: any failed mutation, version, audit
  -- or draft closure rolls back before the non-retryable conflict is returned.
  return public.admin_catalog_metadata_before_conflict_errors(p_kind,p_target,p_action,p_draft_id,
    p_expected_revision,p_snapshot,p_confirmation_hash,p_note,p_version_id);
exception when sqlstate '40001' then
  get stacked diagnostics conflict_message=message_text, conflict_detail=pg_exception_detail, conflict_hint=pg_exception_hint;
  raise sqlstate 'PT409' using message=conflict_message, detail=coalesce(conflict_detail,''), hint=coalesce(conflict_hint,'');
end $$;

revoke all on function public.admin_catalog_metadata(text,uuid,text,uuid,bigint,jsonb,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_catalog_metadata(text,uuid,text,uuid,bigint,jsonb,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
