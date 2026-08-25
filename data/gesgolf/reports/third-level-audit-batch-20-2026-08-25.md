# Third-level audit — Batch 161-180 — 2026-08-25

Metodo applicato:
- Source primaria: FIG per identità club/percorso, tee, CR, Slope.
- Source operativa: GesGolf normalizzato per PAR/HCP buca-per-buca.
- Evidence di terzo livello: sito ufficiale club, pagine buca-per-buca, tabelle HCP, immagini/asset, PDF/link scaricabili quando disponibili.
- Decisione: verde solo se l'Evidence ufficiale supporta chiaramente la sequenza importata; arancio se giocabile ma non ancora certificabile.

## Club importati

| Club | Stato | Motivo |
| --- | --- | --- |
| Firenze Ugolino | verde | Sito ufficiale con percorso buca-per-buca e PAR/HCP; sequenza combacia con GesGolf/Stablr. |
| Torino | verde | Pagine ufficiali Blue/Yellow course con PAR/HCP buca-per-buca; Blue combacia con GesGolf/Stablr, Yellow importato da GesGolf/FIG e collegato alla stessa fonte ufficiale. |
| Robinie | verde | Pagine ufficiali buca-per-buca `buca-n-1` ... `buca-n-18` controllate: PAR/HCP completo e coerente con GesGolf/Stablr. |
| Rovedine | verde | Pagina ufficiale Campionato e immagini buca-per-buca controllate: PAR/HCP completo e coerente con GesGolf/Stablr. Il sito espone anche Executive Pitch & Putt 9 buche Par 27 con schede PAR/HCP; pubblicato come percorso official-site non FIG/WHS, senza CR/Slope inventati. Card club forzata a “2 percorsi”. |
| San Valentino | arancio | FIG+GesGolf espongono varianti Par 69/72; serve Evidence ufficiale per decidere assetto certificabile. |
| St. Anna | arancio | FIG+GesGolf mappano Monti/Mare e 18; serve Evidence ufficiale completa per certificare. |
| Campodoglio | arancio | FIG+GesGolf mappano Old/New/Easy/Mixed 2024; certificazione rinviata a Evidence ufficiale completa. |
| Castelfalfi | arancio | FIG+GesGolf mappano Mountain/Lake; certificazione rinviata a Evidence ufficiale completa. |
| Montelupo | arancio | FIG+GesGolf mappano varianti colore; certificazione rinviata a Evidence ufficiale completa. |
| Asiago | arancio | Importata struttura 2025 semplificata; varianti vecchie/provvisorie/invernali escluse finché non chiarite. |
| Folgaria | arancio | Sito ufficiale ha pagina percorso, tabella handicap linkata e sezioni visuali buca-per-buca; resta arancio finché non si estrae/controlla completamente il materiale visuale/PDF. |
| Bogogno | arancio | FIG+GesGolf mappano Conte/Bonora; serve Evidence ufficiale completa per certificare. |
| Asolo | arancio | FIG+GesGolf mappano combinazioni colore; provvisori non esposti; serve Evidence ufficiale completa. |
| Colline Gavi | arancio | FIG+GesGolf mappano Giallo/Blu/Rosso combinati; Rosso singolo non esposto per assenza route safe. |
| Monticello | arancio | FIG+GesGolf mappano Blu/Rosso/combinazioni; Family/provvisori esclusi nel primo import. |
| Royal Park Roveri | arancio | FIG+GesGolf mappano due percorsi, ma naming Trent Jones/Hurdzan Fry vs Allianz Course/Bank richiede controllo ufficiale dedicato. |
| Tolcinasco | arancio | FIG+GesGolf mappano Blu/Giallo/Rosso; Executive non esposto perché non presente nel normalizzato GesGolf. |
| Villa Condulmer | arancio | Sito ufficiale espone PAR/HCP buca-per-buca; almeno una discrepanza HCP richiede review manuale prima del verde. |
| San Vigilio | arancio | FIG Benaco/Solferino/San Martino/Pozzolengo mappato su naming GesGolf colore; serve review ufficiale dedicata. |
| Castelconturbia | arancio | FIG+GesGolf mappano combinazioni; Azzurro/Rosso 9 esclusi perché GesGolf li marca warning/non-standard. |

## Guardrail applicati

- Nessun intervento su Mare di Roma e Parco de' Medici.
- Nessuna route GesGolf `warning` usata nel batch.
- Nessun publish automatico: i 18 club non certificati restano arancioni.
- Nei complessi non è stata applicata la regola dei campi semplici 9/18: sono esposte solo route FIG/GesGolf esplicitamente mappate o percorsi club-official separati e documentati.
- Le varianti rumorose, duplicate, provvisorie o non mappate sono rimaste fuori dalla UX.
