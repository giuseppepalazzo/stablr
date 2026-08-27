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
| San Valentino | verde | Sito ufficiale conferma due 18 buche e immagini ufficiali Par72 con PAR/HCP completo. Par72 pubblicato come default certificato; Par69 mantenuto come Old Course/Invernale. Buca 10 Par72 mantenuta HCP 7 come da immagine ufficiale. |
| St. Anna | verde | Sito ufficiale conferma 18 buche divise in Mare e Monti; pagine Mare/Monti e immagini ufficiali `1MARE...9MARE`, `1MONTI...9MONTI` espongono PAR/HCP e combaciano con GesGolf/Stablr. |
| Campodoglio | arancio | Microfix strutturale completato: il sito ufficiale descrive un campo fisico 9 buche Par 36 e tabelle `Buca 1/10`…`9/18` per Par72 e Par70. In UX restano attive solo `9 Buche`, `18 Buche Par 72`, `18 Buche Par 70`; varianti tecniche New/Easy/Mixed disattivate. La matrice ufficiale HCP tee-specific supporta Bianco/Giallo/Blu/Rosso, ma FIG espone anche Verde/Arancio non presenti nella pagina HCP del sito. Resta arancione: serve mail specifica al club per confermare se attenersi ai tee del sito o supportare anche Verde/Arancio FIG e come trattare HCP dinamici per quei tee. |
| Castelfalfi | arancio | FIG+GesGolf mappano Mountain/Lake; certificazione rinviata a Evidence ufficiale completa. |
| Montelupo | arancio | Microfix strutturale completato: sito ufficiale conferma 14 buche fisiche e la mappa ufficiale mostra tre routing 18 buche (`Bianco` Par68, `Rosso` Par68, `Blu` Par70). In UX restano attivi solo questi 3 percorsi; `Blu 9 buche`, `Verde`, `Giallo` disattivati. Card club forzata a “3 percorsi”. Non verde finché non troviamo Evidence ufficiale HCP/SI buca-per-buca. |
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
