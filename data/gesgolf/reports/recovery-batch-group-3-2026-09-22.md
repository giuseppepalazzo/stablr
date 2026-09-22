# Recovery batch finale — gruppo 3/3 — 2026-09-22

## Scope e risultato

Ultimo recovery delle identita' FIG canoniche non ancora rappresentate nel layer Stablr: `Tauriana`, `Tirrenia`, `Valpescara`, `Verdura` e `Villa Giusti`.

| Club | Route FIG attive | Route pubblicate | Stato club | Decisione |
| --- | ---: | ---: | --- | --- |
| Tauriana | 2 | 2 | `playable_unverified` | **ORANGE** |
| Tirrenia | 3 | 2 | `certified` | **GREEN**; `Misto` non pubblicata |
| Valpescara | 7 | 3 | `certified` | **GREEN**; famiglie Laghi/Piano non pubblicate |
| Verdura | 6 | 6 | `playable_unverified` | **ORANGE** |
| Villa Giusti | 3 | 0 | `in_review` | non giocabile; tutte le route 2025 non pubblicate |

Route pubblicate complessive: 13. Route FIG lasciate non pubblicate: 8.

## Tauriana — ORANGE

### Route pubblicate

- `9 buche` — 9/35.
- `18 buche` — 18/70, doppio giro deterministico.

PAR 9: `4,4,5,3,4,3,5,3,4`.

SI/HCP 9: `11,1,9,5,15,13,3,7,17`.

SI/HCP 18: `11,1,9,5,15,13,3,7,17,12,2,10,6,16,14,4,8,18`.

FIG conferma Par 35/70; i CR della 18 sono esattamente doppi rispetto alla 9 e gli slope sono identici. Hole19 corrente coincide con la matrice fornita e con tutti i PAR descritti nelle fonti del campo. La route 18 usa la trasformazione Stablr standard primo giro dispari / secondo giro pari.

Una scorecard secondaria alternativa assegna invece gli SI compressi `6,1,2,3,8,7,5,4,9`, scambiando il peso relativo delle buche 3 e 7 rispetto a Hole19. Il dato Hole19 corrente viene pubblicato come giocabile, ma il conflitto impedisce il verde.

Evidence:

- `https://www.hole19golf.com/courses/tauriana-golf-club`
- `https://www.leadingcourses.com/it/clubs/europa%2Bitalia%2Bcalabria/tauriana-golf-club`
- confronto secondario storico: `https://www.golfify.io/courses/tauriana-golf-club`

## Tirrenia — GREEN

### Route pubblicate

- `Nove buche` — 9/36.
- `18 Buche` — 18/72.

PAR fisici: `5,4,4,3,4,5,3,4,4`.

SI compressi route 9: `8,4,7,9,3,6,5,1,2`.

HCP route 18: `15,7,13,17,5,11,9,1,3,16,8,14,18,6,12,10,2,4`.

Il sito ufficiale conferma il campo fisico da nove buche e il giro Par 72. Le nove grafiche ufficiali buca-per-buca espongono PAR e coppie HCP complete per primo e secondo giro. La compressione 1–9 e l'espansione 18 sono deterministiche e superano i guardrail.

### Route non pubblicata

- `Misto` — 18/72: rating e slope distinti, senza routing o matrice HCP specifici. Il solo Par 72 non prova equivalenza con `18 Buche`.

Evidence:

- `https://www.golftirrenia.it/`
- `https://www.golftirrenia.it/il-campo/`
- pagine ufficiali `buca-n-1-tasso` ... `buca-n-9-poiana`.

## Valpescara / Adriatico — GREEN

### Route pubblicate

- `18 BUCHE 2017` — 18/71.
- `Prime Nove` — 9/36.
- `Seconde Nove` — 9/35.

PAR 18: `4,4,3,4,4,4,5,3,5,4,4,4,3,5,4,4,4,3`.

HCP 18: `15,3,13,5,1,9,17,11,7,12,6,2,14,8,16,4,10,18`.

Il sito ufficiale corrente Adriatico Golf Club pubblica direttamente PAR e HCP per tutte le diciotto buche. La matrice coincide integralmente con i totali FIG 36+35=71 e i due segmenti sono deterministicamente estratti dalla stessa scorecard certificata.

### Route non pubblicate

- `18 buche laghi` — 18/71.
- `9b laghi` — 9/36.
- `9b piano` — 9/36.
- `9b piano 2 Volte` — 18/72.

Le quattro route restano catalogate ma non live: non esiste una matrice specifica affidabile e il Par coincidente non consente di identificare routing o SI.

Evidence: `https://adriaticogolfclubspa.com/il-campo/`.

