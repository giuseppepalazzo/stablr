# Stablr FIG / WHS normalized JSON

## Purpose

This format is the **only** payload that can be seeded into Supabase for curated FIG / WHS data.

Pipeline:

1. FIG scraper
2. raw JSON
3. normalized JSON (this document)
4. Supabase seed

The goal is to keep:
- raw extraction separate from business decisions
- curated club combinations explicit
- optional WHS fields additive and non-breaking

---

## Root shape

```json
{
  "schema_version": "1.0",
  "source": {
    "system": "fig",
    "scraped_at": "2026-04-29T10:30:00Z",
    "club_external_id": "fig-club-123",
    "notes": "Optional import notes"
  },
  "club": {},
  "routes": [],
  "route_combinations": []
}
```

---

## Club

```json
{
  "name": "Parco De' Medici",
  "name_normalized": "parco de medici",
  "city": "Roma",
  "country": "Italia",
  "source_system": "fig",
  "source_external_id": "fig-club-123",
  "source_payload": {}
}
```

Maps to:
- `clubs`

Notes:
- `created_by` is **not** part of normalized JSON
- `created_by` is assigned by the seed/import process

---

## Route

One route represents an official playable route as described by Stablr at route level.

```json
{
  "external_key": "bianco-9",
  "name": "Bianco",
  "holes_count": 9,
  "total_par": 36,
  "display_order": 1,
  "is_active": true,
  "source_system": "fig",
  "source_external_id": "fig-route-bianco",
  "source_payload": {},
  "holes": [],
  "tees": []
}
```

Maps to:
- `course_routes`

`external_key` is required in normalized JSON to reference this route from combinations before the DB ids exist.

---

## Route holes

```json
{
  "physical_hole_number": 1,
  "par": 4,
  "stroke_index": 3,
  "display_label": "1"
}
```

Maps to:
- `route_holes`

Notes:
- `stroke_index` here is the **base route value**
- for complex clubs, official combination SI can differ later

---

## Route tees

```json
{
  "tee_name": "Giallo",
  "tee_color": "yellow",
  "gender": "mixed",
  "course_rating": 35.6,
  "slope_rating": 126,
  "par_total": 36,
  "is_active": true,
  "source_system": "fig",
  "source_external_id": "fig-tee-bianco-giallo",
  "source_payload": {}
}
```

Maps to:
- `route_tees`

Notes:
- all fields remain optional except `tee_name`
- if CR / Slope are missing, Stablr can fall back to current handicap flow

---

## Route combination

One route combination is a named official playable 18-hole layout.

```json
{
  "external_key": "championship-bianco-blu",
  "name": "Championship Bianco/Blu",
  "front_route_external_key": "bianco-9",
  "back_route_external_key": "blu-9",
  "holes_count": 18,
  "total_par": 71,
  "is_active": true,
  "source_system": "fig",
  "source_external_id": "fig-combination-championship-bianco-blu",
  "source_payload": {},
  "holes": [],
  "tees": []
}
```

Maps to:
- `route_combinations`

Notes:
- `front_route_external_key` and `back_route_external_key` must match route `external_key`
- combinations are directional:
  - `Bianco/Blu` is different from `Blu/Bianco`

---

## Combination holes

```json
{
  "round_hole_number": 1,
  "route_external_key": "bianco-9",
  "route_position": 1,
  "physical_hole_number": 1,
  "par": 4,
  "stroke_index": 1,
  "source_stroke_index": 3,
  "display_label": "Bianco 1"
}
```

Maps to:
- `route_combination_holes`

Meaning:
- `round_hole_number` = logical scorecard hole 1–18
- `physical_hole_number` = real physical hole inside the source route
- `stroke_index` = official SI of the combination scorecard
- `source_stroke_index` = SI on the original route

This is the preferred source when:
- the official scorecard exists
- the route-level SI differs from the official 18-hole combination

---

## Combination tees

```json
{
  "tee_name": "Giallo",
  "tee_color": "yellow",
  "gender": "mixed",
  "course_rating": 71.1,
  "slope_rating": 136,
  "par_total": 71,
  "is_active": true,
  "source_system": "fig",
  "source_external_id": "fig-combination-tee-championship-bianco-blu-giallo",
  "source_payload": {}
}
```

Maps to:
- `combination_tees`

Use this when FIG / WHS publishes CR / Slope for the official 18-hole combination.

---

## Mapping rules

### Simple club

If a club has:
- one route only

Then normalized JSON may contain:
- `club`
- one item in `routes`
- optional `route_tees`
- no `route_combinations`

### Complex club

If a club has:
- more than one route
- official 18-hole combinations

Then normalized JSON should contain:
- base routes
- optional route tees
- official route combinations
- optional combination tees
- official combination hole-by-hole SI when available

---

## Product rules captured by this format

- route-level SI is the base mapping
- official scorecard SI of a combination overrides route-level SI for that combination
- official combination names are first-class product data
- tee data is optional and additive
- WHS fields must never break fallback flow

---

## Seeding rules

The future seed process should:

1. upsert club by `(source_system, source_external_id)` when available, else by `name_normalized`
2. create or update routes by `external_key`
3. create route holes
4. create route tees
5. create route combinations by `external_key`
6. create combination holes
7. create combination tees

The seed must resolve:
- `front_route_external_key`
- `back_route_external_key`
- `route_external_key`

into the real UUIDs created in Supabase.

---

## Validation hints

Before seeding, validate:

- `club.name_normalized` exists
- each route has unique `external_key`
- route holes are consecutive and unique inside the route
- each combination has unique `external_key`
- each combination has 18 distinct `round_hole_number`
- each combination hole references an existing route `external_key`
- tee names are unique within their route or combination
