# Stablr FIG matching design

## Goal

Link the curated/playable Stablr catalog to the imported FIG catalog without:
- overwriting verified Stablr clubs
- breaking current gameplay logic
- forcing hard matches when data is ambiguous

The FIG catalog is the official Italian reference base.
The Stablr catalog remains the playable product layer.

---

## Principle

FIG answers:
- what the official club is called
- what playable courses FIG publishes
- tee list
- Course Rating
- Slope Rating
- par total

Stablr answers:
- whether the club is playable in product
- complex official combination naming used in app
- Stroke Index for complex combinations
- curated scorecard logic

So:
- FIG is the source catalog
- Stablr is the curated playable layer

---

## Matching scope

We match at two levels:

1. club level
- `clubs` ↔ `fig_clubs`

2. route / playable course level
- `course_routes` and `route_combinations`
- ↔ `fig_playable_courses`

The first implementation should start with **club-level matching only**.

---

## Schema proposal

### Add to `clubs`

```sql
fig_club_id uuid references public.fig_clubs(id) on delete set null
fig_match_status text not null default 'unmatched'
  check (fig_match_status in ('unmatched', 'matched', 'needs_review', 'rejected'))
fig_match_confidence numeric
fig_match_notes text
fig_matched_at timestamptz
```

Meaning:
- `fig_club_id`: linked official FIG club
- `fig_match_status`:
  - `unmatched`
  - `matched`
  - `needs_review`
  - `rejected`
- `fig_match_confidence`: optional score like `0.98`
- `fig_match_notes`: admin notes or auto-match explanation
- `fig_matched_at`: audit trail

### Optional future table

Do **not** build this in the first step unless needed:

```sql
club_fig_course_matches
```

Would map:
- a Stablr `course_route` or `route_combination`
- to a FIG `fig_playable_course`

For now, club-level matching is enough.

---

## Matching rules

### Strong match

A club can be auto-matched when:
- `clubs.name_normalized = fig_clubs.name_normalized`

Optional boosters:
- same `city`
- same `country`

Action:
- set `fig_club_id`
- `fig_match_status = 'matched'`
- store confidence like `1.0`

### Review match

A club should go to review when:
- normalized names are very similar
- but not safely exact
- or exact name exists more than once in different cities

Action:
- do not auto-link
- `fig_match_status = 'needs_review'`

### No match

If no convincing club exists in FIG:
- keep `fig_club_id = null`
- `fig_match_status = 'unmatched'`

---

## Clubs that must never be overwritten automatically

These rules are important:

1. verified Stablr clubs stay authoritative
2. matching may enrich them, but never rewrite playable data silently
3. complex curated clubs like `Parco De' Medici` remain controlled by Stablr

So the first matching phase only links records.
It does **not** rewrite:
- `course_routes`
- `route_holes`
- `route_combinations`
- `route_combination_holes`

---

## Product use after match

Once `clubs.fig_club_id` exists:

### Search
- official FIG name can reinforce the search result
- can reduce duplicate user-created clubs

### Add club flow
- after user enters club name, we can check if a FIG club exists
- if yes:
  - suggest the official club
  - later preload route/tee options

### Community clubs
- if a community club matches FIG strongly
  - we can later propose FIG tee / CR / Slope enrichment

### Complex clubs
- match only gives official reference base
- SI and scorecard logic still remain curated by Stablr

---

## Suggested implementation order

### Phase 1
- add club-level FIG match fields
- build a simple matching script:
  - exact normalized-name match
  - optional city check
- do not change frontend yet

### Phase 2
- add admin visibility:
  - matched
  - unmatched
  - needs review

### Phase 3
- use match result in add-club / search UX

### Phase 4
- optionally build playable-course-level matching

---

## Safe first version

The safest first version is:

1. import FIG catalog
2. add `fig_club_id` + match metadata to `clubs`
3. write a script that only links strong matches
4. leave everything else untouched

This gives us value immediately without risking curated data.
