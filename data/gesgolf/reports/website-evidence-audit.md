# GesGolf Imported Clubs — Website Evidence Audit

Generated: 2026-07-08

Purpose: retroactive third-level audit for imported GesGolf clubs. Order: FIG catalog > GesGolf hole-by-hole > official club website/course page.

## Method

For every imported GesGolf club, the audit checked:

1. official club website or strongest official candidate;
2. visible course/page evidence: course structure, number of holes, Par, route description;
3. stronger evidence when available: official scorecard, official HCP table, hole guide, PDF, or hole-by-hole page;
4. fallback note when the official website could not be reached or did not expose enough course data.

Third-party or generic web results can support orientation, but they do not certify a course.

## Status meanings

- `verified`: official website confirms course structure and strong scorecard/course evidence.
- `structure_verified`: official website confirms the course structure clearly, but no full official scorecard/hole-by-hole evidence was captured.
- `partial`: official website or official candidate confirms the presence of golf/course activity, but not enough course structure evidence.
- `pending`: official website evidence not found, unreachable, or insufficient during audit.

## Summary

- `verified` website evidence: Albisola, Ambrosiano, Bagnaia.
- `structure_verified` website evidence: Antognolla, Arenzano Pineta, Bogliaco, Globale Jesolo.
- `partial` website evidence: Bollina, Caorle.
- `pending` website evidence: Aosta Arsanieres, Aosta Brissogne, Barlassina, Citta' D'Asti, Colli Bergamo, Colombaro, Cortina Ssd, Fioranello.

Attention:

- Aosta Arsanieres was downgraded to `data_status: needs_review` after the third-level audit because official website evidence is still pending.
- Bagnaia was promoted to `data_status: verified` by Stablr editorial decision after official website/course-guide evidence.
- Fioranello has user field knowledge confirming it as a physical 18-hole course, but this is manual/admin evidence, not official website evidence yet.

| Club | Data status | Physical | Routes | Website status | Official URL / candidate | Audit result |
|---|---:|---:|---|---|---|---|
| Albisola | verified | 9 | 9 Buche (9) | verified | https://golfclubalbisola.it/ | Official site confirms a 9-hole course, Par 32/33 and double round available. Accepted as green/certified. |
| Ambrosiano | verified | 18 | 18 Buche (18)<br>Prime Nove (9)<br>Seconde Nove (9) | verified | https://golfclubambrosiano.com/percorso/ | Official course page confirms 18 buche PAR 72 and exposes official scorecard/HCP PDF links. Strong green candidate. |
| Antognolla | needs_review | 18 | 18 buche (18)<br>Prime Nove (9)<br>Seconde Nove (9) | structure_verified | https://www.antognolla.com/it/golf | Official page confirms an 18-hole course and length. No official scorecard/hole-by-hole evidence captured. Keep arancio. |
| Aosta Arsanieres | needs_review | 9 | 9 Buche (9) | pending | https://www.golfclubaostaarsanieres.it/ | Official site candidate does not resolve with or without `www`. Deeper search found only weak non-club evidence around Arsanières/Gignod. Downgraded to arancio/review. |
| Aosta Brissogne | needs_review | 9 | 9 Buche (9) | pending | https://www.golfclubaosta.it/ | Official site candidate does not resolve with or without `www`. Needs manual/club confirmation. |
| Arenzano Pineta | needs_review | 9 | 9 Buche (9) | structure_verified | https://www.golfarenzano.it/it/home/ | Official site confirms `9 holes - Par 36` and exposes `Percorso` / `Tabella EGA` navigation. No full scorecard captured. |
| Bagnaia | verified | 18 | 18 Buche (18)<br>Prime Nove (9)<br>Seconde Nove (9) | verified | https://www.royalgolflabagnaia.com/ | Official site confirms an 18-hole course and exposes a Course Guide with holes 1-18. Promoted to green/certified by Stablr editorial decision. |
| Barlassina | needs_review | 18 | Campionato (18)<br>Prime Nove (9)<br>Seconde Nove (9) | pending | https://www.golfclubbarlassina.it/ | Official site candidate does not resolve with or without `www`. Needs manual/club confirmation. |
| Bogliaco | needs_review | 18 | 18 Buche (18)<br>Prime Nove (9)<br>Seconde Nove (9) | structure_verified | https://www.golfbogliaco.com/ | Official site confirms 18 holes, Par 70 and lengths. No full scorecard/hole-by-hole evidence captured. |
| Bollina | needs_review | 9 | 9 Buche (9) | partial | https://labollina.it/ | Official estate site mentions Serravalle Golf Club, but the page does not expose course structure, Par, scorecard or hole-by-hole evidence. |
| Caorle | needs_review | 18 | 18 Buche (18)<br>Prime Nove (9)<br>Seconde Nove (9) | partial | https://www.pradelletorri.it/golf/ | Prior candidate `praiadelleginestre.it` does not resolve. Official Pra' delle Torri page confirms golf activity at Caorle, but no hole count/Par/scorecard captured. |
| Citta' D'Asti | needs_review | 9 | 9 Buche (9) | pending | https://www.golfcittadasti.it/ | Official site candidate does not resolve with or without `www`. Needs manual/club confirmation. |
| Colli Bergamo | needs_review | 9 | 9 Buche (9) | pending | https://www.golfcollibergamo.it/ | Official site candidate does not resolve with or without `www`. Needs manual/club confirmation. |
| Colombaro | needs_review | 9 | 9 Buche (9) | pending | https://www.golfcolombaro.it/ | Official site candidate does not resolve with or without `www`. Needs manual/club confirmation. |
| Cortina Ssd | needs_review | 9 | 9 Buche (9) | pending | https://www.golfcortina.it/ | Site candidate was not usable for text evidence in this audit and did not resolve reliably in browser. Needs manual/club confirmation. |
| Fioranello | needs_review | 18 | 18 Buche (18)<br>Prime Nove (9)<br>Seconde Nove (9) | pending | https://www.golfclubfioranello.it/ | Official site candidate does not resolve with or without `www` in browser audit. User field knowledge confirms physical 18, but official web evidence is still pending. |
| Globale Jesolo | needs_review | 18 | 18 Buche (18)<br>Prime Nove (9)<br>Seconde Nove (9) | structure_verified | https://golfjesolo.it/ | Official site confirms Golf Club Jesolo and an 18-hole course. No full scorecard/hole-by-hole evidence captured. |

## Operational rule

No imported club can be considered green/certified unless the third level has at least `verified` official website evidence or an equivalent strong Evidence source, such as official scorecard PDF, club email confirmation, or field/admin check.

FIG + GesGolf coherence can justify orange/playable. It does not automatically certify a course.

`structure_verified` is suitable for a robust orange state, not automatic green.
