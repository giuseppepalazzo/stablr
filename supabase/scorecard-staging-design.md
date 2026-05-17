# Stablr scorecard staging/review design

## Goal

Use FIG as the closed official Italian catalog for:
- clubs
- playable courses
- tees
- total par
- Course Rating
- Slope Rating

Keep hole-by-hole data in a separate Stablr/community layer:
- hole list
- par per hole
- Stroke Index

Photo scorecards must never publish directly to live gameplay tables.

---

## Anti-fragmentation rules

### Unit of work

The unit of work is always:

- `fig_club`
- `fig_playable_course`

Not the whole club.

### Rule 1

If a FIG match exists, the user may only work on official FIG playable courses already listed for that club.

So:
- no invented route names
- no extra user-created course variants
- no user-defined tee catalog when FIG exists

### Rule 2

For each `fig_playable_course`, only one active submission can exist at a time.

Active means:
- `draft_private`
- `in_review`

This prevents parallel competing mappings for the same official course.

### Rule 3

For each `fig_playable_course`, only one live published version can exist at a time.

Published means:
- visible to all users
- feeds the playable Stablr layer

### Rule 4

If a submission already exists:
- the uploader may resume it
- another user may not create a second parallel submission
- another user may contribute support photos to the same submission
- that support flow is allowed even if the original submission started as `draft_private`

### Rule 5

If the club does not match FIG:
- the fallback community/manual flow remains available
- this is mainly for foreign clubs or clubs missing from FIG

---

## State model

Internal states are defined per `fig_playable_course`.

### `missing`
- no hole-by-hole data available yet

### `draft_private`
- submission created
- usable only by uploader and admin
- not visible as playable to other users

### `in_review`
- draft submitted to Stablr/admin review
- still not public

### `published`
- reviewed and approved
- playable by all users

### `superseded`
- old published version replaced by a newer one

---

## Private preview vs published live

### Private preview

Created from:
- user mapping
- scorecard photo upload
- extracted staging data

Visible to:
- uploader
- admin

Purpose:
- let the uploader use the course immediately
- avoid publishing unverified data to everyone

### Published live

Created only after:
- review
- correction if needed
- admin approval

Visible to:
- all users

Purpose:
- feed live gameplay tables safely

---

## User-facing state copy

| Internal state | User-facing copy | Who can play it |
|---|---|---|
| `missing` | `Da completare` | nobody |
| `draft_private` | uploader sees `Bozza privata`; others see `In lavorazione` | uploader only |
| `in_review` | `In revisione` | nobody except admin preview |
| `published` | normal playable flow | everyone |
| `superseded` | normally hidden | nobody |

---

## Permission / RLS matrix

This is the target behavior. A concrete first-pass SQL policy file now exists in:

- `supabase/scorecard-staging-rls.sql`

| Table | Authenticated user | Uploader | Other authenticated user | Admin |
|---|---|---|---|---|
| `fig_*` | read | read | read | read/write sync layer |
| `scorecard_submissions` | create only where allowed by UX | read own, update own while `draft_private` | no direct edit | read/update all |
| `scorecard_submission_images` | attach to allowed submission | read own submission images | may add support photo only if UI allows | read/update all |
| `scorecard_extracted_holes` | no direct free edit | update own draft through controlled UI | no edit | read/update all |
| `scorecard_versions` | read published only | read own preview through app logic, not direct table access | read published only | read/create/supersede |
| live gameplay tables (`course_routes`, `route_holes`, `route_combinations`, `route_combination_holes`) | read playable data | read playable data | read playable data | publish/update via controlled admin flow |

### Recommended enforcement principles

- users do not publish directly
- users do not supersede directly
- users do not edit other users' submissions
- admin approval is required before any staging data becomes live
- other users may add support photos to an existing submission, but do not gain edit rights on the draft itself
- once a submission leaves `draft_private`, the uploader no longer edits hole-by-hole data directly

---

## Club taxonomy

Taxonomy should be deduced primarily from FIG, with optional future Stablr override.

### `simple_single`

One base course only.

Typical examples:
- one `18 Buche`
- or one base `9 Buche` plus a generic repeat-to-18 logic

User contribution allowed:
- yes

### `simple_multi`

More than one official FIG playable course, but still structurally manageable without full editorial curation.

Typical examples:
- `Prime Nove`
- `Seconde Nove`
- `18 Buche`
- `2 Volte Prime Nove`
- `2 Volte Seconde Nove`

User contribution allowed:
- yes, but only on official FIG routes

### `complex_official`

Official combinations or routing logic that should stay under Stablr control.

Typical examples:
- named championship combinations
- inverted routing
- combinations whose Stroke Index cannot be safely inferred from FIG alone

User contribution allowed:
- no free publish
- upload scorecard or request workflow only

---

## UX flow by taxonomy

### 1. `simple_single`

If FIG match exists:
- show the official club
- show only official FIG playable course(s)
- if hole-by-hole data is missing:
  - `Compila`
  - `Carica scorecard`

If a draft exists:
- uploader sees `Continua bozza`
- others see `In lavorazione`

If published:
- normal `Imposta giro`

### 2. `simple_multi`

If FIG match exists:
- show only official FIG courses for that club
- user chooses which official course to complete
- no free route naming

Each official FIG course has its own state:
- `Da completare`
- `In lavorazione`
- `In revisione`
- playable if `published`

### 3. `complex_official`

If FIG match exists:
- show only official FIG courses
- no free user route creation
- user may:
  - `Richiedi questo club`
  - `Carica scorecard`

If scorecard is uploaded:
- create private preview for uploader
- route remains non-public until approved by Stablr
- for all other users, the club stays requested / non playable with the existing badge logic

---

## Impact on `Aggiungi club`

### If FIG match exists

- show only official FIG club
- show only official FIG courses
- remove ability to invent course names
- route creation becomes completion of FIG courses, not free creation

### If FIG match does not exist

- explain that the club is not in the official FIG catalog
- ask whether it is foreign or missing from FIG
- allow fallback manual/community flow

---

## Impact on `Imposta giro`

### If FIG match exists and published live data exists

- normal flow
- routes, tees, CR and Slope come from official catalog / published live layer

### If FIG match exists but hole-by-hole is still missing

- user sees official routes and tees
- user can complete only if club taxonomy allows it
- otherwise user can upload scorecard or request Stablr

### If only private draft exists

- uploader may use the private preview
- other users must not see it as publicly playable
- on complex clubs, other users should still see the club as requested / not playable

---

## Why this architecture matters

This prevents:
- invented course names
- parallel competing mappings
- direct publication from OCR/photo uploads
- accidental overwrite of curated Stablr clubs

And it enables:
- FIG as the only official Italian catalog
- Stablr as the editorial/playable layer
- community help where safe
- admin control where needed
