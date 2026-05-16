alter table public.clubs
  add column if not exists fig_club_id uuid references public.fig_clubs(id) on delete set null;

alter table public.clubs
  add column if not exists fig_match_status text not null default 'unmatched'
    check (fig_match_status in ('unmatched', 'matched', 'needs_review', 'rejected'));

alter table public.clubs
  add column if not exists fig_match_confidence numeric;

alter table public.clubs
  add column if not exists fig_match_notes text;

alter table public.clubs
  add column if not exists fig_matched_at timestamptz;

create index if not exists clubs_fig_club_id_idx on public.clubs(fig_club_id);
create index if not exists clubs_fig_match_status_idx on public.clubs(fig_match_status);
