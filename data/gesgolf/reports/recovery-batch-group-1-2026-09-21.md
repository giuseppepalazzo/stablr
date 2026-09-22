# Recovery batch finale — gruppo 1/3 — 2026-09-21

## Esito

| Club | Playable course FIG | Evidenza FIG/GesGolf | Evidenza esterna | Match PAR | Match HCP/SI | Problema routing/versione | Stato precedente | Stato finale | Motivazione |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Musella | `Corte Tetra` 9/18; `Del Drago` 9/18; `Fibbio 18 (12+6)`; `Old Course` 9/18 | 7 route FIG e 7 route GesGolf dirette (`2723`--`2728`, `2825`) | Sito ufficiale: 12 buche omologate e scorecard 2025 di Old Course, Del Drago, Corte Tetra, Fibbio; FederGolf Veneto conferma 12 buche | completo | completo sulle quattro scorecard ufficiali; GesGolf completa le tre ripetizioni 18 | risolto il mapping delle 12 buche fisiche; gap residuo solo sulla regola SI 9→18 delle tre ripetizioni | non rappresentato | arancione / `playable_unverified` | Tutte le route FIG sono mappabili e giocabili. Il verde resta sospeso perché la trasformazione SI delle ripetizioni non è esplicitata dall'evidenza ufficiale. |
| Pavoniere | 10 route FIG: 18 principale/short/Campionato, prime e seconde nove standard/short, due ripetizioni short e doppia seconda nove | match diretto con GesGolf `1839`, `1842`, `1843`, `2221`--`2223`, `2392`, `2393`, `3006` | scorecard ufficiale 18 buche Par 72, PAR/HCP completi | completo | completo; ripetizioni 18 deterministiche dalle nove ufficiali e identiche a GesGolf | nessun blocco residuo; `ARNIE` e `Palmer` GesGolf non mappati perché duplicati/estranei alle 10 identità FIG selezionate | non rappresentato | verde / `certified` | Tutte le route FIG attive sono riconciliate senza modificare matrici. |
| Punta Ala | `18 Buche`, `Prime Nove`, `Seconde Nove` | FIG completo per identita', Par, tee, CR/Slope; nessun GesGolf attribuibile (`PUNTALDIA` escluso) | sito ufficiale 18/72 con 16 HCP leggibili; All Square e FlyAway espongono la stessa matrice completa | completo | completo: i secondari coincidono con tutti i valori ufficiali validi e risolvono buche 3/10/11 | nessun conflitto residuo per la giocabilita'; Evidence insufficiente per il verde | `in_review`, non giocabile | arancione / `playable_unverified` | Pubblicate 18 buche e le due nove FIG come segmenti della matrice supportata. |
| Roncegno | `9 buche` Par 34; `18 buche` Par 68 | FIG completo per identita', Par, tee, CR/Slope; GesGolf assente | sito ufficiale conferma campo fisico e PAR; Hole19 fornisce PAR/SI completi | completo | completo per il 9; il 18 usa la trasformazione Stablr standard dispari/pari | il typo ufficiale della buca 9 riguarda il PAR visualizzato, non rende ambigua la matrice complessiva | `in_review`, non giocabile | arancione / `playable_unverified` | Pubblicato il 9 corrente e il doppio giro FIG deterministico. |
| Salerno | `9 Buche Par 33`, `9 Buche Par 34`, `18 Buche Par 66`, `18 Buche Par 68` | FIG completo per identita', Par, tee, CR/Slope; GesGolf assente | sito ufficiale conferma il 9/34; Hole19 fornisce PAR/SI completi | completo per 9/34 e derivato 18/68 | completo per 9/34; trasformazione standard valida per 18/68 | le varianti 9/33 e 18/66 restano non pubblicate come possibile versioning precedente/distinto | `in_review`, non giocabile | arancione / `playable_unverified` | Pubblicate solo le due route coerenti col percorso corrente; le varianti non supportate non bloccano il club. |

## Matrici e guardrail

- Nessuna matrice FIG/GesGolf e' stata alterata per ottenere un match.
- Musella pubblica esclusivamente le sette route FIG con corrispondenza diretta GesGolf. Le scorecard ufficiali 2025 confermano: Old Course `3,3,4,4,5,3,3,4,3` / SI `9,7,2,1,3,6,8,4,5`; Del Drago `3,3,4,3,5,4,3,4,3` / SI `8,9,3,5,4,1,7,2,6`; Corte Tetra `3,3,4,5,4,4,3,4,3` / SI `8,9,3,4,1,2,7,5,6`; Fibbio 18 coincide integralmente con GesGolf.
- Pavoniere usa la matrice ufficiale PAR `4,4,5,4,3,4,4,3,5,4,5,4,4,3,4,5,3,4` e SI `13,3,7,1,9,11,5,17,15,12,16,8,6,18,2,10,14,4`. Le route duplicate GesGolf senza identita' FIG selezionata non vengono pubblicate.
- Punta Ala usa PAR `4,3,4,5,4,3,5,4,4,5,3,4,5,4,3,4,4,4` e SI `17,15,9,7,3,13,5,1,11,10,12,2,8,6,18,4,14,16`; Prime Nove e Seconde Nove sono segmenti della stessa matrice.
- Roncegno usa il 9/34 PAR `4,4,5,4,4,3,3,3,4`, SI `1,3,2,4,7,5,8,6,9`; il 18/68 usa la trasformazione standard primo giro dispari, secondo giro pari.
- Salerno usa il 9/34 PAR `4,3,5,3,4,4,3,4,4`, SI `2,8,4,9,7,5,6,3,1`; il 18/68 usa la stessa trasformazione standard. Le route FIG 9/33 e 18/66 restano identita' catalogo non pubblicate.

## Seed e verifica remota

- Seed Supabase completato una sola volta per tutti e cinque i payload, senza errori.
- Controllo post-seed: tutti e cinque i club hanno `fig_club_id`, mapping FIG `matched` con confidenza `1` e sono attivi.
- Musella: `needs_review`, `playable: true`, `playable_unverified`, 7 route attive.
- Pavoniere: `verified`, `playable: true`, `certified`, `stablr_approved: true`, 10 route attive.
- Punta Ala, Roncegno e Salerno sono stati aggiornati una sola volta dopo il riesame della soglia di giocabilita': tutti `needs_review`, `playable: true`, `playable_unverified`.
- Verifica correttiva locale/remoto superata: 3 club, 7 route, 90 righe buca e 34 tee, senza differenze dai payload normalizzati; collegamenti FIG e tassonomia controllati.
- Conteggi remoti finali: 212 club attivi e giocabili, 0 non giocabili, 99 `verified` e 113 `needs_review`.

## Fonti

- Musella: https://golfmusella.it/the-course/ e pagine ufficiali dei quattro routing; https://www.federgolfveneto.it/golf-clubs/242-musella; GesGolf circolo `674`.
- Pavoniere: https://www.pavoniere.it/index.php/score/; GesGolf circolo `703`.
- Punta Ala: https://golfpuntaala.it/percorso; https://www.allsquaregolf.com/golf-courses/italy/golf-club-punta-ala; https://flyawaygolf.com/golfs/golf-club-punta-ala.
- Roncegno: https://www.golfclubroncegno.it/percorso; https://www.hole19golf.com/courses/golf-club-roncegno.
- Salerno: https://golfclubsalerno.it/percorso/; https://www.hole19golf.com/courses/golf-club-salerno.
