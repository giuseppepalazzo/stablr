# FIG / WHS local pipeline

## Goal

Keep curated FIG / WHS imports safe and repeatable.

Pipeline:

1. scraper FIG
2. raw JSON
3. normalized JSON Stablr
4. Supabase seed

## Files

- `scripts/fig/validate-normalized.mjs`
  - validates a normalized Stablr JSON file
- `scripts/fig/seed-normalized.mjs`
  - seeds one normalized Stablr JSON file into Supabase
- `supabase/fig-whs-normalized-format.md`
  - canonical data contract
- `supabase/fig-whs-normalized-example.json`
  - concrete example

## Data folders

Suggested local folders:

- `data/fig/raw/`
- `data/fig/normalized/`

You can create them if needed with:

```bash
mkdir -p data/fig/raw data/fig/normalized
```

## Validate normalized JSON

```bash
node scripts/fig/validate-normalized.mjs supabase/fig-whs-normalized-example.json
```

## Seed normalized JSON into Supabase

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STABLR_CREATED_BY_USER_ID`

Example:

```bash
SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
STABLR_CREATED_BY_USER_ID="YOUR_ADMIN_USER_ID" \
node scripts/fig/seed-normalized.mjs supabase/fig-whs-normalized-example.json
```

## Important notes

- The seed is designed for **curated** imports, not raw scraper payloads.
- Route combinations are directional:
  - `Bianco/Blu` is different from `Blu/Bianco`
- Official scorecard SI of a combination overrides the route-level SI.
- Tee data is optional and additive.
