# Final catalog batch - 2026-09-21

## Scope

Targeted continuation after the 181--200 batch. The repository and the remote database were treated as the source of truth: the existing 200 clubs were not reseeded, and the protected manual clubs `Mare di Roma` and `Parco De' Medici` were not touched.

The FIG catalog contains 220 identities, but the difference from the live count is not a direct one-record-per-row backlog: Appiano/Carezza are split from one FIG container, Mirasole is already represented inside Rovedine, and two clubs are protected manual records. This batch therefore imports only identities for which the playable layer is deterministic under Governance Framework v3.

## Imported clubs

| Club | Final status | Published routes | Decision |
| --- | --- | ---: | --- |
| Padova | orange / `needs_review` | 6 | FIG and GesGolf 2025 agree on the three 9-hole loops and all three 18-hole combinations. Official pages confirm the loops and distances but do not publish hole-by-hole HCP/SI. |
| Montecchia Golf | orange / `needs_review` | 7 | Main Bianco/Rosso/Verde routes agree between FIG and GesGolf; the official course book confirms three Par-36 loops. Albarella, Galzignano and technical VO23 variants are excluded. Official HCP/SI evidence is incomplete. |
| Pustertal | green / `verified` | 2 | The current official scorecard publishes complete Par/HCP, distances, CR and Slope for Par 66 and matches the FIG 2021 routes. Legacy Par-68 routes are excluded. |
| St. Vigil Seis | green / `verified` | 3 | All 18 official hole cards were inspected. Their complete Par/HCP matrix matches FIG totals: 18 holes Par 69, first nine Par 35, second nine Par 34. |
| Tarvisio | green / `verified` | 1 | The current official scorecard publishes the complete Par-70/HCP matrix and matches the FIG 18-hole route. FIG 9-hole routes are excluded because the current club routing uses a different lower/upper composition. |
| Sestrieres | green / `verified` | 2 | The official Vialattea course page publishes complete Par/HCP for all 18 holes. The Par-65 matrix and its first-nine Par-31 segment match the two FIG routes. |
| Valdichiana | green / `verified` | 2 | The official course page publishes Par and paired HCP values for each of the nine physical holes. First-pass and second-pass values deterministically produce the FIG 9-hole Par-34 and 18-hole Par-68 routes. |

## Excluded from this seed

- `Musella`: GesGolf/FIG expose historical 9/18 route families, while the current official site describes a 12-hole homologated facility. The current playable routing is not deterministic.
- `Pavoniere`: multiple duplicate and short-course variants create an unresolved route/version mapping; no sufficiently strong current official scorecard was found in this audit.
- `St. Vigil Seis` and `Tarvisio` GesGolf scraping failed because the current GesGolf form did not return the expected `__EVENTVALIDATION`; strong official evidence plus FIG was used only for the explicitly published routes.
- The 15 remaining unrepresented FIG identities were not converted into playable records without reliable current hole-by-hole data: `Musella`, `Pavoniere`, `Punta Ala`, `Roncegno`, `Salerno`, `San Donato`, `San Michele`, `Sappada`, `Sicilia'S Picciolo`, `Stupinigi`, `Tauriana`, `Tirrenia`, `Valpescara`, `Verdura`, `Villa Giusti`.
- In particular, the current official material for Sicilia'S Picciolo is internally inconsistent, Stupinigi lacks a complete HCP matrix and contains conflicting Par information, San Michele exposes incomplete/ambiguous hole data, and San Donato's available brochure is not demonstrably aligned with the current FIG 2026 routes. The other identities still lack a complete authoritative current matrix in the retained audit evidence.

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
  - green / `verified`: 97;
  - orange / `needs_review`: 110.

## Evidence

- Padova: `https://www.golfclubpadova.it/percorso-giallo/`, `percorso-blu/`, `percorso-rosso/`, GesGolf circolo `29`.
- Montecchia: `https://www.golfmontecchia.it/`, official course book PDF, GesGolf circolo `831`.
- Pustertal: `https://www.golfpustertal.com/it/campo-da-golf/scorecard-rating`.
- St. Vigil Seis: `https://www.golfstvigilseis.it/en/golf-courese-prices/golf-course-routing/` and the 18 linked official hole cards.
- Tarvisio: `https://golfsenzaconfini.com/it` and `https://cdn.jessas.org/downloads/Scorecard.pdf`.
- Sestrieres: `https://www.vialattea.it/estate/sport-e-attivita/golf/`.
- Valdichiana: `https://www.golfclubvaldichiana.it/golf-club/il-campo/`.
