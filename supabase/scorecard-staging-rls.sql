alter table public.scorecard_submissions enable row level security;
alter table public.scorecard_submission_images enable row level security;
alter table public.scorecard_extracted_holes enable row level security;
alter table public.scorecard_versions enable row level security;

drop policy if exists "scorecard_submissions_select_own_or_admin" on public.scorecard_submissions;
create policy "scorecard_submissions_select_own_or_admin"
on public.scorecard_submissions
for select
using (submitted_by = auth.uid() or public.is_admin());

drop policy if exists "scorecard_submissions_insert_own" on public.scorecard_submissions;
create policy "scorecard_submissions_insert_own"
on public.scorecard_submissions
for insert
with check (
  auth.role() = 'authenticated'
  and submitted_by = auth.uid()
  and review_status = 'draft_private'
);

drop policy if exists "scorecard_submissions_update_own_draft_or_admin" on public.scorecard_submissions;
create policy "scorecard_submissions_update_own_draft_or_admin"
on public.scorecard_submissions
for update
using (
  public.is_admin()
  or (
    submitted_by = auth.uid()
    and review_status = 'draft_private'
  )
)
with check (
  public.is_admin()
  or (
    submitted_by = auth.uid()
    and review_status in ('draft_private', 'in_review', 'rejected')
  )
);

drop policy if exists "scorecard_submissions_delete_own_draft_or_admin" on public.scorecard_submissions;
create policy "scorecard_submissions_delete_own_draft_or_admin"
on public.scorecard_submissions
for delete
using (
  public.is_admin()
  or (
    submitted_by = auth.uid()
    and review_status = 'draft_private'
  )
);

drop policy if exists "scorecard_submission_images_select_related_or_admin" on public.scorecard_submission_images;
create policy "scorecard_submission_images_select_related_or_admin"
on public.scorecard_submission_images
for select
using (
  public.is_admin()
  or uploaded_by = auth.uid()
  or exists (
    select 1
    from public.scorecard_submissions submission
    where submission.id = scorecard_submission_images.submission_id
      and submission.submitted_by = auth.uid()
  )
);

drop policy if exists "scorecard_submission_images_insert_allowed_or_admin" on public.scorecard_submission_images;
create policy "scorecard_submission_images_insert_allowed_or_admin"
on public.scorecard_submission_images
for insert
with check (
  public.is_admin()
  or (
    uploaded_by = auth.uid()
    and exists (
      select 1
      from public.scorecard_submissions submission
      where submission.id = scorecard_submission_images.submission_id
        and submission.review_status in ('draft_private', 'in_review')
    )
  )
);

drop policy if exists "scorecard_submission_images_delete_own_or_admin" on public.scorecard_submission_images;
create policy "scorecard_submission_images_delete_own_or_admin"
on public.scorecard_submission_images
for delete
using (
  public.is_admin()
  or uploaded_by = auth.uid()
  or exists (
    select 1
    from public.scorecard_submissions submission
    where submission.id = scorecard_submission_images.submission_id
      and submission.submitted_by = auth.uid()
      and submission.review_status = 'draft_private'
  )
);

drop policy if exists "scorecard_extracted_holes_select_own_or_admin" on public.scorecard_extracted_holes;
create policy "scorecard_extracted_holes_select_own_or_admin"
on public.scorecard_extracted_holes
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.scorecard_submissions submission
    where submission.id = scorecard_extracted_holes.submission_id
      and submission.submitted_by = auth.uid()
  )
);

drop policy if exists "scorecard_extracted_holes_insert_own_draft_or_admin" on public.scorecard_extracted_holes;
create policy "scorecard_extracted_holes_insert_own_draft_or_admin"
on public.scorecard_extracted_holes
for insert
with check (
  public.is_admin()
  or exists (
    select 1
    from public.scorecard_submissions submission
    where submission.id = scorecard_extracted_holes.submission_id
      and submission.submitted_by = auth.uid()
      and submission.review_status = 'draft_private'
  )
);

drop policy if exists "scorecard_extracted_holes_update_own_draft_or_admin" on public.scorecard_extracted_holes;
create policy "scorecard_extracted_holes_update_own_draft_or_admin"
on public.scorecard_extracted_holes
for update
using (
  public.is_admin()
  or exists (
    select 1
    from public.scorecard_submissions submission
    where submission.id = scorecard_extracted_holes.submission_id
      and submission.submitted_by = auth.uid()
      and submission.review_status = 'draft_private'
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.scorecard_submissions submission
    where submission.id = scorecard_extracted_holes.submission_id
      and submission.submitted_by = auth.uid()
      and submission.review_status = 'draft_private'
  )
);

drop policy if exists "scorecard_extracted_holes_delete_own_draft_or_admin" on public.scorecard_extracted_holes;
create policy "scorecard_extracted_holes_delete_own_draft_or_admin"
on public.scorecard_extracted_holes
for delete
using (
  public.is_admin()
  or exists (
    select 1
    from public.scorecard_submissions submission
    where submission.id = scorecard_extracted_holes.submission_id
      and submission.submitted_by = auth.uid()
      and submission.review_status = 'draft_private'
  )
);

drop policy if exists "scorecard_versions_select_published_or_admin" on public.scorecard_versions;
create policy "scorecard_versions_select_published_or_admin"
on public.scorecard_versions
for select
using (
  public.is_admin()
  or status = 'published'
);

drop policy if exists "scorecard_versions_insert_admin" on public.scorecard_versions;
create policy "scorecard_versions_insert_admin"
on public.scorecard_versions
for insert
with check (public.is_admin());

drop policy if exists "scorecard_versions_update_admin" on public.scorecard_versions;
create policy "scorecard_versions_update_admin"
on public.scorecard_versions
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "scorecard_versions_delete_admin" on public.scorecard_versions;
create policy "scorecard_versions_delete_admin"
on public.scorecard_versions
for delete
using (public.is_admin());
