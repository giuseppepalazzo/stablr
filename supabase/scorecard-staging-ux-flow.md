# Stablr scorecard staging UX flow

This document translates the staging/review architecture into product flows.

It covers:
- `simple_single`
- `simple_multi`
- `complex_official`

and the user-facing states:
- `missing`
- `draft_private`
- `in_review`
- `published`

---

## Shared principles

### 1. FIG is the closed official catalog

If a club matches FIG:
- the user never invents course names
- the user never invents tee catalog entries
- Stablr shows only official FIG playable courses

### 2. Unit of work

Every action works on exactly one:
- `fig_club`
- `fig_playable_course`

### 3. One active submission

If a playable course already has an active submission:
- uploader resumes it
- another user does not create a second full draft
- another user may only add support photos

### 4. Two visibility levels

- `private preview`: uploader + admin only
- `published live`: everyone

---

## Entry points

There are two main entry points:

### A. `Cerca un club`
- user searches
- if local club exists and is playable, open it
- if FIG suggestion exists, user can pick it
- if FIG club is matched but incomplete, route to the correct completion flow

### B. `+ Aggiungi club`
- user types club name
- system searches:
  - Stablr clubs
  - FIG catalog
- if FIG match exists:
  - use official FIG club
- if FIG match does not exist:
  - fallback manual/foreign flow

---

## Flow: `simple_single`

Examples:
- single 18-hole course
- single 9-hole base course with repeat-to-18 logic

### Step 1
User selects the FIG club.

### Step 2
Stablr shows:
- official club name
- official FIG playable course(s)

For true `simple_single`, UI should feel like one main playable route.

### Step 3
State decision for that FIG course

#### If `published`
- normal `Imposta giro`
- official tees, CR and Slope already available
- hole-by-hole is already live

#### If `missing`
Show:
- `Da completare`
- CTA `Compila il percorso`
- CTA `Carica scorecard`

Meaning:
- user may either manually map hole-by-hole
- or upload the physical scorecard

#### If `draft_private`

If uploader:
- show `Bozza privata`
- CTA `Continua bozza`
- CTA `Carica altre foto`
- CTA `Elimina bozza`

If another user:
- show `In lavorazione`
- CTA `Aggiungi foto di supporto`
- no direct play

#### If `in_review`
- show `In revisione`
- CTA `Aggiungi foto di supporto`
- no direct play for general users

### Step 4
If uploader completes mapping or uploads scorecard:
- create/update submission
- create private preview

### Step 5
Uploader can play immediately from the private preview.

### Step 6
After admin review and publish:
- the route becomes publicly playable for everyone

---

## Flow: `simple_multi`

Examples:
- multiple official FIG courses without complex editorial routing
- `Prime Nove`
- `Seconde Nove`
- `18 Buche`
- repeat variants

### Step 1
User selects the FIG club.

### Step 2
Stablr shows the official FIG playable course list as cards.

Each card has:
- course name
- total par
- state badge/copy

Examples:
- `Da completare`
- `In lavorazione`
- `In revisione`
- normal playable if published

### Step 3
User chooses one official FIG course.

Important:
- they do not create a new route name
- they complete only the selected official route

### Step 4
State behavior per course card

#### If `published`
- `Imposta giro` normal flow for that course

#### If `missing`
- CTA `Compila`
- CTA `Carica scorecard`

#### If `draft_private`

If uploader:
- `Bozza privata`
- CTA `Continua bozza`

If other user:
- `In lavorazione`
- CTA `Aggiungi foto di supporto`

#### If `in_review`
- `In revisione`
- CTA `Aggiungi foto di supporto`

### Step 5
Private preview is only for uploader, course by course.

This means:
- one FIG course can be published
- another still missing
- another in review

That is expected and should be visible.

---

## Flow: `complex_official`

Examples:
- named official combinations
- inverted routing
- championship routing
- combinations whose Stroke Index needs Stablr curation

### Step 1
User selects the FIG club.

### Step 2
Stablr shows only official FIG courses / combinations.

No free creation is allowed.

### Step 3
Default message:
- `Questo club è in configurazione da parte di Stablr`

Default CTA:
- `Richiedi questo club`

Secondary CTA:
- `Carica scorecard`

### Step 4
If user uploads scorecard:
- create submission for the selected FIG playable course
- generate staging extraction / private preview

### Step 5
Private preview behavior

If uploader:
- may use the provisional route privately
- sees `Bozza privata` or `In revisione`

If other user:
- sees the club as requested / not playable
- can add support photos
- cannot play the provisional route

### Step 6
After Stablr review:
- route becomes `published`
- then available to everyone

---

## Fallback flow: no FIG match

If no FIG match exists:
- explain the club is not in the official FIG catalog
- ask whether:
  - it is a foreign club
  - or an Italian club missing from FIG

Then:
- fallback manual/community flow
- scorecard upload still available

Important:
- this is the only place where freer route creation can still exist

---

## User-facing copy suggestions

### Missing
- `Da completare`
- `Completa il percorso`

### Draft private
- `Bozza privata`
- `Puoi continuare da dove avevi lasciato`

### In progress for others
- `In lavorazione`
- `Un altro utente sta completando questo percorso`

### In review
- `In revisione`
- `Stablr sta verificando i dati del percorso`

### Complex requested
- `Club in configurazione`
- `Questo percorso richiede una verifica Stablr prima di essere disponibile a tutti`

---

## `Imposta giro` behavior summary

### If course is published
- standard playable flow

### If course is private draft and user is uploader
- show provisional playable flow
- clearly mark as private/provisional

### If course is not published and user is not uploader
- do not expose playable setup
- show status + CTA consistent with state

---

## Admin review handoff

This UX implies a future admin surface with:
- list of submissions by status
- per-FIG-course review queue
- support photos attached to the same submission
- preview of extracted holes
- publish action

The public product should not need to know admin implementation details,
but this flow is designed so admin tooling can plug in cleanly later.