## Verdura — ORANGE

### Route pubblicate

- `East` — 18/73.
- `East Prime Nove` — 9/36.
- `East Seconde Nove` — 9/37.
- `West` — 18/70.
- `West Prime Nove` — 9/36.
- `West Seconde Nove` — 9/34.

East PAR: `4,3,4,5,4,4,3,5,4,4,4,4,3,4,5,4,5,4`.

East HCP: `17,11,15,5,1,7,3,13,9,6,4,14,8,16,10,18,12,2`.

West PAR: `4,4,4,3,5,4,5,3,4,5,4,3,4,4,3,4,3,4`.

West HCP: `7,8,10,17,5,3,6,13,9,14,11,18,12,2,16,1,15,4`.

Il materiale ufficiale corrente conferma Links/East Par 73 e Shore/West Par 70. All Square espone la scorecard East completa; Hole19 e 18Birdies espongono la matrice West completa. Tutte coincidono con i dati recuperati. I segmenti 9 sono estratti dalle rispettive 18 e PAR/CR FIG ne confermano la composizione.

Le sei route restano arancioni: le matrici SI complete sono pubblicate da fonti secondarie e non da una scorecard ufficiale completa del resort. L'evidenza e' sufficiente alla giocabilita', non alla certificazione verde.

Evidence:

- `https://www.roccofortehotels.com/hotels-and-resorts/verdura-resort/golf/`
- `https://www.allsquaregolf.com/golf-courses/italy/verdura-golf-and-spa-resort-east-course`
- `https://www.hole19golf.com/courses/verdura-resort-shore`
- `https://18birdies.com/golf-courses/club/7c7a6350-86ac-11e4-8c28-020000005b00/verdura-resort`

## Villa Giusti — IN_REVIEW

Il club e' rappresentato e collegato a `fig-club-villa-giusti`, ma `playable=false` e non ha route pubblicate.

Route FIG 2025 non pubblicate:

- `18 Buche 2025` — 18/66.
- `Prime Nove 2025` — 9/31.
- `Seconde Nove 2025` — 9/35.

FIG conferma tee, CR/Slope e additivita' dei CR fra le due nove e la 18. Manca tuttavia una matrice SI/HCP affidabile per la nuova configurazione 2025.

La vecchia scorecard Par 65 (`31+34`) e i relativi HCP vengono registrati solo come provenance storica e non sono stati trasferiti al Par 66. Villa Giusti non e' stato confuso con Villa Condulmer o con altri candidati GesGolf basati sulla parola `Villa`.

## Guardrail e validazioni

- Builder: `scripts/gesgolf/build-recovery-batch-group-3-2026-09-22.mjs`.
- Verifica remota: `scripts/gesgolf/verify-recovery-batch-group-3-2026-09-22.mjs`.
- Tutti i cinque payload superano `npm run fig:validate`.
- Controllati per ogni route: identita' FIG, numero buche, somma PAR, SI interi e unici, copertura SI 1–18 sulle route 18, tee FIG, CR e Slope.
- Le route `Misto`, Laghi/Piano e Villa Giusti 2025 non compaiono fra le route live.
- Nessuna route irrisolta blocca le route affidabili dello stesso club.
- Nessun dato della vecchia scorecard Villa Giusti Par 65 e' entrato nel payload 2025.

## Seed e read-back remoto

Preflight:

- 217 club attivi e giocabili;
- 100 verdi, 117 arancioni, 0 `in_review` non giocabili;
- nessuno dei cinque source ID era gia' presente in `clubs`.

Seed eseguito una sola volta per ciascuno dei cinque payload.

Read-back:

| Club | Route | Buche | Tee | Stato |
| --- | ---: | ---: | ---: | --- |
| Tauriana | 2 | 27 | 8 | orange / playable |
| Tirrenia | 2 | 27 | 8 | green / playable |
| Valpescara | 3 | 36 | 12 | green / playable |
| Verdura | 6 | 72 | 42 | orange / playable |
| Villa Giusti | 0 | 0 | 0 | in_review / non-playable |

Il confronto integrale di club, route, holes, tee, status, governance state, PAR, SI/HCP, CR e Slope non ha rilevato differenze (`issues: []`).

Conteggi finali verificati:

- identita' FIG canoniche locali: 220;
- righe FIG remote attive: 228, incluse 8 identita' alias legacy HTML-encoded;
- club Stablr attivi: 222;
- club giocabili: 221;
- club non giocabili: 1;
- verdi: 102;
- arancioni: 119;
- `in_review`: 1;
- `needs_review` totale tecnico: 120, composto da 119 arancioni giocabili e Villa Giusti in review.
