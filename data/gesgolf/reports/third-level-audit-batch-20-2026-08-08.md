# Third-level website evidence audit — batch quota 100

Generated: 2026-08-08

Scope: the 20 clubs imported in the batch that brought the playable catalog to 100 clubs.

This audit is intentionally stricter than the import step. FIG and GesGolf are the structured Sources. The official club website, official downloadable files, official course pages, hole-by-hole pages, maps, and scorecards are treated as third-level Evidence.

Initial audit note: no certification or badge update was applied during the first pass. Follow-up editorial action on 2026-08-08 promoted only Garlenda, because it is the only club in this batch with complete official website Par/HCP Evidence matching the imported GesGolf sequence.

## Method used for this audit

For every club I checked:

1. official club website or strongest official site candidate;
2. course page, route page, hole-by-hole page, scorecard area, downloadable maps/PDFs;
3. whether the official site confirms only structure or also Par/HCP hole-by-hole;
4. whether third-level Evidence matches the GesGolf import now in Stablr;
5. whether the current Stablr playable model appears safe, needs manual review, or may need a data correction.

Important correction to the previous method:

- A page that only says "18 buche Par 72" is structure Evidence, not certification Evidence.
- A page exposing each hole with Par and HCP/SI is strong Evidence.
- A PDF/link named scorecard, WHS, EGA, course map, or birdie book must be inspected as Evidence, not ignored.
- Physical 9-hole courses with double starts must be reviewed as a distinct pattern; they are not automatically equivalent to simple physical 18-hole courses.
- Third-party scorecard sites can help locate mismatches but do not certify a course.

## Executive summary

The 20-club import remains usable as an orange playable batch, but the third-level audit does **not** support promoting the whole batch to green.

Certified by Stablr after this audit:

- Garlenda: official site exposes full Par/HCP hole-by-hole and matches the import. Promoted to `verified` / green in the normalized import and Supabase.

Strong orange / near-green candidates after website Evidence:

- Riva Toscana: official site exposes full Par hole-by-hole and confirms HCP 1 on hole 4, matching the imported structure; HCP table still needs a stronger official scorecard/PDF before green.

Potential data/model corrections before any certification:

- Tesino: official site confirms a 9-hole physical course with double starts and Par/HCP pairs; imported model currently exposes only 18 holes and the HCP sequence does not match the official page.
- Courmayeur: official site confirms 9 physical holes with double starts and Par 70; imported model currently exposes only 18 holes.
- Bellosguardo: official site describes 9 holes with double tees, Par 71; imported model currently exposes only 18 holes.
- Colombera ASD: official site presents a more complex 9/12/18 structure than a simple 9+18 model; keep orange and manual-review.
- Bologna: official site exposes full Par/HCP hole-by-hole, but the HCP sequence does not match the GesGolf import.

## Detailed findings

