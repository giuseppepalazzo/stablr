drop policy if exists "scorecard_storage_select_own_or_admin" on storage.objects;
create policy "scorecard_storage_select_own_or_admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'scorecard-submissions'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "scorecard_storage_insert_own_or_admin" on storage.objects;
create policy "scorecard_storage_insert_own_or_admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'scorecard-submissions'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "scorecard_storage_update_own_or_admin" on storage.objects;
create policy "scorecard_storage_update_own_or_admin"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'scorecard-submissions'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
)
with check (
  bucket_id = 'scorecard-submissions'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "scorecard_storage_delete_own_or_admin" on storage.objects;
create policy "scorecard_storage_delete_own_or_admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'scorecard-submissions'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);
