# Final catalog batch - 2026-09-21

## Scope

Targeted continuation after the 181--200 batch. The repository and the remote database were treated as the source of truth: the existing 200 clubs were not reseeded, and the protected manual clubs `Mare di Roma` and `Parco De' Medici` were not touched.

The FIG catalog contains 220 identities, but the difference from the live count is not a direct one-record-per-row backlog: Appiano/Carezza are split from one FIG container, Mirasole is already represented inside Rovedine, and two clubs are protected manual records. This batch therefore imports only identities for which the playable layer is deterministic under Governance Framework v3.

## Imported clubs

| Club | Final status | Published routes | Decision |
| --- | --- | ---: | --- |
| Padova | orange / `needs_review` | 6 | FIG and GesGolf 2025 agree on the three 9-hole loops and all three 18-hole combinations. Official pages confirm the loops and distances but do not publish hole-by-hole HCP/SI. |
| Montecchia Golf | green / `verified` | 7 | Official hole-by-hole cards now confirm complete PAR/HCP/SI for Bianco, Rosso and Verde; all seven FIG routes match GesGolf. FIG remains authoritative for `Verde`, despite the `Percorso Giallo` label present in some official graphics. |
| Pustertal | green / `verified` | 2 | The current official scorecard publishes complete Par/HCP, distances, CR and Slope for Par 66 and matches the FIG 2021 routes. Legacy Par-68 routes are excluded. |
| St. Vigil Seis | green / `verified` | 3 | All 18 official hole cards were inspected. Their complete Par/HCP matrix matches FIG totals: 18 holes Par 69, first nine Par 35, second nine Par 34. |
| Tarvisio | green / `verified` | 1 | The current official scorecard publishes the complete Par-70/HCP matrix and matches the FIG 18-hole route. FIG 9-hole routes are excluded because the current club routing uses a different lower/upper composition. |
| Sestrieres | green / `verified` | 2 | The official Vialattea course page publishes complete Par/HCP for all 18 holes. The Par-65 matrix and its first-nine Par-31 segment match the two FIG routes. |
| Valdichiana | green / `verified` | 2 | The official course page publishes Par and paired HCP values for each of the nine physical holes. First-pass and second-pass values deterministically produce the FIG 9-hole Par-34 and 18-hole Par-68 routes. |

## Recovery batch group 1

- `Musella`: recovered as playable orange with all 7 FIG routes. The official 2025 route scorecards reconcile the 12 physical holes with GesGolf; the repeated 18-hole SI rule remains uncertified.
- `Pavoniere`: recovered as green with all 10 active FIG routes reconciled against the official complete scorecard and GesGolf.
- `Punta Ala`: recovered as playable orange with `18 Buche`, `Prime Nove` and `Seconde Nove`; the official page plus two matching secondary scorecards support the complete matrix without reaching the green threshold.
- `Roncegno`: recovered as playable orange with 9/34 and the FIG-rated 18/68 derived through the established Stablr odd/even repetition rule.
- `Salerno`: recovered as playable orange with the current 9/34 and its deterministic 18/68; FIG variants 9/33 and 18/66 remain catalog identities but are not published.

## Recovery batch group 2

- `San Donato`: playable orange with the supported 2015 family `18/68`, `Prime Nove/35` and `Seconde Nove/33`; the 2024 family and the ambiguous repeated-nine route remain unpublished.
- `San Michele`: playable orange with the complete official `9/35`; `18/70` remains unpublished because the official graphics do not expose the second-lap HCP for physical holes 3 and 9.
- `Sappada`: playable orange with `9/31` from official PAR plus Hole19 SI and deterministic `18/62`.
- `Sicilia'S Picciolo`: green with `18/72`, `Prime Nove/36` and `Seconde Nove/36`; the isolated official hole-2 rendering duplicate is resolved by FIG totals and two concordant complete scorecards.
- `Stupinigi`: playable orange with the FIG/GesGolf family `9/31` and `18/62`; the official page's hole-5 Par conflicts with its own Par-62 heading, so families 30/60 and 32/64 remain unpublished.
- Detailed audit: `data/gesgolf/reports/recovery-batch-group-2-2026-09-22.md`.

