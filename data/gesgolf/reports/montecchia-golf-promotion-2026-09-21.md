# Montecchia Golf — promotion audit — 2026-09-21

## Decision

Promosso da `needs_review` / playable arancio a `verified` / Stablr Approved verde secondo Governance Framework v3.

## Scope certificato

Le sette route FIG attive rimangono invariate: `Bianco`, `Rosso`, `Verde`, `Bianco-Rosso`, `Bianco-Verde`, `Rosso-Verde`, `Verde-Verde`. Le varianti Albarella, Galzignano e VO23 restano escluse.

## Evidenza e cross-check

- Le pagine ufficiali buca-per-buca di Bianco, Rosso e Verde espongono PAR e HCP/SI per tutte le 27 buche.
- Le matrici delle sette route nel payload Stablr coincidono integralmente con le route GesGolf corrispondenti (`circolo_id=831`).
- Le route da 9 buche usano la compressione deterministica della graduatoria HCP ufficiale 1--18 in SI 1--9; le combinazioni 18 buche coincidono con le coppie/parita' ufficiali e producono SI completi 1--18.
- FIG resta l'autorita' dell'identita' dei percorsi e definisce il terzo segmento `Verde`.

## Anomalia nominale registrata

La navigazione e l'URL ufficiali identificano il segmento come `Verde` (`/percorso-verde`), ma alcune grafiche buca-per-buca riportano `Percorso Giallo`. Non sono state rilevate divergenze di PAR, HCP/SI o routing rispetto a Verde FIG/GesGolf; l'incoerenza e' registrata come anomalia editoriale del sito, non come rinomina Stablr.

## Fonti

- https://www.golfmontecchia.it/il-percorso-bianco
- https://www.golfmontecchia.it/il-percorso-rosso
- https://www.golfmontecchia.it/percorso-verde
- https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=831
