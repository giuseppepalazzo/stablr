# Controllo manuale prossimo batch GesGolf - 2026-07-21

Obiettivo: controllo manuale dei 10 club del batch `Green Club Lainate` -> `Lignano Ssd`.

Legenda rapida:
- `Arancio`: configurabile e giocabile, ma non Stablr Approved.
- `Verde`: Stablr Approved perche' sito ufficiale/scorecard espone PAR + SI/HCP buca per buca e FIG resta fonte ufficiale per CR/Slope.
- `Rumore GesGolf`: route duplicate, legacy, provvisorie o nominalmente diverse che non vanno trasformate automaticamente in percorsi UX distinti.

| Club | Stato sintetico | Link sito / pagina campo | Link GesGolf |
|---|---|---|---|
| Green Club Lainate | Arancio; 18 fisico con route `18 Buche`, `Prime Nove`, `Seconde Nove`, ignorando rumore GesGolf. | https://www.greenclubgolf.it/il-golf-club/percorso.html | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=102 |
| Gressoney | Arancio; 9 fisico/12 da chiarire, ma sito ufficiale rimanda a GesGolf; route `9 Buche` e `18 Buche` giocabili. | https://www.golfgressoney.com/il-campo/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=715 |
| Is Arenas | Verde; scorecard ufficiale conferma PAR/HCP e tee. Route `18 Buche`, `Prime Nove`, `Seconde Nove`; tee ufficiali mappati FIG Bianco/Giallo/Verde/Blu/Rosso/Arancio, non Nero. | https://www.isarenas.it/golf-course/scorecard/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=283 |
| Is Molas Ssd | Arancio; complesso 27 buche in stile Parco: route base `Yellow`, `White`, `Red`; combinazioni `Championship White/Red`, `White/Yellow`. | https://www.ismolasresort.com/en/championship-course.html / https://www.ismolasresort.com/en/yellow-course.html | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=814 |
| Laghi | Verde; sito ufficiale con Stroke Saver e PAR/HCP, route `18 Buche`, `Prime Nove`, `Seconde Nove`, `Seconde Nove x 2`. | https://www.golfdeilaghi.it/en_GB/attivita-sportiva/percorso | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=777 |
| Lamborghini | Verde; 9 fisico con SI su pagina ufficiale, route `9 Buche` e `18 Buche`. | https://www.tenutalamborghini.com/percorso | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=155 |
| Lana | Verde; 9 fisico con Stroke/Index su sito ufficiale, route `9 Buche` e `18 Buche`. | https://www.golfclublana.it/it/campo-da-golf | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=256 |
| Lanzo | Verde; 9 fisico trattato come `9 Buche` + `18 Buche`, SI preservati da GesGolf/FIG e controllo manuale positivo. | https://www.golflanzo.it/index.php/blog-single-column-4 | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=19 |
| Lecco | Verde; sito ufficiale con PAR/HCP buca per buca, route `18 Buche`, `Prime Nove`, `Seconde Nove`. | https://golfclublecco.it/percorso-buche/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=56 |
| Lignano Ssd | Arancio; 18 fisico giocabile con route `18 Buche`, `Prime Nove`, `Seconde Nove`, ma senza scorecard/SI ufficiale sul sito. | https://golflignano.it/percorso/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=841 |

Esito operativo:
1. Generati e validati i 10 JSON normalizzati.
2. Da seedare in blocco su Supabase.
3. Regola anti-rumore GesGolf scritta anche in `gesgolf-pipeline-status.md`.

Nota operativa: non bloccare il verde solo per la presenza di route GesGolf duplicate/rumorose se il sito ufficiale conferma PAR + SI/HCP e FIG conferma CR/Slope.