| Club | Imported model | Third-level Evidence found | Website match | Recommendation |
|---|---|---|---|---|
| Acaya | 18 + Prime Nove + Seconde Nove, Par 71 | Official Acaya course page confirms 18 holes, Par 71, 6,192m and has hole descriptions. It exposes partial hole Par descriptions but not a full HCP/SI table. Source: https://www.acayagolfresort.com/percorso-golf | Structure match. Par total matches. Hole-by-hole HCP not confirmed. | Keep orange. Candidate for green only after official scorecard/HCP table or club confirmation. |
| Panorama Golf | Physical 9 modeled as 9 + official 18, Par 33/66 | Official page candidate confirms a 9-hole course at Panorama Golf and hole section exists. The page was protected by anti-bot verification during direct open; search cache confirms structure but not full HCP. Source: https://www.panoramagolf.it/index.php/il-campo/percorso-panorama | Structure likely matches. HCP not confirmed by accessible official Evidence. | Keep orange. Manual check should inspect the hole cards/images directly on the site. |
| Piandisole 2025 | 18 + Prime Nove + Seconde Nove, Par 68 | Official site says the current structure is a 9-hole course with double starts; history page says current route is Par 68 with double starts. FIG public Slope/Course Rating page lists Piandisole 2025 as 18 Buche, Prime Nove, Seconde Nove, all Par 68/34/34. Sources: https://www.piandisolegolf.it/ and https://www.piandisolegolf.it/storia/ | Structure matches FIG/GesGolf enough for orange. No official hole-by-hole HCP found. | Keep orange. Not green without official hole-by-hole Par/HCP. |
| Riva Toscana | 18 + Prime Nove + Seconde Nove, Par 72 | Official course page exposes 18 holes and full Par sequence in the hole descriptions. Imported Par sequence matches: 4,3,4,5,4,3,4,4,5,4,4,5,3,4,5,4,4,3. Page also explicitly identifies hole 4 as course HCP 1. Source: https://www.rivatoscana.it/golf-resort-toscana/percorso-golf | Strong Par match. HCP only partially confirmed. | Strong orange / near-green. Before green, find official scorecard or HCP table behind the "Score card / HCP Course Rating" area. |
| Tesino | 18 only, Par 70 | Official page confirms a 9-hole physical course with double starts, Par 70. It exposes hole-by-hole Par/HCP pairs: e.g. 1/10 HCP 1/2, 2/11 HCP 11/12, 3/12 HCP 9/10. Source: https://www.tesinogolf.it/campo | Par structure matches double-start 18, but the imported HCP sequence does not match the official page. Current model also lacks the 9-hole playable option. | Do not promote. Data/model correction candidate: expose physical 9 + official 18, then align HCP from official/GesGolf after review. |
| Bellosguardo | 18 only, Par 71 | Official site says Bellosguardo is a 9-hole course with double tee starts, Par 71. The course page shows holes 1-10, 2-11, etc., but no visible Par/HCP table in search/open text. Source: https://www.golfbellosguardovinci.it/en/il-campo-golf-bellosguardo/ | Structure suggests physical 9 + official 18, not a simple physical 18. HCP not confirmed. | Keep orange. Data/model review: likely add 9-hole playable route or classify as physical 9 with official 18. |
| Bologna | 18 + Prime Nove + Seconde Nove, Par 72 | Official page exposes hole-by-hole Par/HCP. Example official sequence begins: 1 Par4 HCP10, 2 Par3 HCP14, 3 Par5 HCP12, 4 Par3 HCP8, 5 Par4 HCP2. Source: https://www.golfclubbologna.it/percorso/ | Par matches. HCP does not match the imported GesGolf sequence, which begins 10,16,14,6,2. | Keep orange. Do not promote until HCP mismatch is resolved. |
| Ca' Amata | 18 + Prime Nove + Seconde Nove, Par 71 | Official site confirms 18-hole course and an executive 9-hole practice/secondary course, but I did not find official hole-by-hole Par/HCP on the club site. Source: https://www.golfcaamata.it/il-golf-club/ | Structure matches main 18. HCP only from GesGolf Source, not third-level Evidence. | Keep orange. Manual check should look for hidden scorecard/PDF or ask club. |
| Castello Spessa | 18 + Prime Nove + Seconde Nove, Par 71 | Official page confirms 18 holes, Par 71, length, CR/SR, and links official WHS/EGA document. The downloaded WHS PDF confirms route identity and rating but does not provide hole-by-hole Par/HCP. Source: https://castellodispessa.it/golf/percorso/ | Structure match. No hole-by-hole HCP confirmation from third level. | Keep orange. Green only if scorecard/brochure with hole-by-hole Par/HCP is found or club confirms. |
| Cerreto Miglianico | 18 + Prime Nove + Seconde Nove, Par 72 | Official site confirms Miglianico as an 18-hole Par 72 course, length 5,875m. No official hole-by-hole Par/HCP found. Source: https://www.miglianicogolf.it/ | Structure match. HCP not third-level confirmed. | Keep orange. |
| Courmayeur | 18 only, Par 70 | Official page says the field has 9 holes with double starts, Par 70, and lists holes 1-9 with Par/length. Source: https://www.golfcourmayeur.it/hole/ | Structure suggests physical 9 + official 18, not simple 18 only. HCP not confirmed. | Keep orange. Data/model correction candidate: add 9-hole playable route if consistent with FIG/GesGolf. |
| Croara SSD | 18 + Prime Nove + Seconde Nove, Par 72 | Official page confirms 18 holes, Par 72 and provides detailed hole descriptions. It does not expose full HCP/SI values in the captured text. Source: https://www.golfcroara.it/percorso/ | Structure and Par total match. HCP not confirmed. | Keep orange. |
| Dolomiti | 18 + Prime Nove + Seconde Nove, Par 73 | Official club site confirms 18 holes. External tourism page confirms Par 73, but official site did not expose hole-by-hole HCP in the captured pages. Sources: https://www.dolomitigolf.it/ilclub/ and https://www.dolomiti.it/it/golf/dolomiti-golf-club0 | Structure and Par total match. HCP not third-level confirmed. | Keep orange. |
| Faenza Cicogne | Physical 9 modeled as 9 + official 18, Par 35/70 | Official site confirms a 9-hole course, Par 35, homologated FIG. No official hole-by-hole HCP found. Source: https://www.faenzagolf.com/ | 9-hole structure and Par match. HCP not confirmed. | Keep orange. Good playable orange, not green. |
| Garlenda | 18 + Prime Nove + Seconde Nove, Par 72 | Official site exposes every hole with Par and HCP. Sequence matches the import: Par 4/3/5/4/5/4/3/4/4/4/4/4/3/5/3/4/5/4; HCP 14/18/6/2/8/16/12/10/4/17/5/1/13/7/15/3/9/11. Source: https://www.garlendagolf.it/percorso/ | Full Par/HCP match. | Promoted to green / `verified` by Stablr editorial decision on 2026-08-08. |
| Grado | 18 + Prime Nove + Seconde Nove, Par 72 | Official tourism page confirms Golf Club Grado, 18-hole championship course. I did not find official club-site scorecard. Third-party/federation-style golfportal.si exposes a full scorecard, but its sequence does not match the imported GesGolf sequence. Sources: https://grado.it/it/cosa-fare/sport/attivita-sportive-a-grado/il-golf and https://www.golfportal.si/index.php?course_id=113&date=1764543600&route=golfuser%2Fcourse | Structure matches. Full third-level HCP not confirmed; external scorecard conflict exists. | Keep orange. Manual review needed before any green. |
| Santo Stefano Golf | Physical 9 modeled as 9 + official 18, Par 32/64 | Official club site was not found/reached in this audit. Third-party scorecard sites expose sequences that conflict with the current import and with GesGolf variants. GesGolf remains the only strong structured Source found. | No official website Evidence found. | Keep orange. Manual/club confirmation required. |
| Palermo | Physical 9 modeled as 9 + official 18, Par 32/64 | Official page confirms a 9-hole course in Palermo, Par 32, valid for official competitions/HCP management, and links a course map. Source: https://www.golfclubpalermo.com/il-percorso/ | 9-hole structure and Par match. HCP not visible in captured official page. | Keep orange. Good playable orange; green only with map/scorecard HCP or club confirmation. |
| Colombera ASD | Physical 9 modeled as 9 + official 18, Par 33/67 | Official site presents a more complex structure: Rosa 9, Rosa/Azzurro 18, Verde 3, Rosa/Verde 12, and states the field/course is Par 67 over 12 holes/variants. It gives Par descriptions for individual holes but not a clean HCP table. Source: https://colomberagolf.it/le-buche/ | Structure is not a simple 9/18 pattern. Current playable simplification may be usable but should not be certified without review. | Keep orange. Manual review/classification required; possible complex-course exception. |
| Bormio SSD | Physical 9 modeled as 9 + official 18, Par 33/66 | Official site confirms 9- and 18-hole green fees but not hole-by-hole Par/HCP. Regional FIG page confirms 9 holes, Par 33, and 6 Par 4 + 3 Par 3. Sources: https://www.bormiogolf.it/tariffe-e-abbonamenti.html and https://www.federgolflombardia.it/portfolio-item/golf-club-bormio/ | 9-hole structure and Par match. HCP not confirmed by official club page. | Keep orange. |