## Open evidence notes and remaining unrepresented identities

- `St. Vigil Seis` and `Tarvisio` were imported from FIG plus strong official evidence even though GesGolf scraping failed because the current form did not return the expected `__EVENTVALIDATION`; only the explicitly corroborated routes were published.
- The 5 remaining unrepresented FIG identities are `Tauriana`, `Tirrenia`, `Valpescara`, `Verdura` and `Villa Giusti`, representing 21 active FIG routes to reassess.

## Artifacts

- Builders:
  - `scripts/gesgolf/build-import-batch-final-2026-09-21.mjs`
  - `scripts/gesgolf/build-import-batch-tail-2026-09-21.mjs`
- Imports:
  - `data/gesgolf/imports/padova-normalized.json`
  - `data/gesgolf/imports/montecchia-golf-normalized.json`
  - `data/gesgolf/imports/pustertal-normalized.json`
  - `data/gesgolf/imports/st-vigil-seis-normalized.json`
  - `data/gesgolf/imports/tarvisio-normalized.json`
  - `data/gesgolf/imports/sestrieres-normalized.json`
  - `data/gesgolf/imports/valdichiana-normalized.json`
- Scraper evidence retained for Padova, Pustertal, Musella and Pavoniere under `data/gesgolf/raw/` and `data/gesgolf/normalized/`.

## Validation and remote result

- All seven normalized imports passed `npm run fig:validate`.
- Padova's 6 matrices and Montecchia's 7 matrices were compared programmatically and are identical to the corresponding normalized GesGolf routes.
- Preflight confirmed that none of the seven FIG club IDs existed in remote Supabase.
- Seed completed without errors for all seven clubs.
- Post-seed verification confirmed 23 active routes and a complete stored hole count for every route.
- Remote counts after the seed:
  - clubs: 207;
  - active/playable clubs: 207;
  - green / `verified`: 98;
  - orange / `needs_review`: 109.

## Recovery group 1 remote result

- The five recovery records were seeded after the final catalog batch: Pavoniere is green; Musella, Punta Ala, Roncegno and Salerno are playable orange.
- The final corrective verification for Punta Ala, Roncegno and Salerno found no payload/database differences across 7 routes, 90 hole rows and 34 tees.
- Remote counts after recovery group 1:
  - clubs / active clubs: 212;
  - playable clubs: 212;
  - non-playable clubs: 0;
  - green / `verified`: 99;
  - orange / `needs_review`: 113.

## Recovery group 2 remote result

- Seeded five new FIG-linked playable clubs: Sicilia'S Picciolo is green; San Donato, San Michele, Sappada and Stupinigi are orange.
- Post-seed verification found no payload/database differences across 11 routes, 135 hole rows and 45 tees.
- Remote counts after recovery group 2:
  - clubs / active clubs: 217;
  - playable clubs: 217;
  - non-playable clubs: 0;
  - green / `verified`: 100;
  - orange / `needs_review`: 117.

## Evidence

- Padova: `https://www.golfclubpadova.it/percorso-giallo/`, `percorso-blu/`, `percorso-rosso/`, GesGolf circolo `29`.
- Montecchia: `https://www.golfmontecchia.it/il-percorso-bianco`, `il-percorso-rosso`, `percorso-verde`, official course book PDF, GesGolf circolo `831`; promotion audit: `data/gesgolf/reports/montecchia-golf-promotion-2026-09-21.md`.
- Pustertal: `https://www.golfpustertal.com/it/campo-da-golf/scorecard-rating`.
- St. Vigil Seis: `https://www.golfstvigilseis.it/en/golf-courese-prices/golf-course-routing/` and the 18 linked official hole cards.
- Tarvisio: `https://golfsenzaconfini.com/it` and `https://cdn.jessas.org/downloads/Scorecard.pdf`.
- Sestrieres: `https://www.vialattea.it/estate/sport-e-attivita/golf/`.
- Valdichiana: `https://www.golfclubvaldichiana.it/golf-club/il-campo/`.
