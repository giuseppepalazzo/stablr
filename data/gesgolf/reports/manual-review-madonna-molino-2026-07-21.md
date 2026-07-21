# Controllo batch GesGolf - Madonna Campiglio -> Molino Pero - 2026-07-21

Obiettivo: importare 10 club applicando le nuove regole Stablr su struttura fisica, rumore GesGolf, ricerca web approfondita e badge.

Legenda:
- `Verde`: Stablr Approved, perche' FIG conferma catalogo/CR/Slope, GesGolf fornisce PAR/SI e il sito ufficiale espone PAR + SI/HCP buca per buca.
- `Arancio`: configurabile e giocabile, ma resta in review per mancanza di scorecard/SI ufficiale completa o per complessita' da controllare manualmente.

| Club | Stato | Struttura Stablr | Link sito / pagina campo | Link GesGolf |
|---|---|---|---|---|
| Madonna Campiglio | Arancio | 9 fisico: `9 Buche`, `18 Buche` | https://www.ski.it/it/attivita/golf-club | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=10 |
| Mantova | Arancio | 9 fisico: `9 Buche`, `18 Buche` | https://www.originigolfmantova.com/golf-club/campo/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=154 |
| Marco Simone | Verde | 18 fisico: `18 Buche`, `Prime Nove`, `Seconde Nove` | https://golfmarcosimone.com/the-holes/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=14 |
| Margara | Arancio | Complesso 36: basi 9 `Lolli Ghetti` / `La Guazzetta` e combinazioni 18 | https://www.golfmargara.it/golf/percorso-glauco-lolli-ghetti/ / https://www.golfmargara.it/golf/percorso-la-guazzetta/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=55 |
| Margherita | Arancio | 18 fisico: `18 Buche`, `Prime Nove`, `Seconde Nove` | https://www.golfclublamargherita.it/percorso/handicap/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=188 |
| Menaggio | Verde | 18 fisico: `18 Buche`, `Prime Nove`, `Seconde Nove` | https://www.golfclubmenaggio.com/it/giocare-a-golf/percorso | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=65 |
| Milano | Arancio | Complesso 27: `Percorso 1`, `Percorso 2`, `Percorso 3`; combinazioni `1/2`, `1/3`, `2/3` | https://www.federgolflombardia.it/portfolio-item/golf-club-milano/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=17 |
| Modena | Arancio | 18 fisico + Executive FIG: `18 Buche`, `Prime Nove`, `Seconde Nove`, `Executive 9 Buche`, `Executive 18 Buche` | https://www.modenagolf.it/percorso-langer | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=192 |
| Molinetto | Verde | 18 fisico: `18 Buche`, `Prime Nove`, `Seconde Nove` | https://www.molinettocountryclub.it/buca-1/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=15 |
| Molino Pero | Arancio | 18 fisico: `18 Buche`, `Prime Nove`, `Seconde Nove` | https://www.molinodelpero.it/ | https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=160 |

Esito operativo:
1. Generati e validati i 10 JSON normalizzati.
2. Seed Supabase completato.
3. Audit DB read-only completato: numero route/combinazioni e badge coerenti con la struttura prevista.
4. Mirasole e' stato saltato nel batch per errore scrape GesGolf (`__EVENTVALIDATION` hidden non trovato).

Lezione del batch: il verde non va trattenuto per paura quando il sito ufficiale espone davvero PAR + SI/HCP. La ricerca deve scavare nelle pagine percorso, singole buche, scorecard PDF/immagini e non fermarsi alla home.