## Recommended next action

Do not continue importing the next batch until these corrections are decided:

1. Decide whether Tesino, Courmayeur, and Bellosguardo should be corrected immediately as physical 9-hole courses with official 18-hole double-start routes.
2. Keep Colombera ASD out of "simple" certification because the official website describes a richer structure.
3. Garlenda is already green after autonomous third-level certification.
4. Treat Riva Toscana as near-green but still missing a full official HCP table.
5. Keep all other batch clubs orange until a scorecard/PDF/club email/manual admin Evidence closes the HCP gap.

## Manual recheck list — remaining orange clubs from this batch

These 19 clubs remain orange after the autonomous third-level audit:

1. Acaya — structure confirmed; missing full official HCP/SI.
2. Panorama Golf — structure likely confirmed; page protected; inspect hole cards/images manually.
3. Piandisole 2025 — structure confirmed; missing official hole-by-hole HCP/SI.
4. Riva Toscana — Par sequence confirmed; find full official HCP/SI scorecard before green.
5. Tesino — official site indicates physical 9 + double starts; data/model correction needed.
6. Bellosguardo — official site indicates physical 9 + double tees; data/model correction likely needed.
7. Bologna — official HCP exists but conflicts with imported GesGolf sequence.
8. Ca' Amata — structure confirmed; missing official hole-by-hole HCP/SI.
9. Castello Spessa — structure and WHS confirmed; missing official hole-by-hole HCP/SI.
10. Cerreto Miglianico — structure confirmed; missing official hole-by-hole HCP/SI.
11. Courmayeur — official site indicates physical 9 + double starts; data/model correction likely needed.
12. Croara SSD — structure confirmed; missing official hole-by-hole HCP/SI.
13. Dolomiti — structure/par confirmed; missing official hole-by-hole HCP/SI.
14. Faenza Cicogne — physical 9/par confirmed; missing official HCP/SI.
15. Grado — structure confirmed; external full scorecard conflicts with import.
16. Santo Stefano Golf — official site Evidence not found; manual/club confirmation needed.
17. Palermo — physical 9/par confirmed; missing official HCP/SI.
18. Colombera ASD — official site suggests a richer/simple-complex structure; manual classification needed.
19. Bormio SSD — physical 9/par confirmed; missing official HCP/SI.

## Decision marker

SEGNO6 — batch quota 100 imported, third-level audit completed.

SEGNO7 — Garlenda autonomously certified green after FIG + GesGolf + official website Par/HCP match. Remaining 19 clubs stay orange for manual/admin recheck.
