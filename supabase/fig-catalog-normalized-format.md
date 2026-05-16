# Stablr FIG catalog normalized JSON

## Purpose

This format is the normalized payload for the **Italian FIG catalog**.

It is separate from the curated Stablr playable catalog:
- `fig_*` tables store the official FIG source base
- `clubs`, `course_routes`, `route_combinations` remain the Stablr playable layer

Pipeline:

1. FIG scraper
2. raw FIG JSON
3. normalized FIG catalog JSON (this document)
4. Supabase seed into `fig_*`
5. Stablr match / enrichment

This catalog is used for:
- club search suggestions
- club-name validation
- route / par / tee / CR / Slope enrichment

It is **not** the final source for:
- Stroke Index of complex combinations
- official scorecard SI
- curated combination logic

Those remain part of the Stablr layer.

---

## Root shape

```json
{
  "schema_version": "1.0",
  "import_batch": {},
  "clubs": []
}
```

---

## Import batch

```json
{
  "source_system": "fig",
  "source_url": "https://www.federgolf.it/attivita-agonistica/servizi-online/tabella-slope-course-rating/",
  "source_version": "2026-05-16",
  "scraped_at": "2026-05-16T08:30:00Z",
  "notes": "Full FIG slope / course rating extract",
  "raw_payload": {}
}
```

Maps to:
- `fig_import_batches`

---

## Club

```json
{
  "source_external_id": "fig-club-parco-de-medici",
  "name": "PARCO DE' MEDICI",
  "name_normalized": "parco de medici",
  "city": "Roma",
  "region": "Lazio",
  "country": "Italia",
  "is_active": true,
  "source_payload": {},
  "playable_courses": []
}
```

Maps to:
- `fig_clubs`

Notes:
- `source_external_id` must be stable inside the importer
- if FIG does not provide a real id, the importer can derive one deterministically

---

## Playable course

Each item represents one official row from the FIG table.

```json
{
  "source_external_id": "fig-course-parco-medici-championship-bianco-blu",
  "name": "Championship Bianco/Blu",
  "name_normalized": "championship bianco blu",
  "holes_count": 18,
  "total_par": 72,
  "course_type": "combination_18",
  "route_family": "official",
  "display_order": 1,
  "course_composition": {
    "kind": "combination",
    "base_routes": ["Bianco", "Blu"],
    "front_route_name": "Bianco",
    "back_route_name": "Blu"
  },
  "is_active": true,
  "source_payload": {},
  "tees": []
}
```

Maps to:
- `fig_playable_courses`

### `course_type`

Allowed values:
- `single_9`
- `single_18`
- `repeat_9`
- `combination_18`
- `other_18`

### `route_family`

Allowed values:
- `base`
- `official`
- `optional`

Recommended interpretation:
- `base`: plain route like `9 Buche Blu`
- `official`: named official course like `Championship Bianco/Blu`
- `optional`: secondary 18-hole option like `Blu x2` or `Est (Rosso x2)`

### `course_composition`

Free but normalized JSON to help matching and later Stablr enrichment.

Examples:

Repeat 9:

```json
{
  "kind": "repeat",
  "base_routes": ["Blu"],
  "repeat_count": 2
}
```

Combination 18:

```json
{
  "kind": "combination",
  "base_routes": ["Bianco", "Blu"],
  "front_route_name": "Bianco",
  "back_route_name": "Blu"
}
```

Single route:

```json
{
  "kind": "single",
  "base_routes": ["Blu"]
}
```

---

## Tee

```json
{
  "source_external_id": "fig-tee-parco-medici-championship-bianco-blu-giallo-men",
  "tee_name": "Giallo",
  "tee_color": "yellow",
  "gender": "men",
  "course_rating": 71.1,
  "slope_rating": 136,
  "par_total": 72,
  "tee_order": 3,
  "is_active": true,
  "source_payload": {}
}
```

Maps to:
- `fig_course_tees`

Notes:
- one row per tee / gender / playable course
- if FIG does not explicitly expose `tee_color`, the importer can derive it from `tee_name`

---

## Why this catalog is separate from Stablr

The FIG catalog gives us:
- official club names
- official playable course names
- par totals
- tee list
- CR / Slope

It does **not** fully solve:
- Stroke Index of complex combinations
- club-specific scorecard rules
- official odd/even SI logic

So the product flow becomes:

1. FIG gives the official Italian base
2. Stablr matches and enriches
3. Stablr curates complex scorecard logic where needed

---

## Matching workflow later

This normalized format is designed so that later we can:

- suggest clubs from `fig_clubs`
- match a community club to a FIG club
- prefill routes and tees from `fig_playable_courses` and `fig_course_tees`
- keep the Stablr curated layer independent
