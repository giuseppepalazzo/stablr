# Controllo manuale prossimo batch GesGolf - 2026-07-21

Obiettivo: controllo manuale dei 10 club del batch `Green Club Lainate` -> `Lignano Ssd`.

Legenda rapida:
- `Seed arancio`: gia' importato/seedato in Supabase come giocabile, ma non Stablr Approved.
- `Scraped/mapping`: dati GesGolf scaricati e candidati generati, ma non importato perche' il mapping richiede controllo manuale.
- `Possibile verde`: il sito ufficiale sembra esporre PAR + HCP/SI buca per buca; serve confronto completo con import/GesGolf/FIG.

| Club | Stato sintetico | Link sito / pagina campo | Link GesGolf |
|---|---|---|---|
| Green Club Lainate | Scraped/mapping; club complesso con 15 route/varianti, non importare senza selezione manuale di cosa tenere. | https://www.greenclubgolf.it/il-golf-club/percorso.html | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=102 |
| Gressoney | Seed arancio; sito conferma configurazione campo e PAR 70, ma non SI/HCP buca per buca. | https://www.golfgressoney.com/il-campo/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=715 |
| Is Arenas | Scraped/mapping; varianti/misti da capire, ma sito ufficiale ha pagina scorecard: possibile verde dopo confronto. | https://www.isarenas.it/scorecard/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=283 |
| Is Molas Ssd | Scraped/mapping; club complesso 27 buche, pagina ufficiale espone HCP su Championship e Yellow: serve mapping manuale accurato. | https://www.ismolasresort.com/en/championship-course.html / https://www.ismolasresort.com/en/yellow-course.html | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=814 |
| Laghi | Seed arancio; sito ufficiale espone PDF Stroke Saver con PAR/HCP: possibile verde dopo confronto visuale completo. | https://www.golfdeilaghi.it/en_GB/attivita-sportiva/percorso | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=777 |
| Lamborghini | Seed arancio; sito ufficiale espone PAR/HCP ma HCP non allineati a GesGolf/import, quindi resta arancio e richiede segreteria/scorecard aggiornata. | https://www.tenutalamborghini.com/percorso | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=155 |
| Lana | Scraped/mapping; sito ufficiale espone Stroke/Index per 9 buche, ma mapping GesGolf ha varianti/nomi ambigui. Possibile verde dopo mapping corretto. | https://www.golfclublana.it/it/campo-da-golf | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=256 |
| Lanzo | Scraped/mapping; sito ufficiale conferma 9 buche doppie partenze, PAR 68, CR/Slope, ma non SI/HCP buca per buca. | https://www.golflanzo.it/index.php/blog-single-column-4 | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=19 |
| Lecco | Scraped/mapping; sito ufficiale espone PAR/HCP buca per buca, ma GesGolf ha warning/varianti: possibile verde dopo mapping corretto. | https://golfclublecco.it/percorso-buche/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=56 |
| Lignano Ssd | Seed arancio; sito ufficiale conferma 18 buche PAR 72 ma non espone scorecard/SI nella pagina percorso. | https://golflignano.it/percorso/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=841 |

Priorita' consigliata per controllo manuale:
1. `Laghi`: PDF ufficiale Stroke Saver gia' individuato.
2. `Lecco`: pagina ufficiale con PAR/HCP buca per buca.
3. `Lana`: pagina ufficiale con Stroke/Index buca per buca.
4. `Is Arenas` / `Is Molas Ssd`: molto promettenti ma piu' complessi.

Nota operativa: non promuovere a `Stablr Approved` senza confronto completo PAR + SI/HCP contro GesGolf/import e FIG per CR/Slope.
