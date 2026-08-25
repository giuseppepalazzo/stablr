# GesGolf Pipeline Status

## Obiettivo

Usare GesGolf come fonte secondaria strutturata per buche, par e Stroke Index, mantenendo FIG come catalogo ufficiale master per club, percorsi, Course Rating e Slope.

## Vincoli confermati

- Non aggiornare automaticamente il DB live.
- Non toccare i club protetti:
  - Mare di Roma
  - Parco De' Medici
- Regola permanente: Mare di Roma e Parco De' Medici non devono essere toccati automaticamente da batch, seed correttivi o semplificazioni.
- Parco De' Medici resta benchmark di confronto, non fonte da sovrascrivere.
- Mare di Roma e Parco De' Medici sono club manuali protetti: non rientrano nei file `data/gesgolf/imports`, ma rientrano nel conteggio prodotto dei club giocabili Stablr. Possono essere uniformati solo nei metadati club (`data_status`, `source_type`, `source_payload.stablr_approved`, `source_payload.protected_manual`), senza toccare route, buche, tee o combinazioni curate manualmente.
- Prima di convalidare un nuovo campo per il DB live, usare un controllo a tre livelli:
  1. FIG come catalogo ufficiale per club, percorsi, Course Rating e Slope.
  2. GesGolf come fonte strutturata per buche, par e Stroke Index.
  3. Ricerca web approfondita della pagina ufficiale del club con dati del campo: non basta la home page o un link generico al club; cercare pagina percorso/course guide/scorecard/mappa campo che esponga almeno buche e par, idealmente anche Stroke Index.
- La terza ricerca non si considera chiusa finche' non e' stata cercata una pagina specifica del campo, non solo la home del club: usare query mirate con `scorecard`, `percorso`, `course guide`, `holes`, `buca`, `hcp`, `stroke index`, `slope`, PDF/immagini e pagine singole buca. Se emerge PAR + SI/HCP buca per buca su sito ufficiale, e FIG conferma CR/Slope, il club puo' diventare verde anche se GesGolf contiene rumore o alias duplicati.
- La terza ricerca deve includere fin dal primo passaggio anche gli asset della pagina ufficiale, non solo il testo HTML visibile:
  - cercare e aprire/scaricare immagini `jpg/png/webp`, PDF, lightbox, slider, iframe, background image, card buca-per-buca e link generati da WordPress o builder visuali;
  - se la pagina mostra solo PAR/HCP dentro immagini, creare un controllo visuale leggibile, ad esempio aprendo le immagini singole o creando un contact sheet;
  - usare estrazione PDF/testo quando disponibile, ma se il PDF e' una scansione o immagine, renderizzarlo e leggerlo visivamente;
  - non concludere “manca HCP/SI” finche' non sono stati controllati asset e media collegati alla pagina ufficiale del percorso;
  - esempi da ricordare: `Puntaldia` espone HCP solo nelle immagini `buca-1.jpg` ... `buca-9.jpg`; `Poggio Medici` espone scorecard in PDF immagine; `Dolomiti` espone card in iframe/immagini `Table1.png` ... `Table18.png`; `Cus Ferrara` espone HCP dentro immagine ufficiale del percorso.
- Se FIG + GesGolf + pagina ufficiale del campo combaciano sui dati rilevanti, il club puo' diventare subito `Stablr Approved` dopo il controllo manuale.
- Se il sito ufficiale non e' disponibile, espone solo informazioni generiche o non conferma dati campo sufficienti, il club resta da review manuale; fonti terze tipo Golfify sono utili come indizio ma non valgono come conferma indipendente se sembrano derivate da GesGolf.
- Le fonti terze possono contribuire al controllo solo quando espongono una scorecard verificabile come PDF o immagine, da leggere visivamente e incrociare con FIG/GesGolf; una pagina testuale terza senza scorecard visuale resta solo indizio. Esempio valido: scorecard PDF/immagine trovata per il controllo della lettera A / Perugia-Antognolla.
- Audit retroattivo dei primi club importati:
  - `data/gesgolf/reports/website-evidence-audit.md`
- Regola default giro:
  - club fisico 9 buche con 18 ufficiale derivato, ad esempio Albisola/Aosta/Mare di Roma: default 9 buche;
  - club fisico 18 buche con Prime Nove/Seconde Nove, ad esempio Ambrosiano/Antognolla/Fioranello: default 18 buche;
  - club complesso o con piu' percorsi/combinazioni ufficiali da 9 buche, ad esempio Parco De' Medici: default 18 buche.
- Regola badge:
  - `Stablr Approved` verde si usa solo per campi controllati manualmente e marcati con `source_payload.stablr_approved: true`;
  - in UI il badge e' solo icona verde, senza scritta; evitare label tipo `Verificato` o `Approved` sulla card, perche' appesantiscono e confondono stato tecnico e controllo manuale;
  - tassonomia badge card club: `Approved`, `Review`, `Community`;
  - al momento sono approvati manualmente `Albisola`, `Ambrosiano`, `Antognolla`, `Bagnaia`, `Bogliaco`, `Colli Bergamo` e `Fioranello`;
  - `verified` senza approvazione manuale non deve mostrare il badge verde.
  - se il controllo a tre livelli passa, aggiornare subito il club a `data_status: verified`, `source_payload.verification_status: verified` e `source_payload.stablr_approved: true`, con nota esplicita sulle fonti usate.
- Regola di semplificazione prodotto:
  - i club semplici fisici da 9 buche devono partire di default a 9 buche e, salvo eccezioni, avere una route `9 Buche` e una route `18 Buche`;
  - se GesGolf/FIG espongono varianti 9 ufficiali coerenti e utili, possono essere mantenute come varianti 9 dedicate; per Albisola la nomenclatura e' `Prime 9 · Par 32` default e `Prime 9 · Par 33` variante;
  - se FIG/GesGolf espongono varianti ufficiali 18 buche per un club fisico da 9, queste possono diventare opzioni giocabili 18 buche dedicate, non una ripetizione automatica della route 9;
  - quando il sito ufficiale conferma una variante 18, quella variante diventa default; le altre varianti FIG/GesGolf restano disponibili quando coerenti, perche' GesGolf e' considerata una fonte operativa piu' che attendibile per par e Stroke Index;
  - se esiste un 18 strutturato, non mostrare in UX la composizione libera del giro; la scelta manuale resta solo fallback tecnico per club senza opzioni 18 ufficiali;
  - per club fisici da 18 buche con `Prime Nove` e `Seconde Nove`, il default resta `18 Buche`; se l'utente sceglie 9 buche, default `Prime Nove`, con `Seconde Nove` come seconda scelta;
  - i club semplici fisici da 18 buche devono esporre solo `18 Buche`, `Prime Nove` e `Seconde Nove`;
  - anche i club complessi/multi-percorso devono usare la stessa struttura UX dei club semplici nella pagina `Imposta giro`: una sola sezione `Scegli il percorso`, senza separare `Giri ufficiali` e `Altre opzioni di gioco`.
- Regola naming:
  - per club semplici usare nomi funzionali e non proprietari: `9 Buche`, `18 Buche`, `Prime Nove`, `Seconde Nove`;
  - usare nomi GesGolf/FIG specifici solo se sono davvero iconici e distintivi per distinguere percorsi diversi, soprattutto nei club complessi o multi-percorso;
  - nei club complessi usare i nomi reali/distintivi adottati dal club, senza normalizzare forzatamente in colori o pattern generici: colori, punti cardinali, nomi propri o label storiche vanno mantenuti quando aiutano il giocatore a riconoscere il percorso;
  - esempi da evitare nei club semplici: `Ambro 1`, `Campionato`, `Normale`, se non indicano una scelta realmente distinta per il giocatore;
  - nelle label della pagina `Imposta giro`, per tutti i club semplici importati o futuri, mostrare sempre una scelta funzionale e completa su una riga: `9 Buche · Par X`, `18 Buche · Par X`, `Prime 9 · Par X`, `Seconde 9 · Par X`; non mostrare nomi tecnici o interni come `Percorso`, `Percorso × 2`, `Mare 2 volte` o simili;
  - per i club semplici fisici da 9 buche, il fatto che il 18 sia ottenuto giocando due volte il 9 e' una logica interna: in UX si mostra `18 Buche · Par X`, salvo eccezioni esplicite come varianti ufficiali con par diversi;
  - per i club semplici fisici da 18 buche, la scelta 18 si mostra come `18 Buche · Par X`; le scelte 9 si mostrano come `Prime 9 · Par X` e `Seconde 9 · Par X`;
  - eccezione: se una route da 18 ha un nome iconico/reale utile al giocatore, il nome iconico vince sulla label generica `18 Buche`; esempio `Modena`: `Bernhard Langer · 18 buche · Par 72` e `Executive · 18 buche · Par 54`;
  - in card club mostrare `9 buche · Par X`, `18 buche · Par X`, oppure `N percorsi` per club complessi con piu' percorsi reali.
  - le varianti giocabili di un club semplice, ad esempio le 5 varianti di `Albisola`, non devono mai essere contate come `N percorsi` nella card club: la card descrive il campo fisico, non il numero di opzioni nel setup giro.
  - nelle card percorso del setup giro non duplicare buche/par se il nome li contiene gia': `Prime 9 · Par 32`, non `Prime 9 · Par 32 · 9 buche · Par 32`.
  - per tutti i club complessi/multi-percorso, salvo eccezione esplicita, le route 18 ottenute giocando due volte lo stesso percorso 9 devono usare copy compatta `{Nome percorso} × 2` e dettaglio `18 buche · Par X`, ad esempio `Blu × 2` / `18 buche · Par 74`; se esiste un nome iconico/distintivo utile al giocatore, usare `{Nome iconico} · {Nome percorso} × 2`, ad esempio `Est · Rosso × 2`; evitare `9 Buche Blu 2 Volte`.
  - nel setup giro, se un club semplice ha piu' varianti per la stessa durata, ad esempio `Albisola` con tre varianti 18 buche, mostrare la variante default in forma compressa e aprire le alternative con la freccia `Scegli il percorso`; il default resta evidenziato ma non deve eliminare le alternative.
  - per club complessi come `Parco De' Medici`, le combinazioni 18 e le opzioni 18 ottenute ripetendo una route 9 due volte devono stare nella stessa lista `Scegli il percorso`; la verifica Stablr e' comunicata dal badge/dato di fiducia, non da sezioni separate.

## Stato attuale

### 1. Coverage FIG -> GesGolf

- Club FIG totali: 220
- Match forti GesGolf: 184
- Match deboli o assenti: 36

File:
- `data/gesgolf/reports/fig-gesgolf-coverage.json`
- `data/gesgolf/reports/fig-gesgolf-coverage.csv`

### 2. Scraper GesGolf

Pronto:
- scrape singolo club
- scrape batch da coverage FIG
- salvataggio `raw` + `normalized`
- classificazione per club e per percorso:
  - `safe`
  - `warning`
  - `error`

Script:
- `scripts/gesgolf/scrape-club-lib.mjs`
- `scripts/gesgolf/scrape-club-percorsi.mjs`
- `scripts/gesgolf/scrape-covered-clubs.mjs`

### 3. Benchmark Parco De' Medici

Confronto FIG vs GesGolf completato.

Esito:
- molti par combaciano
- in alcuni casi lo Stroke Index GesGolf non coincide con il benchmark Stablr/FIG
- `INTERNAZIONALI` su GesGolf oggi risponde HTTP 500
- `Red` resta anomalo e non va considerato importabile in automatico

File:
- `data/gesgolf/reports/parco-de-medici-gesgolf-mismatch.md`
- `data/gesgolf/reports/parco-de-medici-gesgolf-mismatch.json`

### 4. Registro di mapping GesGolf -> FIG

Pronto:
- template automatico di mapping
- override manuali benchmark per Parco De' Medici
- distinzione tra mapping suggerito e mapping finale

File:
- `data/gesgolf/mappings/manual-route-mappings.json`
- `data/gesgolf/mappings/route-mapping-template.json`
- `data/gesgolf/mappings/route-mapping-template.csv`

Script:
- `scripts/gesgolf/route-mapping-lib.mjs`
- `scripts/gesgolf/build-route-mapping-template.mjs`

### 5. Filtro finale import

Pronto:
- `import_ready`
- `needs_review`
- `protected_reference`
- `excluded_reference`

`excluded_reference` serve per tenere traccia di percorsi GesGolf presenti nello scrape ma non da importare, per esempio alias duplicati o percorsi con meta' vuota/azzerata. La route esclusa resta documentata nel mapping, ma non blocca il club se tutte le route richieste per FIG sono pronte.

File:
- `data/gesgolf/mappings/import-candidates.json`
- `data/gesgolf/mappings/import-candidates.csv`

Script:
- `scripts/gesgolf/build-import-candidates.mjs`

## Risultato dell'ultimo test reale

Club processati nel batch reale:
- 6 club non protetti:
  - `Acaya`
  - `Albisola`
  - `Alpino`
  - `Ambrosiano`
  - `Antognolla`
  - `Aosta Arsanieres`

Esito batch:
- `safe`: 3 club
- `warning`: 3 club
- `error`: 0 club

Import summary attuale:
- route totali valutate: 405
- `import_ready`: 99
- `needs_review`: 338
- `protected_reference`: 11
- `excluded_reference`: 8

Club gia' interamente `import_ready`:
- `Albisola`
- `Aosta Arsanieres` *(giocabile in revisione / arancio, non verde: caso tecnico valido per regola SI 9 fisico + 18 ufficiale; sito ufficiale conferma 9 buche e pubblica Tabella EGA, ma la Tabella EGA e' conversione handicap di gioco, non scorecard PAR/SI buca-per-buca)*
- `Ambrosiano`
- `Antognolla` *(Stablr Approved: scorecard ufficiale/Worldclass conferma par e SI; CR/Slope mantenuti da FIG ufficiale)*
- `Aosta Brissogne` *(giocabile in revisione / arancio, non verde)*
- `Arenzano Pineta` *(giocabile in revisione / arancio, non verde)*
- `Bagnaia` *(Stablr Approved: course guide ufficiale conferma par e SI; CR/Slope mantenuti da FIG ufficiale)*
- `Barlassina` *(giocabile in revisione / arancio, non verde)*
- `Bogliaco` *(Stablr Approved: scorecard ufficiale visuale/PDF conferma par e SI; CR/Slope mantenuti da FIG ufficiale)*
- `Bollina` *(giocabile in revisione / arancio, non verde)*
- `Caorle` *(giocabile in revisione / arancio, non verde)*
- `Citta' D'Asti` *(giocabile in revisione / arancio, non verde)*
- `Colli Bergamo` *(Stablr Approved: pagina percorso ufficiale conferma par e HCP/SI; CR/Slope mantenuti da FIG ufficiale)*
- `Colombaro` *(giocabile in revisione / arancio, non verde)*
- `Cortina Ssd` *(giocabile in revisione / arancio, non verde)*
- `Fioranello` *(Stablr Approved: scorecard ufficiale 2024 conferma par e SI; CR/Slope mantenuti da FIG ufficiale)*
- `Globale Jesolo` *(giocabile in revisione / arancio, non verde)*
- `Gressoney` *(giocabile in revisione / arancio, non verde: import GesGolf/FIG seedato; sito ufficiale conferma configurazione campo PAR 70 ma non espone SI/HCP buca per buca; serve scorecard ufficiale o segreteria)*
- `Laghi` *(giocabile in revisione / arancio, non verde: import GesGolf/FIG seedato; sito ufficiale espone PDF Stroke Saver ufficiale con PAR/HCP, da confrontare visivamente prima del badge verde)*
- `Lamborghini` *(giocabile in revisione / arancio, non verde: import GesGolf/FIG seedato, ma sito ufficiale espone HCP/SI non allineati a GesGolf; serve conferma scorecard ufficiale o segreteria prima del verde)*
- `Lignano Ssd` *(giocabile in revisione / arancio, non verde: import GesGolf/FIG seedato; sito ufficiale conferma 18 buche PAR 72 ma non espone scorecard/SI nella pagina percorso; serve scorecard ufficiale o segreteria)*

Secondo caso validato:
- `Aosta Arsanieres`
  - importa `18 Buche` da `Aosta 18 buche`
  - importa `9 Buche` da `9 buche`
  - esclude `OLD C.` come alias 18 duplicato
  - esclude `PR NOVE` per anomalia GesGolf: 18 dichiarate con seconda meta' vuota/azzerata
  - conferma la regola Stroke Index per club fisico 9 + 18 ufficiale: il 9 buche eredita il segmento del 18 ufficiale, non i compressi 1-9
  - correzione stato badge: resta arancio / playable review, perche' il sito ufficiale `https://golfaosta.com/` espone una `Tabella EGA` (`https://golfaosta.com/tabella-ega/`, immagine `tab-ega.png`) ma non una scorecard con PAR/SI-HCP buca-per-buca.

Terzo caso validato:
- `Ambrosiano`
  - importa `18 Buche` da `Ambro 1`
  - importa `Prime Nove` da `1&#176; nove`
  - importa `Seconde Nove` da `2&#176; nove`
  - classificato come campo fisico 18 buche: `physical_hole_count: 18`
  - il sito ufficiale conferma un percorso 18 buche PAR 72 e una scorecard buca-per-buca coerente con GesGolf:
    - `https://golfclubambrosiano.com/percorso/`
    - `https://golfclubambrosiano.com/wp-content/uploads/2023/11/Scorecard.pdf`
  - anche i 9 buche ereditano i segmenti corretti del 18 ufficiale, non SI compressi 1-9

Quarto caso importabile con cautela:
- `Antognolla`
  - importa `18 buche` da `Championship`
  - importa `Prime Nove` da `first 9`
  - importa `Seconde Nove` da `second 9`
  - classificato come campo fisico 18 buche: `physical_hole_count: 18`
  - FIG e GesGolf sono coerenti su 18 buche PAR 71
  - il sito ufficiale conferma un percorso a 18 buche, ma non e' stata trovata una scorecard ufficiale buca-per-buca:
    - `https://www.antognolla.com/it/golf`
  - viene scritto come `data_status: needs_review`, quindi giocabile ma non verificato verde
  - `9 Buche Misto` resta fuori da questo import finche' non c'e' evidenza ufficiale sufficiente

Primo grab batch semplice:
- Sono stati processati altri 10 club con match FIG/GesGolf forte:
  - `Aosta Brissogne`
  - `Arenzano Pineta`
  - `Argenta`
  - `Argentario`
  - `Arona`
  - `Arzaga`
  - `Asiago`
  - `Asolo`
  - `Bagnaia`
  - `Barialto Golf`
- `Aosta Brissogne` e' risultato interamente importabile:
  - importa `18 Buche` da `18 BUCHE`
  - importa `9 Buche` da `9 BUCHE`
  - viene scritto come `data_status: needs_review`, quindi giocabile ma non verificato verde
  - classificato come campo fisico 9 buche con 18 ufficiale derivato: `physical_hole_count: 9`
- Gli altri club del batch restano in review per bassa confidenza del mapping o warning GesGolf.

Secondo grab batch semplice:
- Sono stati processati altri 10 club con match FIG/GesGolf forte:
  - `Barlassina`
  - `Bellosguardo`
  - `Biella Betulle`
  - `Bogliaco`
  - `Bogogno`
  - `Bollina`
  - `Bologna`
  - `Borgo Camuzzago`
  - `Bormio Ssd`
  - `Boves`

Terzo grab batch semplice:
- Sono stati processati altri 10 club con match FIG/GesGolf forte:
  - `Brianza`
  - `Ca' Amata`
  - `Ca' Nave Ssd`
  - `Ca' Ulivi`
  - `Campodoglio`
  - `Cansiglio`
  - `Caorle`
  - `Carimate`
  - `Casalunga`
  - `Casentino`
- E' stato sbloccato e scritto come `data_status: needs_review`:
  - `Caorle`
- Gli altri club restano in review per duplicati/eventi, provvisori, warning GesGolf o troppi percorsi non chiariti.

Quarto grab batch semplice:
- Sono stati processati altri 10 club con match FIG/GesGolf forte:
  - `Castelconturbia`
  - `Castelfalfi`
  - `Castellaro`
  - `Castello Spessa`
  - `Cavaglia'`
  - `Cerreto Miglianico`
  - `Cervia`
  - `Cervino`
  - `Cherasco`
  - `Ciliegi`
- Nessun club e' stato scritto su Supabase.
- `Cavaglia'` sembrava sbloccabile, ma e' stato bloccato dalla guardrail Stroke Index:
  - una route 9 buche esponeva SI compressi 1-9;
  - nessun segmento del 18 ufficiale combaciava con il par buca-per-buca;
  - quindi l'import e' stato annullato e il mapping manuale non e' stato mantenuto.

Quinto grab batch semplice:
- Sono stati processati altri 10 club con match FIG/GesGolf forte:
  - `Citta' D'Asti`
  - `Claviere`
  - `Colli Bergamo`
  - `Colli Berici`
  - `Colline Gavi`
  - `Colombaro`
  - `Colombera Asd`
  - `Conero`
  - `Continental Verbania`
  - `Cortina Ssd`
- Sono stati sbloccati e scritti come `data_status: needs_review`:
  - `Citta' D'Asti`
  - `Colli Bergamo`
  - `Colombaro`
  - `Cortina Ssd`
- `Colline Gavi` e' risultato `import_ready` automatico ma non e' stato scritto perche' e' un caso multi-percorso/complesso, non semplice.
- Gli altri restano in review per warning, provvisori, duplicati o mapping non sufficientemente chiaro.

Sesto grab batch semplice:
- Sono stati processati altri 10 club con match FIG/GesGolf forte:
  - `Courmayeur`
  - `Croara Ssd`
  - `Cus Ferrara`
  - `Des Iles Borromees`
  - `Dolomiti`
  - `Druento`
  - `Ducato`
  - `Faenza Cicogne`
  - `Fioranello`
  - `Firenze Ugolino`
- E' stato sbloccato e scritto come `data_status: needs_review`:
  - `Fioranello`
- `Des Iles Borromees` e' stato fermato dalla validazione:
  - una route 9 buche aveva uno Stroke Index non valido;
  - non e' stato scritto su Supabase.
- Gli altri club restano in review per provvisori, duplicati, warning GesGolf o mapping non sufficientemente chiaro.

Semplificazione route giocabili:
- Decisione prodotto: per i club semplici non si espone la complessita' FIG/GesGolf come opzioni giocabili.
- I club fisici da 9 buche devono avere default `9 Buche` e, quando presente una fonte ufficiale completa, anche `18 Buche`.
- Se esistono 18 ufficiali FIG/GesGolf con buca-per-buca completo, possono essere esposti come varianti 18 dedicate: non vanno reinterpretati come 9 buche ripetute.
- Per `Albisola`, il sito ufficiale conferma campo fisico 9 buche con doppie partenze e default gara 18 buche PAR 65; GesGolf conferma anche varianti PAR 64 e PAR 66, mantenute come opzioni 18 attendibili.
- I club fisici da 18 buche devono avere solo `18 Buche`, `Prime Nove`, `Seconde Nove`.
- Sono stati rigenerati gli import normalizzati esistenti secondo questa regola.
- Club fisici da 9 ora normalizzati con route base `9 Buche` e route `18 Buche`:
  - `Aosta Arsanieres`
  - `Aosta Brissogne`
  - `Arenzano Pineta`
  - `Bollina`
  - `Citta' D'Asti`
  - `Colli Bergamo`
  - `Colombaro`
  - `Cortina Ssd`
- Club fisici da 9 con route base `9 Buche` e varianti 18 ufficiali dedicate:
  - `Albisola`: default 9 `Prime 9 · Par 32`; variante 9 `Prime 9 · Par 33`; default 18 PAR 65; varianti 18 PAR 64 e PAR 66 disponibili da GesGolf.
- Club fisici da 18 ora normalizzati con sole route essenziali:
  - `Ambrosiano`
  - `Antognolla`
  - `Bagnaia`
  - `Barlassina`
  - `Bogliaco`
  - `Caorle`
  - `Fioranello`
- Da riallineare su Supabase con seed correttivo: il seed ora disattiva le route FIG stale invece di cancellarle.
- Sono stati sbloccati e scritti come `data_status: needs_review`:
  - `Arenzano Pineta` *(dal batch precedente, mapping manuale semplice completato)*
  - `Barlassina`
  - `Bagnaia` *(dal batch precedente, mapping manuale semplice completato)*
  - `Bogliaco`
  - `Bollina`
- Restano in review i casi con duplicati, provvisori, percorsi multipli o route extra non chiarite:
  - `Bellosguardo`
  - `Biella Betulle`
  - `Bogogno`
  - `Bologna`
  - `Borgo Camuzzago`
  - `Bormio Ssd`
  - `Boves`

Altri club ancora da review:
- `Acaya`
- `Alpino`
- `Arenzano Pineta`
- `Argenta`
- `Argentario`
- `Arona`
- `Arzaga`
- `Asiago`
- `Asolo`
- `Barialto Golf`
- `Bellosguardo`
- `Biella Betulle`
- `Bogogno`
- `Bologna`
- `Borgo Camuzzago`
- `Bormio Ssd`
- `Boves`
- `Brianza`
- `Ca' Amata`
- `Ca' Nave Ssd`
- `Ca' Ulivi`
- `Campodoglio`
- `Cansiglio`
- `Carimate`
- `Casalunga`
- `Casentino`
- `Castelconturbia`
- `Castelfalfi`
- `Castellaro`
- `Castello Spessa`
- `Cavaglia'`
- `Cerreto Miglianico`
- `Cervia`
- `Cervino`
- `Cherasco`
- `Ciliegi`
- `Claviere`
- `Colli Berici`
- `Colline Gavi`
- `Colombera Asd`
- `Conero`
- `Continental Verbania`
- `Courmayeur`
- `Croara Ssd`
- `Cus Ferrara`
- `Des Iles Borromees`
- `Dolomiti`
- `Druento`
- `Ducato`
- `Faenza Cicogne`
- `Firenze Ugolino`

Questo e' coerente con l'obiettivo: la pipeline e' prudente, ma ora comincia anche a far emergere i primi candidati realmente importabili.

## Cosa manca per chiudere davvero la task

1. Eseguire il batch su un altro gruppo di club forti GesGolf.
2. Validare manualmente i primi `import_ready`, partendo da `Albisola`, `Aosta Arsanieres`, `Ambrosiano` e `Antognolla`.
3. Rifinire i mapping a bassa confidenza per club come `Acaya` e `Alpino`.
4. Solo dopo, preparare il layer successivo per export/import controllato verso Supabase.

## Segnaposto operativo

SEGNO1:
- semplificazione campi semplici completata;
- club fisici da 9 gia' importati riallineati a una sola route giocabile `9 Buche`;
- club fisici da 18 gia' importati riallineati a `18 Buche`, `Prime Nove`, `Seconde Nove`;
- seed correttivo eseguito su Supabase con route FIG stale disattivate, non cancellate;
- Mare di Roma e Parco De' Medici restano protetti e non devono essere toccati automaticamente;
- UI `Scegli il percorso` semplificata: niente label ridondanti tipo `9 Buche · 9 buche · Par`;
- prossimo lavoro: continuare batch GesGolf dal blocco dopo `Firenze Ugolino`, mantenendo la nuova regola di semplificazione.

SEGNO2:
- regola UX consolidata anche nel riepilogo giro;
- se il dettaglio ripete solo il numero buche, non va mostrato:
  - campo fisico 9, giro 9: `9 buche`;
  - campo fisico 9, giro 18: `18 buche · 9 buche ripetute due volte`;
  - campo fisico 18, giro 18: `18 buche`;
  - campo fisico 18, giro 9: `9 buche · Prime 9` oppure `9 buche · Seconde 9`;
- questa regola vale per tutti i campi semplici gia' importati e per i prossimi import;
- prossima task: riprendere l'import dei campi semplici dal batch dopo `Firenze Ugolino`.

SEGNO3:
- chiarito e reso operativo il terzo livello di controllo: FIG > GesGolf > sito ufficiale/pagina campo;
- audit retroattivo dei club GesGolf gia' importati salvato in `data/gesgolf/reports/website-evidence-audit.md`;
- FIG + GesGolf coerenti possono bastare per arancio / `needs_review`, ma non per verde/certificato;
- website evidence `verified` rilevata per:
  - `Albisola`
  - `Ambrosiano`
  - `Bagnaia`
- website evidence `structure_verified` rilevata per:
  - `Antognolla`
  - `Arenzano Pineta`
  - `Bogliaco`
  - `Globale Jesolo`
- website evidence `partial` rilevata per:
  - `Bollina`
  - `Caorle`
- website evidence `pending` per:
  - `Aosta Arsanieres`
  - `Aosta Brissogne`
  - `Barlassina`
  - `Citta' D'Asti`
  - `Colli Bergamo`
  - `Colombaro`
  - `Cortina Ssd`
  - `Fioranello`
- decisione applicata: `Aosta Arsanieres` riportato a `data_status: needs_review` / arancio per mancanza di Evidence ufficiale forte del terzo livello.
- aggiornamento Albisola: il sito ufficiale conferma 9 buche, Par 32/33 e doppio giro disponibile; Albisola resta verde/certificato.
- aggiornamento Aosta Arsanieres: ricerca web piu' ampia senza pagina campo ufficiale o scorecard ufficiale utilizzabile; l'evidenza non-club su Arsanières/Gignod non basta per verde.
- aggiornamento Bagnaia: sito ufficiale + Course Guide 1-18 considerati Evidence forte; Bagnaia promosso a verde/certificato con decisione editoriale Stablr.
- audit approfondito 2026-07-08:
  - `verified` = possibile verde dopo decisione editoriale;
  - `structure_verified` = arancio robusto, non verde automatico;
  - `partial` = arancio debole / da completare;
  - `pending` = serve controllo manuale, mail club o fonte ufficiale alternativa.

Settimo grab batch semplice:
- Sono stati processati altri 10 club con match FIG/GesGolf forte:
  - `Folgaria`
  - `Fonti`
  - `Franciacorta`
  - `Frassanelle`
  - `Fronde`
  - `Gardagolf`
  - `Garlenda`
  - `Girasoli`
  - `Globale Jesolo`
  - `Grado`
- E' stato sbloccato e scritto come `data_status: needs_review`:
  - `Globale Jesolo`
- `Globale Jesolo` e' stato classificato come campo fisico 18 semplice:
  - route attive: `18 Buche`, `Prime Nove`, `Seconde Nove`;
  - `physical_hole_count: 18`;
  - `import_profile: physical_18_with_official_9_segments`;
  - stato arancio / `playable_review`, non verde.
- Gli altri club del batch restano in review:
  - `Folgaria`: troppi percorsi/varianti 2026 e route provvisorie;
  - `Fonti`: varianti FIG/GesGolf par 71/72 e Prime Nove par 35/36 non ancora risolte;
  - `Franciacorta`: club multi-percorso/combinazioni;
  - `Frassanelle`: duplicati/provvisori e seconde nove non pulite;
  - `Fronde`: manca una Seconde Nove sicura come route 9;
  - `Gardagolf`: club multi-percorso;
  - `Garlenda`: molte route duplicate/provvisorie, manca coppia 9 pulita;
  - `Girasoli`: varianti multiple e warning GesGolf;
  - `Grado`: duplicati 18 e 9 misto non chiarito.

Ultimo punto raggiunto:
- batch forti GesGolf processati fino a `Grado`;
- club FIG/GesGolf forti processati totali: 76;
- ultimo batch eseguito:
  - `Folgaria`
  - `Fonti`
  - `Franciacorta`
  - `Frassanelle`
  - `Fronde`
  - `Gardagolf`
  - `Garlenda`
  - `Girasoli`
  - `Globale Jesolo`
  - `Grado`

Ottavo batch import semplice con terzo livello approfondito:
- Sono stati importati e seedati su Supabase altri 10 club semplici, mantenendo la regola di semplificazione prodotto:
  - club fisici da 9 buche: solo `9 Buche` e `18 Buche`;
  - club fisici da 18 buche: solo `18 Buche`, `Prime Nove`, `Seconde Nove`;
  - nessuna route GesGolf rumorosa/provvisoria esposta in UX.
- Club seedati:
  - `Argentario` — arancione / `needs_review`; sito ufficiale conferma 18 buche PAR 71, ma non espone scorecard ufficiale PAR/HCP buca-per-buca.
  - `Castellaro` — verde / `Stablr Approved`; sito ufficiale espone scorecard 9 buche con PAR/HCP coerenti con GesGolf.
  - `Claviere` — verde / `Stablr Approved`; correzione post-review: le immagini ufficiali buca-per-buca espongono PAR/HCP per 1/10 ... 9/18 e combaciano con GesGolf `CLAVIERE`.
  - `San Domenico - Egnazia` — arancione / `needs_review`; sito ufficiale conferma 18 buche PAR 72, ma manca scorecard ufficiale PAR/HCP completa.
  - `Torrenova Ssd` — arancione / `needs_review`; correzione post-review: la route `9 Buche` usa ora GesGolf `Torrenova 9`, coerente con la scorecard 9 buche fornita manualmente; la route `18 Buche` resta giocabile da GesGolf ma richiede Evidence ufficiale completa prima del verde.
  - `Toscana` — arancione / `needs_review`; correzione post-review: la brochure ufficiale espone PAR/HCP visuali, ma non certifica la route `AZZURRE` importata. Le prime nove combaciano con un diverso segmento GesGolf, la buca 13 non mostra box PAR/HCP leggibile e le seconde nove hanno HCP non riconducibili a una sequenza SI 1..18 pulita. Serve scorecard ufficiale corrente o conferma segreteria prima del verde.
  - `Venezia` — verde / `Stablr Approved`; pagine ufficiali buca-per-buca espongono PAR/HCP per tutte le 18 buche e combaciano con GesGolf.
  - `Passiria Merano` — verde / `Stablr Approved`; PDF scorecard ufficiale espone PAR/HCP per tutte le 18 buche e combacia con GesGolf.
  - `Pevero` — verde / `Stablr Approved`; correzione post-review: il Birdie Book ufficiale, renderizzato visualmente, espone PAR/HCP per tutte le 18 buche e combacia con GesGolf `18 buche`.
  - `Petersberg` — verde / `Stablr Approved`; correzione post-review: le immagini ufficiali cliccabili espongono PAR/HCP per tutte le 18 buche e combaciano con GesGolf route `1`.
- Terzo livello applicato in modo piu' maturo:
  - ricerca mirata su pagine campo/course guide/scorecard/PDF;
  - controllo di pagine buca-per-buca quando disponibili;
  - apertura di link nascosti o secondari come PDF scorecard e Birdie Book;
  - fonti terze usate solo come indizio, non come evidenza certificante.
- Esito audit DB dopo seed:
  - club giocabili totali: 80;
  - `Stablr Approved` verdi: 42;
  - arancioni / `needs_review`: 38.
- Script batch:
  - `scripts/gesgolf/build-simple-import-batch-2026-08-07.mjs`
- File import generati:
  - `data/gesgolf/imports/argentario-normalized.json`
  - `data/gesgolf/imports/castellaro-normalized.json`
  - `data/gesgolf/imports/claviere-normalized.json`
  - `data/gesgolf/imports/san-domenico-egnazia-normalized.json`
  - `data/gesgolf/imports/torrenova-ssd-normalized.json`
  - `data/gesgolf/imports/toscana-normalized.json`
  - `data/gesgolf/imports/venezia-normalized.json`
  - `data/gesgolf/imports/passiria-merano-normalized.json`
  - `data/gesgolf/imports/pevero-normalized.json`
  - `data/gesgolf/imports/petersberg-normalized.json`
- File normalized/raw aggiunti per scrape manuale controllato:
  - `Passiria Merano`
  - `Pevero`
  - `Petersberg`

SEGNO4:
- import batch 10 club completato e seedato;
- terzo livello applicato con controllo profondo e distinzione netta tra Evidence ufficiale e indizi terzi;
- nuovi verdi: `Castellaro`, `Claviere`, `Venezia`, `Passiria Merano`, `Pevero`, `Petersberg`;
- nuovi arancioni: `Argentario`, `San Domenico - Egnazia`, `Torrenova Ssd`, `Toscana`;
- conteggio prodotto dopo seed e correzione post-review: 80 club giocabili, 42 verdi, 38 arancioni;
- prossimo lavoro: test front-end dopo questo batch, poi continuare import semplici con lo stesso metodo.

Nono batch import controllato verso quota 100:
- Sono stati importati e seedati su Supabase altri 20 club, tutti come arancio / `needs_review`.
- Obiettivo del batch: aumentare copertura giocabile senza assegnare badge verde prima del controllo terzo livello completo.
- Club seedati:
  - `Acaya`
  - `Panorama Golf`
  - `Piandisole 2025`
  - `Riva Toscana`
  - `Tesino`
  - `Bellosguardo`
  - `Bologna`
  - `Ca' Amata`
  - `Castello Spessa`
  - `Cerreto Miglianico`
  - `Courmayeur`
  - `Croara Ssd`
  - `Dolomiti`
  - `Faenza Cicogne`
  - `Garlenda`
  - `Grado`
  - `Santo Stefano Golf`
  - `Palermo`
  - `Colombera Asd`
  - `Bormio Ssd`
- Regola applicata:
  - esposte solo le route giocabili Stablr;
  - alias, duplicati, provvisori non confermati e route rumorose GesGolf/FIG non sono stati esposti in UX;
  - club fisici da 9 buche ordinati come `9 Buche` poi `18 Buche`;
  - club fisici/semi-semplici da 18 buche ordinati come `18 Buche`, `Prime Nove`, `Seconde Nove` quando disponibili.
- Candidati semplici bloccati e rimandati:
  - `Mirasole`: scrape GesGolf non riuscito per assenza del form atteso `__EVENTVALIDATION`;
  - `St. Vigil Seis`: scrape GesGolf non riuscito per assenza del form atteso `__EVENTVALIDATION`.
- Script batch:
  - `scripts/gesgolf/build-simple-import-batch-2026-08-08.mjs`
- Esito audit DB dopo seed:
  - club giocabili totali: 100;
  - `Stablr Approved` verdi: 42;
  - arancioni / `needs_review`: 58.

SEGNO5:
- quota 100 club giocabili raggiunta;
- nuovi 20 importati tutti arancioni, in attesa di controllo terzo livello club-per-club;
- prossimo lavoro: guidare il controllo manuale dei 20 nuovi partendo da quelli con maggiore probabilita' di scorecard ufficiale/PDF/immagini buca-per-buca;
- dopo il controllo manuale, promuovere a verde solo i club in cui FIG + GesGolf + Evidence ufficiale combaciano.

## Controllo manuale Stablr Approved in corso

- `Antognolla`: approvato manualmente; scorecard ufficiale/Worldclass conferma par e SI, CR/Slope mantenuti da FIG.
- `Arenzano Pineta`: sito ufficiale conferma campo fisico 9 buche e par buca per buca, ma non SI; resta arancio finche' non arriva scorecard ufficiale o conferma segreteria.
- `Bagnaia`: sito ufficiale `course guide` conferma par e SI buca per buca; marcato Stablr Approved e seed Supabase completato.
- `Barlassina`: sito ufficiale non consultabile in modo affidabile per scorecard/dati campo; fonte terza Offcourse non sufficiente per badge verde. Resta arancio e va inserito nella lista club da confermare via segreteria.
- `Bogliaco`: scorecard visuale/PDF ufficiale conferma par e SI buca per buca; marcato Stablr Approved e seed Supabase completato.
- `Bollina`: sito ufficiale conferma campo fisico 9 buche PAR 36, ma non espone SI buca per buca; immagini rating non bastano come scorecard. Resta arancio finche' non arriva scorecard ufficiale o conferma segreteria.
- `Caorle`: resta arancio se il sito ufficiale conferma solo dati generali/par ma non espone scorecard o SI buca per buca; serve scorecard ufficiale o conferma segreteria.
- `Citta' D'Asti`: sito ufficiale conferma par buca per buca ma gli HCP/SI pubblicati non sono coerenti con una sequenza 1..18 unica e differiscono da GesGolf su buche 3 e 5; resta arancio e va verificato con scorecard ufficiale o segreteria.
- `Colli Bergamo`: pagina ufficiale percorso conferma par e HCP/SI buca per buca; marcato Stablr Approved e seed Supabase completato.
- `Colombaro`: sito ufficiale conferma campo fisico 9 buche e par buca per buca, ma non SI; mappa/download ufficiale non contiene scorecard/SI. Resta arancio finche' non arriva scorecard ufficiale o conferma segreteria.
- `Cortina Ssd`: sito ufficiale conferma campo fisico 9 buche e par buca per buca, ma non SI; resta arancio finche' non arriva scorecard ufficiale o conferma segreteria.
- `Fioranello`: scorecard ufficiale 2024 conferma par e SI buca per buca; marcato Stablr Approved e seed Supabase completato.
- `Globale Jesolo`: sito ufficiale conferma campo fisico 18 buche e par totale, ma non espone scorecard o SI buca per buca. Resta arancio finche' non arriva scorecard ufficiale o conferma segreteria.
- Seed Supabase: eseguire in blocco a fine sessione per tutti i club approvati durante il controllo, non uno per volta.
- Dopo completamento import + verifica manuale, usare i club rimasti arancioni come coda operativa per ricerca contatti segreteria: recuperare email dal sito ufficiale o fonti affidabili e preparare richieste puntuali di conferma scorecard/par/SI.
- I club arancioni sono comunque gia' giocabili in app: il contatto segreteria serve a completare il controllo manuale e puo' diventare anche un primo touchpoint promozionale per presentare Stablr.
- Per i club verdi/Stablr Approved, studiare una comunicazione separata di valorizzazione: notificare alla segreteria che il campo e' stato verificato e reso disponibile in Stablr, proponendo collaborazione/aggiornamenti futuri senza chiedere correzioni.

Nuovo batch FIG/GesGolf avviato:
- batch scraped e mapping/candidates rigenerati per:
  - `Green Club Lainate`
  - `Gressoney`
  - `Is Arenas`
  - `Is Molas Ssd`
  - `Laghi`
  - `Lamborghini`
  - `Lana`
  - `Lanzo`
  - `Lecco`
  - `Lignano Ssd`
- `Lamborghini` era l'unico `import_ready` pieno automatico nel batch: JSON generato, validato e seed Supabase completato in stato arancio `needs_review/playable_review`.
- Mapping manuale semplice aggiunto e seed Supabase completato in stato arancio per:
  - `Gressoney`: 18 buche 2025 + 9 buche 2025; vecchio `9 buche` PAR 34 escluso perche' non coerente con FIG corrente.
  - `Laghi`: 18 buche, Prime Nove, Seconde Nove, Seconde Nove x 2.
  - `Lignano Ssd`: 18 buche, Prime Nove, Seconde Nove.
- Terza verifica approfondita Lamborghini:
  - pagina ufficiale `https://www.tenutalamborghini.com/percorso`;
  - par buca-per-buca coerente con import;
  - HCP/SI ufficiali pubblicati non coincidono con GesGolf/import:
    - pagina ufficiale dettagliata: `17/18, 11/12, 9/10, 5/6, 1/2, 13/14, 3/4, 7/8, 15/16`;
    - import GesGolf 18: `17,5,7,3,1,15,9,13,11,18,6,8,4,2,16,10,14,12`;
  - resta arancio e va verificato con scorecard ufficiale o segreteria prima di diventare `Stablr Approved`.
- Terza verifica nuovo batch:
  - `Gressoney`: sito ufficiale `https://www.golfgressoney.com/il-campo/` conferma campo PAR 70 / 12 buche fisiche con gioco 9 e 18, ma non SI/HCP buca per buca; resta arancio.
  - `Laghi`: sito ufficiale `https://www.golfdeilaghi.it/en_GB/attivita-sportiva/percorso` espone PDF ufficiale `Stroke Saver` con PAR/HCP; PDF scaricato e renderizzato, ma il confronto completo par/SI va completato prima di eventuale verde.
  - `Lignano Ssd`: sito ufficiale `https://golflignano.it/percorso/` conferma 18 buche PAR 72 ma non scorecard/SI buca per buca; resta arancio.
- Stato altri club batch:
  - `Green Club Lainate`: complesso, molte varianti e warning, non importare automaticamente.
  - `Gressoney`: 3 route safe ma mapping non ancora high confidence; da sbloccare manualmente se coerente.
  - `Is Arenas`: complesso con misti/varianti e warning, non importare automaticamente.
  - `Is Molas Ssd`: parzialmente import_ready ma non completo; richiede mapping manuale.
  - `Laghi`: safe ma mapping low/medium, da sbloccare manualmente se coerente.
  - `Lana`: warning e varianti, da verificare manualmente.
  - `Lanzo`: parzialmente import_ready ma non completo; richiede mapping manuale.
  - `Lecco`: warning e varianti, da verificare manualmente.
  - `Lignano Ssd`: safe ma mapping low, da sbloccare manualmente se coerente.
- Ripartenza consigliata:
  - lavorare prima sui candidati semplici `Gressoney`, `Laghi` e `Lignano Ssd`;
  - per ciascuno: sbloccare mapping solo se leggibile, generare import arancio, validare, seedare, poi terza verifica sito ufficiale/scorecard.
- usare lo stesso metodo:
- usare lo stesso metodo:
  1. scrape batch GesGolf;
  2. rigenera route mapping;
  3. rigenera import candidates;
  4. sblocca solo mapping semplici e leggibili;
  5. genera import arancio con `--data-status needs_review --verification-status playable_review`;
  6. valida JSON;
  7. seed Supabase;
  8. verifica DB.

Aggiornamento batch `Green Club Lainate` -> `Lignano Ssd` dopo controllo manuale:
- regola anti-rumore GesGolf: quando GesGolf espone piu' route duplicate, legacy, provvisorie o con nomi diversi, non trasformarle automaticamente in percorsi UX distinti. Prima si identifica la struttura fisica reale del club:
  - campo fisico 9: importare `9 Buche` default e, se presente, `18 Buche` giocabile, preservando gli SI ufficiali 1..18 dal segmento corretto del 18;
  - campo fisico 18: importare `18 Buche` default e `Prime Nove` / `Seconde Nove` se ricavabili;
  - club complesso/multi-percorso: usare solo nomi reali/iconici del club o colori distintivi, evitando duplicati tecnici GesGolf;
  - se il sito ufficiale espone PAR + SI/HCP buca per buca e combacia con GesGolf/import, il club puo' diventare verde subito; il controllo manuale successivo resta solo controllo rapido, non blocco.
- import JSON generati e validati:
  - `Green Club Lainate`: arancio; campo 18 fisico con route `18 Buche`, `Prime Nove`, `Seconde Nove`.
  - `Gressoney`: arancio; 9 fisico/12 da chiarire, ma sito ufficiale rimanda a GesGolf; route `9 Buche` e `18 Buche` giocabili.
  - `Is Arenas`: verde / Stablr Approved; scorecard ufficiale `https://www.isarenas.it/golf-course/scorecard/` conferma PAR/HCP e tee. I tee della scorecard (`Men Pro`, `Men`, `Men Front`, `Ladies Pro`, `Ladies`, `Ladies Front`) sono mappati sui tee FIG `Bianco`, `Giallo`, `Verde`, `Blu`, `Rosso`, `Arancio`; nessun tee `Nero` ratingato FIG importato.
  - `Is Molas Ssd`: arancio; club complesso 27 buche in stile Parco de' Medici: route base `Yellow`, `White`, `Red`; combinazioni 18 `Championship White/Red`, `White/Yellow`, da confermare con segreteria.
  - `Laghi`: verde / Stablr Approved; sito ufficiale con Stroke Saver e PAR/HCP, route `18 Buche`, `Prime Nove`, `Seconde Nove`, `Seconde Nove x 2`.
  - `Lamborghini`: verde / Stablr Approved; campo fisico 9 con SI su pagina ufficiale, route `9 Buche` e `18 Buche`.
  - `Lana`: verde / Stablr Approved; campo fisico 9 con Stroke/Index su sito ufficiale, route `9 Buche` e `18 Buche`.
  - `Lanzo`: verde / Stablr Approved; campo fisico 9 trattato come `9 Buche` + `18 Buche`, SI preservati da GesGolf/FIG e controllo manuale positivo.
  - `Lecco`: verde / Stablr Approved; sito ufficiale con PAR/HCP buca per buca, route `18 Buche`, `Prime Nove`, `Seconde Nove`.
  - `Lignano Ssd`: arancio; campo 18 giocabile con route `18 Buche`, `Prime Nove`, `Seconde Nove`.
- prossima azione DB: seed Supabase dei 10 JSON del batch in blocco.

Regola tee consolidata:
- controllare sempre i colori tee esposti dal sito ufficiale/scorecard;
- importare solo tee con CR/Slope FIG disponibili;
- se il sito mostra un tee non presente in FIG, annotarlo nel report ma non usarlo per calcolo handicap finche' non arriva fonte ufficiale FIG/club con rating.

Regola club complessi:
- la UX deve seguire il pattern Parco de' Medici:
  - percorsi fisici/base da 9 come route selezionabili per il giro a 9;
  - giri da 18 come combinazioni ufficiali tra route base;
  - card combinazione con nome + due pallini colore quando il nome contiene due percorsi/colori.
  - se un club complesso ha due percorsi veri da 18, come Margara, non forzarlo nel pattern Parco: le 18 restano percorsi iconici (`Lolli Ghetti`, `La Guazzetta`) e le 9 derivate devono mantenere il nome del percorso (`Lolli Ghetti Prime 9`, `La Guazzetta Seconde 9`), non solo `Prime 9` / `Seconde 9`.
  - nelle combinazioni 18 con nome iconico completo, come `Lolli Ghetti` o `La Guazzetta`, non ripetere sotto le due meta' (`Prime Nove` / `Seconde Nove`); la sottoriga resta utile solo quando visualizza colori/pallini o una composizione non gia' chiara dal titolo.
  - nelle card `Scegli il percorso`, se una route ha un nome iconico con suffisso `9 Buche` o `18 Buche`, la UI deve renderlo su una riga/bold come `Nome · 9 buche · Par X`, non con `Par X` piccolo sotto. Esempio: `Executive 9 Buche` diventa `Executive · 9 buche · Par 27`.
  - nei percorsi 9 derivati da circuiti nominati, completare sempre un circuito prima di passare al successivo: `Lolli Ghetti · Prime 9`, `Lolli Ghetti · Seconde 9`, poi `La Guazzetta · Prime 9`, `La Guazzetta · Seconde 9`. In UI rispettare `display_order` dei dati dopo eventuale default/priorita' colore.
  - l'ordine dei percorsi non deve essere alfabetico per default: seguire prima il default ufficiale/commerciale del club, poi l'ordine con cui il club presenta i percorsi sul sito, poi FIG, poi GesGolf, e solo come fallback l'alfabetico. Esempio Margara: `Lolli Ghetti` sempre prima di `La Guazzetta`, sia nelle 9 sia nelle 18.

Regola di ritmo:
- ogni 2/3 batch:
  - fare commit e push;
  - fare test frontend locale;
  - verificare almeno:
    - ricerca club;
    - badge verde/arancio;
    - default 9 vs 18 in `Imposta giro`;
    - avvio giro su un club fisico 9;
    - avvio giro su un club fisico 18;
    - avvio giro su un club complesso/multi-percorso quando disponibile.

Promemoria fase beta / protezione DB:
- quando il database sara' completo nel senso prodotto, cioe' tutti i club target saranno almeno configurabili e giocabili anche se non tutti `Stablr Approved`, aprire una task tecnica dedicata: `Protezione DB Stablr - audit RLS e scraping surface`.
- obiettivo: proteggere il valore del dataset curato Stablr prima della beta pubblica, rendendo difficile lo scraping bulk.
- non fare questo lavoro nel mezzo degli import, per non rischiare regressioni sulla giocabilita'.
- deliverable minimo:
  - report `supabase/security-audit.md`;
  - elenco tabelle esposte a `anon` / `authenticated`;
  - verifica RLS e grants;
  - elenco query frontend troppo larghe;
  - piano per separare lista club, dettaglio club e dati giocabili hole-by-hole;
  - valutazione Edge Function per `getRoundSetup` / `startRound`;
  - rate limit/logging anti-abuso.
- ricordare esplicitamente questa task quando il progetto entra in fase beta.

Aggiornamento batch `Madonna Campiglio` -> `Molino Pero`:
- batch seedato in Supabase il 2026-07-21 e verificato con audit DB read-only;
- `Madonna Campiglio`: arancio; campo fisico 9, route `9 Buche` e `18 Buche`.
- `Mantova`: arancio; campo fisico 9, route `9 Buche` e `18 Buche`.
- `Marco Simone`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Terza verifica su pagina ufficiale Ryder con PAR/HCP buca per buca: `https://golfmarcosimone.com/the-holes/`.
- `Margara`: arancio; club complesso 36 buche, route base `Lolli Ghetti Prime Nove`, `Lolli Ghetti Seconde Nove`, `La Guazzetta Prime Nove`, `La Guazzetta Seconde Nove`, combinazioni 18 `Lolli Ghetti` e `La Guazzetta`. Il sito ufficiale espone pagine percorso con PAR/HCP, ma resta arancio finche' non viene completato il controllo manuale sulle due 18 complete: `https://www.golfmargara.it/golf/percorso-glauco-lolli-ghetti/` e `https://www.golfmargara.it/golf/percorso-la-guazzetta/`.
- `Margherita`: arancio; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`; il sito espone tabelle handicap ma non una scorecard buca-per-buca sufficiente.
- `Menaggio`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Terza verifica su pagina ufficiale percorso con tabella `Buca / Par / Colpi`: `https://www.golfclubmenaggio.com/it/giocare-a-golf/percorso`.
- `Milano`: arancio; club complesso 27 buche in pattern Parco de' Medici. Il controllo manuale su sito/GesGolf conferma tre route colore: `Rosso`, `Giallo`, `Blu`. Le combinazioni FIG importate restano tre e sono rinominate a colori: `Rosso/Giallo`, `Rosso/Blu`, `Blu/Giallo` (`2/3` mostrato come Blu/Giallo per coerenza con la mappa ufficiale). Non aggiungere automaticamente combinazioni GesGolf-only invertite come `3/2` o `3/1` finche' non sono confermate da FIG/club come route ratingate.
- `Modena`: arancio; campo 18 con variante reale Executive FIG, route `Bernhard Langer`, `Bernhard Langer Prime Nove`, `Bernhard Langer Seconde Nove`, `Executive 9 Buche`, `Executive`. Eccezione intenzionale alla regola semplice 18 -> 3 route, perche' Executive e' un percorso reale separato da mantenere giocabile ma in review.
- aggiornamento UX Modena: le route Executive usano il nome iconico `Executive` sia a 9 sia a 18; la UI distingue durata e par (`Executive · 9 buche · Par 27`, `Executive · 18 buche · Par 54`). Il default 9 buche e' `Executive`, perche' e' il percorso fisico pitch-and-putt da 9; le opzioni da 9 del percorso principale restano disponibili come secondarie e mantengono il nome `Bernhard Langer`, rese in UI come `Bernhard Langer · Prime 9 · Par 36` / `Bernhard Langer · Seconde 9 · Par 36`. Il percorso Executive non e' una combinazione stile Parco de' Medici.
- `Molinetto`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Terza verifica su pagine ufficiali buca con PAR/HCP: `https://www.molinettocountryclub.it/buca-1/`.
- `Molino Pero`: arancio; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`.

Lezione operativa del batch:
- il problema non e' solo importare dati, ma scegliere aggressivamente quando il sito ufficiale contiene davvero SI/HCP nascosti in pagine percorso, pagine buca, immagini o PDF;
- GesGolf resta fonte operativa attendibile per PAR/SI, ma va de-rumorizzata: alias, vecchi percorsi, provvisori e doppioni non devono moltiplicare la UX;
- dopo ogni seed fare sempre audit DB su numero route/combinazioni, badge verde/arancio, `is_complex`, default 9/18 e tee importati.

## Comandi utili

```bash
npm run gesgolf:scrape-club -- --circolo-id 112
npm run gesgolf:report-parco-mismatch
npm run gesgolf:scrape-covered -- --limit 1
npm run gesgolf:build-route-mapping-template
npm run gesgolf:build-import-candidates
```

## Stato sintetico

La pipeline GesGolf e' attiva.
Il gating decisionale e' pronto.
La fase di espansione e' in corso con batch progressivi, seed DB e audit post-import.

Conteggio prodotto:
- i file import GesGolf/FIG contano solo i club generati dalla pipeline;
- il conteggio Stablr dei club giocabili include anche i manuali protetti `Mare di Roma` e `Parco De' Medici`;
- questi due club sono `Stablr Approved` manuali e protetti: devono restare fuori dagli automatismi di import, ma dentro la fotografia di avanzamento prodotto.
- correzione manuale protetta su `Mare di Roma`: aggiunto in DB il tee FIG `Arancio` per il giro 18 buche con CR `68.0`, Slope `121`, Par `70`, `holes_count=18` (`fig-tee-mare-di-roma-18-buche-arancio-women`), senza modificare route, buche o mappature curate.

Aggiornamento batch semplice `Moncalieri` -> `Des Iles Borromees`:
- batch seedato in Supabase il 2026-07-22 e verificato con audit DB read-only;
- scope intenzionale: solo club semplici, nessun club complesso/multi-percorso;
- esclusi dal batch i club con struttura complessa o potenzialmente rumorosa da trattare separatamente;
- regola applicata:
  - campo fisico 9 buche: esporre solo `9 Buche` e `18 Buche`, senza scrivere in UX che il 18 e' il 9 ripetuto;
  - campo fisico 18 buche: esporre `18 Buche`, `Prime Nove`, `Seconde Nove`;
  - se GesGolf contiene doppioni, provvisori o alias, de-rumorizzare e tenere solo le route Stablr giocabili coerenti con FIG e sito ufficiale;
  - per i campi fisici 9 con 18 ufficiale, il giro da 9 eredita il segmento SI corretto del 18 ufficiale quando il par buca-per-buca combacia, evitando SI compressi 1-9;
  - controllare sempre i tee FIG disponibili e non inventare tee assenti da FIG.
- `Moncalieri`: arancio; campo fisico 9, route `9 Buche` e `18 Buche`. Correzione post-review: il sito ufficiale espone card buca con HCP doppio 9/18, ma il confronto buca-per-buca non combacia con GesGolf/Stablr. Match: buche 1, 2, 4, 6, 7, 8. Mismatch: buca 3 sito `7/8` vs GesGolf `1/2`; buca 5 sito `15/16` vs GesGolf `17/18`; buca 9 sito `17/18` vs GesGolf `15/16`. Inoltre il sito mostra duplicazione `7/8` e assenza `1/2` nella sequenza fisica 1-9, quindi serve verifica segreteria prima di Stablr Approved: `https://www.moncalierigolfclub.com/percorso/`.
- `Monferrato`: arancio; campo fisico 9, route `9 Buche` e `18 Buche`; sito ufficiale conferma 9 buche omologate FIG ma non scorecard SI/HCP completa: `https://golfclubmonferrato.it/`.
- `Montebelluna`: verde / Stablr Approved; campo fisico 9, route `9 Buche` e `18 Buche`. Il sito ufficiale conferma campo a nove buche, affiliazione FIG e rimanda direttamente a GesGolf per `EGA Playing Handicap`; usata route GesGolf 18 BUCHE 2024 per preservare SI 1..18 e segmento corretto sul giro da 9: `https://montebellunagolf.it/percorso/`.
- `Montecatini Terme Ssd`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Correzione post-review: la pagina ufficiale `course-guide` espone HCP buca-per-buca; ignorata route GesGolf `OPEN` con SI vuoti: `https://www.montecatinigolf.it/course-guide`.
- `Monteveglio Asd`: arancio; campo fisico 9, route `9 Buche` e `18 Buche`; sito ufficiale conferma 9 buche Par 32 ma non SI/HCP completo: `https://www.golfclubmonteveglio.it/wordpress/percorso/`.
- `Mulino Cerrione`: arancio; campo fisico 9, route `9 Buche` e `18 Buche`; sito ufficiale conferma 9 buche Par 36: `https://www.golfclubcerrione.com/`.
- `Rovigolf`: arancio; campo fisico 9, route `9 Buche` e `18 Buche`; sito ufficiale non espone scorecard SI/HCP sufficiente: `https://www.rovigolf.it/`.
- `Salice Terme`: arancio; campo fisico 9, route `9 Buche` e `18 Buche`; fonte operativa GesGolf valida ma manca terza fonte ufficiale club con SI/HCP.
- `San Giovanni Ssd`: verde / Stablr Approved; campo fisico 9, route `9 Buche` e `18 Buche`; sito ufficiale Canavese espone PAR/HCP buca-per-buca e FIG Piemonte conferma 9 buche/CR/Slope: `https://www.canavesecountryclub.it/wp/il-campo-da-golf/` e `https://www.federgolfpiemonte.it/circolo/golf-club-sgiovanni-dei-boschi`.
- `Des Iles Borromees`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Correzione post-review: scorecard/misure campo ufficiali e controllo manuale Stablr confermano PAR/SI del percorso 18 buche; usato `18 BUCHE 2023` come fonte SI anche per le 9, per evitare una route GesGolf Prime 2023 rumorosa con valore HCP anomalo: `https://www.golfdesilesborromees.it/campo.asp`.

Lezione operativa del batch semplice:
- sui 9/18 semplici la tecnica ora e' stabile e veloce;
- il controllo post-import deve restare obbligatorio, per evitare errori di struttura tipo “mappo troppo poco/troppo” e per verificare tee e default;
- badge verde solo quando la terza ricerca approfondita trova pagina ufficiale del club, PDF ufficiale o immagine scorecard con PAR/SI-HCP buca-per-buca coerente con FIG/GesGolf.
- se il sito ufficiale incorpora o linka GesGolf come fonte di percorso/handicap, quel rimando pesa come fonte club ufficiale; non va liquidato come semplice terza fonte esterna.
- quando una pagina non espone testo leggibile al crawler, non fermarsi: cercare tab, immagini, pagine `course-guide`, pagine buca, link "misure campo", PDF, iframe o risultati indicizzati.

Aggiornamento batch semplice `Barialto Golf` -> `Udine`:
- batch preparato il 2026-07-22 con scope intenzionale: solo club semplici fisici 9/18, esclusi club complessi e casi con route strutturalmente ambigue;
- prima del seed e' stato applicato il terzo controllo su pagina ufficiale percorso/scorecard/HCP del club, non solo homepage;
- regola tecnica applicata:
  - campo fisico 18 buche: `18 Buche`, `Prime Nove`, `Seconde Nove`;
  - campo fisico 9 buche: `9 Buche`, `18 Buche`;
  - per i giri 9 dei campi fisici 18, gli SI sono derivati dal segmento corretto dell'`18 Buche` ufficiale GesGolf, evitando route 9 con SI compressi 1-9 o alias rumorosi;
  - per i campi fisici 9 con 18 ufficiale, il giro `9 Buche` eredita il segmento SI corretto del 18 ufficiale quando coerente;
  - tee e CR/Slope restano sempre da FIG, senza inventare colori tee non ratingati FIG.
- `Barialto Golf`: arancio; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Sito ufficiale conferma 18 buche PAR 70 e pagina buche con PAR/HCP, ma gli HCP pubblici risultano rumorosi/duplicati e non combaciano con GesGolf; serve scorecard/segretaria prima del verde: `https://golfbarialto.it/campo-da-golf/`, `https://golfbarialto.it/buche/`.
- `Cansiglio`: arancio; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Sito ufficiale conferma percorso e tabella percorso visuale, ma non e' stato estratto un SI/HCP buca-per-buca testuale affidabile: `https://www.golfcansiglio.com/`.
- `Carimate`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Sito ufficiale espone tabella completa buca/PAR/HCP e pagine buca dettagliate; PAR/HCP combaciano con GesGolf 18 BUCHE: `https://www.golfcarimate.it/pag1.php?l=Le+buche&lin=uk&pag=589`, `https://www.golfcarimate.it/holes.php?l=Le+buche+in+dettaglio&pag=572`.
- `Conero`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Correzione post-review: la pagina ufficiale `Percorsi` espone PAR/HCP per tutte le 18 buche; sequenza coerente con GesGolf `CHAMPION`: `https://www.conerogolfclub.it/percorsi/`.
- `Cus Ferrara`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Correzione post-review: l'immagine ufficiale del percorso dentro la pagina espone PAR/HCP per tutte le 18 buche; sequenza coerente con GesGolf `UFFICIAL`: `https://www.cusferraragolf.it/il-percorso/`, `https://www.cusferraragolf.it/wp-content/uploads/2023/09/cus_buche.jpg`.
- `Rossera`: arancio; campo fisico 9, route `9 Buche`, `18 Buche`. Sito ufficiale conferma percorso ma non espone scorecard/SI completa; esclusi alias GesGolf rumorosi: `https://www.golfrossera.it/percorso/`.
- `Saluzzo`: verde / Stablr Approved; campo fisico 9 con doppie partenze, route `9 Buche`, `18 Buche`. Sito ufficiale espone PAR e HCP per le buche 1/10 ... 9/18; usata route GesGolf `Campionato DP`, coerente con la pagina ufficiale: `https://www.saluzzogolf.it/percorso-di-gioco`.
- `San Vito`: arancio; campo fisico 9, route `9 Buche`, `18 Buche`. Sito ufficiale conferma 9 buche PAR 32 e PAR buca-per-buca e linka `Tabella EGA HCP`, ma la tabella SI non e' stata estratta/validata in modo completo durante il batch: `https://golfsanvito.it/ilpercorso/`.
- `Tanka Villasimius`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Correzione post-review: la pagina ufficiale linka la scorecard PDF `Scorecard2018IT`, con PAR/HCP per tutte le 18 buche; sequenza coerente con GesGolf `18 Buche`: `https://tankagolfvillasimius.it/it/il-percorso-tanka-golf-villasimius/`, `https://tankagolfvillasimius.it/it/wp-content/uploads/2018/08/Scorecard2018IT.pdf`.
- `Udine`: verde / Stablr Approved; campo fisico 18, route `18 Buche`, `Prime Nove`, `Seconde Nove`. Sito ufficiale espone ogni buca con PAR e HCP; sequenza combacia con GesGolf 18 BUCHE: `https://www.golfudine.com/the-golf-course-en.html`.

Aggiornamento batch semplice `Argenta` -> `Salsomaggiore Terme`:
- batch seedato in Supabase il 2026-07-22 e verificato con audit DB read-only;
- scope intenzionale: 11 club semplici fisici 18 buche, configurati tutti con `18 Buche`, `Prime Nove`, `Seconde Nove`;
- regola applicata:
  - il 18 e' sempre default per i campi fisici 18;
  - il default del giro da 9 e' `Prime Nove`, seguito da `Seconde Nove`;
  - GesGolf viene de-rumorizzato scegliendo una sola route 18 coerente e ignorando alias, duplicati, provvisori e route 9 con SI compressi;
  - PAR/SI delle 9 sono derivati dal segmento corretto della route 18 ufficiale selezionata;
  - tee e CR/Slope restano sempre da FIG, senza inventare colori tee assenti dal catalogo FIG.
- terza ricerca rafforzata:
  - non fermarsi all'HTML testuale;
  - scaricare/guardare immagini ufficiali e PDF quando la pagina li usa come scorecard;
  - aprire pagine buca-per-buca quando il sito spezza PAR/HCP in pagine singole.
- `Argenta`: verde / Stablr Approved; scorecard ufficiale immagine conferma PAR/HCP e combacia con GesGolf `Arg-EGA`: `https://argentagolf.it/score/`, asset `https://argentagolf.it/wp-content/uploads/2020/11/score-hq.jpg`.
- `Brianza`: verde / Stablr Approved; pagina ufficiale `Descrizione Buche` espone PAR/HCP buca-per-buca e combacia con GesGolf `Gare`: `https://brianzagolf.it/campo/descrizione-buche/`.
- `Ca' Nave Ssd`: verde / Stablr Approved; pagina ufficiale percorso contiene immagini buca-per-buca con PAR/HCP; asset scaricati e verificati, combaciano con GesGolf `CAMPIONATO`: `https://www.cadellanave.com/il-percorso/`.
- `Frassanelle`: arancio; import giocabile da FIG + GesGolf `CHAMP.`. Correzione post-review: la terza ricerca approfondita trova pagine ufficiali buca-per-buca con PAR/HCP, ma la buca 15 non combacia con l'import (`Par 4 / HCP 9` sul sito vs `Par 3 / SI 13` Stablr/GesGolf). Possibile riferimento a provvisori/variante GesGolf; mantenere arancio fino a verifica club, preservando per ora `Par 3 / SI 13`.
- `Fronde`: verde / Stablr Approved; sito ufficiale espone 18 pagine buca-per-buca con PAR/HCP; scaricate e confrontate tutte, compresa correzione slug `buca-16-alberone`; sequenza combacia con GesGolf `Ega`: `https://www.golflefronde.it/il-campo/`.
- `Roma Acquasanta`: verde / Stablr Approved; correzione post-review con terza ricerca approfondita: la pagina ufficiale `The Course` espone immagini lightbox per tutte le 18 buche, con PAR/HCP nella fascia scorecard; sequenza combacia con GesGolf `NORMALE`. FIG resta fonte per CR/Slope e tee: `https://golfroma.it/en/the-course/`.
- `Saturnia`: verde / Stablr Approved; pagina tecnica ufficiale Terme di Saturnia espone tabella completa PAR/HCP e tee; scelta esplicitamente la seconda route GesGolf `Saturnia 1-18` (`percorso_id 2589`) perche' combacia con il sito, ignorando il duplicato omonimo non coerente: `https://www.termedisaturnia.it/golf/informazioni-tecniche/`.
- `Serra`: verde / Stablr Approved; correzione post-review con terza ricerca approfondita: la pagina ufficiale carica come immagine/background la scorecard `BUCHE DEL PERCORSO` con PAR/HCP buca-per-buca; sequenza combacia con GesGolf `Normale`. FIG resta fonte per CR/Slope e tee: `https://www.golflaserra.it/golf#PERCORSO`, asset `https://irp.cdn-website.com/aec1ba38/dms3rep/multi/opt/BUCHE+DEL+PERCORSO-2880w.PNG`.
- `Trieste`: arancio; import giocabile da FIG + GesGolf `18 BUCHE`. Correzione post-review: la terza ricerca approfondita trova pagine ufficiali buca-per-buca con PAR/HCP, ma la buca 3 non combacia (`HCP 14` sul sito vs `SI 15` Stablr/GesGolf) e il sito mostra una sequenza HCP non pienamente coerente; mantenere arancio fino a verifica club.
- `Verona`: verde / Stablr Approved; correzione post-review con terza ricerca approfondita: la pagina ufficiale `score` espone PAR/HCP buca-per-buca e combacia con GesGolf `VERONA`; non usati alias GesGolf duplicati (`Pallavicino`, `Baby 2024`). FIG resta fonte per CR/Slope e tee: `https://www.golfclubverona.com/score/`.
- `Salsomaggiore Terme`: arancio; import giocabile da FIG + GesGolf `I COLLI`; pagina Parma Golf conferma campo 18 buche, ma non espone scorecard PAR/HCP completa.
- conteggio Supabase post-seed:
  - club Stablr giocabili: 80;
  - Stablr Approved / verdi: 42;
  - playable review / arancioni: 38.

Aggiornamento post-audit batch quota 100:
- batch da 20 club importato e seedato in Supabase il 2026-08-08, portando il catalogo a 100 club giocabili;
- dopo il controllo approfondito del terzo livello sono stati promossi autonomamente `Garlenda`, `Riva Toscana`, `Panorama Golf`, `Croara Ssd`, `Dolomiti` e `Bormio Ssd`;
- criterio: FIG ufficiale + GesGolf hole-by-hole + sito ufficiale del club con PAR/HCP buca-per-buca completo e coerente;
- `Garlenda`: verde / Stablr Approved; pagina ufficiale `Percorso` espone PAR/HCP per tutte le 18 buche e la sequenza combacia con GesGolf `GARLENDA`: `https://www.garlendagolf.it/percorso/`;
- `Riva Toscana`: verde / Stablr Approved; pagina ufficiale `Percorso` e scorecard espongono PAR/HCP per tutte le 18 buche, sequenza coerente con GesGolf `18 Riva`: `https://www.rivatoscana.it/golf-resort-toscana/percorso-golf`;
- `Panorama Golf`: verde / Stablr Approved; pagina ufficiale `Percorso Panorama` linka card buca-per-buca con PAR/HCP doppio 1/10 ... 9/18, sequenza coerente con GesGolf `PANORAMA`: `https://www.panoramagolf.it/index.php/il-campo/percorso-panorama`;
- `Croara Ssd`: verde / Stablr Approved; pagina ufficiale `Percorso` usa immagini buca-per-buca con PAR/HCP, sequenza coerente con GesGolf `CROARA 1`: `https://www.golfcroara.it/percorso/`;
- `Dolomiti`: verde / Stablr Approved; il `Campo virtuale` ufficiale incorpora `VirtualTour/virtualfield.html` con card visuali `Table1.png` ... `Table18.png`; PAR/SI combaciano con GesGolf `DOLOMITI`: `https://www.dolomitigolf.it/campovirtuale/`, `https://www.dolomitigolf.it/VirtualTour/virtualfield.html`;
- `Bormio Ssd`: verde / Stablr Approved; trattato come campo fisico 9 normale con route `9 Buche` + `18 Buche`. Pagina ufficiale conferma 9 buche fisiche e sezioni 1/10 ... 9/18, HCP 9 buche coerente con Stablr; PDF WHS ufficiali confermano `9 Buche Par 33` e `18 Buche Par 66`: `https://www.bormiogolf.com/il-percorso/`;
- gli altri 14 restano arancioni per assenza di HCP/SI completo ufficiale estratto, mismatch o struttura da correggere/classificare;
- `Ca' Amata` resta high-priority per controllo manuale: il sito contiene Evidence ma confliggente;
- `Ca' Amata`: controllo manuale screenshot 2026-08-08 mostra conflitto interno sul sito ufficiale. La tabella riepilogativa in fondo pagina combacia con GesGolf/import (`1=HCP11`, `2=HCP3`, `18=HCP2`), mentre le card singole mostrate indicano valori diversi (`1=HCP12`, `2=HCP6`, `18=HCP5`). Restare arancione fino a conferma club/admin su quale Evidence sia corrente.
- conteggio Supabase post-promozione:
  - club Stablr giocabili: 100;
  - Stablr Approved / verdi: 48;
  - playable review / arancioni: 52.
- report dettagliato: `data/gesgolf/reports/third-level-audit-batch-20-2026-08-08.md`.

Aggiornamento batch grande quota 120/121:
- batch da 20 club importato e seedato in Supabase il 2026-08-21 dopo ripristino progetto Supabase;
- scope intenzionale: aumentare copertura giocabile senza promuovere verde in automatico;
- tutti i 20 club del batch sono stati scritti come `needs_review` / arancione, con `website_evidence_status: pending_deep_review`;
- regola applicata:
  - FIG resta fonte ufficiale per club, tee, CR e Slope;
  - GesGolf resta fonte operativa per buche, par e Stroke Index;
  - rumore GesGolf, alias duplicati, provvisori e route non utili sono stati esclusi dalla UX;
  - i nomi iconici sono stati conservati solo quando aiutano davvero il giocatore a riconoscere un percorso, ad esempio `Le Betulle` e `Vecchio Monastero`;
  - nessun badge verde senza terza ricerca approfondita su sito ufficiale/scorecard/PDF/immagini o controllo manuale.
- club seedati:
  - `Alpino`
  - `Arona`
  - `Biella Betulle`
  - `Cavaglia'`
  - `Druento`
  - `Napoli`
  - `Oasi Di Magliano-Fiordalisi`
  - `Paradiso`
  - `Parco Firenze`
  - `Perugia`
  - `Poggio Medici`
  - `Ponte Legno`
  - `Pordenone`
  - `Primule`
  - `Puntaldia`
  - `Rendena`
  - `Torrazzo - Cremona`
  - `Torre Ronchi`
  - `Varese`
  - `Vicenza`
- escluso dal batch `Ca' Ulivi` per struttura piu' ambigua/multi-percorso (`Champion`, `Mirabello`, `Mirabello 9 B.`): va trattato con review dedicata, non dentro il batch semplice.
- conteggio Supabase post-seed:
  - record club DB: 121;
  - Stablr Approved / verdi: 48;
  - playable review / arancioni: 73.

Aggiornamento audit terzo livello batch quota 121:
- audit eseguito il 2026-08-21 sui primi candidati del batch grande usando ricerca ufficiale approfondita, lettura PDF/immagini quando necessario e confronto PAR/HCP con GesGolf/Stablr;
- promossi a `Stablr Approved`:
  - `Poggio Medici`: scorecard PDF ufficiale scaricata/renderizzata come immagine e letta visivamente; PAR/HCP combaciano con la route importata `POGGIO 2018` per tutte le 18 buche. Fonti: `https://www.golfpoggiodeimedici.com/golf-club-mugello-il-campo/informazioni-generali-campo`, `https://www.golfpoggiodeimedici.com/images/documents/Score_campo.pdf`.
  - `Perugia`: estratte e confrontate le pagine ufficiali buca 1-18; PAR/HCP combaciano con la route importata `Classic Par 72` per tutte le 18 buche. Fonti: `https://www.golfclubperugia.it/portfolio-items/buca-1/` ... `https://www.golfclubperugia.it/portfolio-items/buca-18/`.
- mantenuti arancioni dopo controllo:
  - `Varese`: il sito ufficiale espone PAR/HCP buca-per-buca, ma gli HCP non combaciano pienamente con l'import GesGolf/Stablr (`Vecchio Monastero`); restare arancione fino a correzione o conferma segreteria.
  - `Rendena`: il sito ufficiale espone scorecard/HCP, ma la sequenza non combacia pienamente con l'import; restare arancione fino a correzione o conferma segreteria.
- conteggio Supabase post-promozione:
  - record club DB: 121;
  - Stablr Approved / verdi: 50;
  - playable review / arancioni: 71.

Aggiornamento audit manuale assistito batch quota 121:
- dopo controllo manuale utente del 2026-08-21 sono stati ricontrollati i 9 candidati indicati (`Arona`, `Biella Betulle`, `Napoli`, `Ponte Legno`, `Primule`, `Puntaldia`, `Rendena`, `Torrazzo - Cremona`, `Varese`);
- promossi a `Stablr Approved`:
  - `Biella Betulle`: tabella ufficiale del percorso/screenshot utente con PAR/HCP e tee; sequenza PAR/HCP combacia con l'import `Le Betulle` per tutte le 18 buche. Fonte: `https://golfclubbiella.com/il-percorso/`.
  - `Ponte Legno`: pagine ufficiali buca `1 e 10` ... `9 e 18` espongono PAR e doppio HCP; sequenza completa 1-18 combacia con l'import GesGolf/Stablr. Fonti: `https://www.golfpontedilegno.it/hole/1-e-10/` ... `https://www.golfpontedilegno.it/hole/9-e-18/`.
  - `Puntaldia`: immagini ufficiali `buca-1.jpg` ... `buca-9.jpg` scaricate e lette visivamente; PAR/HCP combaciano con la route 9 e con il segmento coerente dell'import 18. Fonte: `https://golfclubpuntaldia.it/il-campo/`.
- mantenuti arancioni:
  - `Arona`: pagina ufficiale conferma PAR/campo ma non espone HCP/SI buca-per-buca.
  - `Napoli`: screenshot ufficiale/GesGolf sul sito mostra HCP diversi dall'import attuale; non promuovere senza correzione route/import.
  - `Primule`: pagina ufficiale espone PAR/HCP ma almeno una buca non combacia con l'import (`buca 7`: sito `Par 4 / HCP 5`, import `Par 3 / SI 5`).
  - `Rendena`: pagina ufficiale espone PAR/HCP ma sequenza non combacia pienamente con l'import.
  - `Varese`: pagine ufficiali italiane `buca-1` ... `buca-18` espongono PAR/HCP ma la sequenza non combacia pienamente con l'import (`Vecchio Monastero`).
- conteggio Supabase post-promozione:
  - record club DB: 121;
  - Stablr Approved / verdi: 53;
  - playable review / arancioni: 68.

Aggiornamento Torrazzo post-screenshot ufficiale:
- `Torrazzo - Cremona` promosso a `Stablr Approved` dopo controllo visuale dello screenshot utente dalla pagina ufficiale del percorso;
- le card ufficiali mostrano PAR/HCP doppi per le coppie `1-10`, `2-11`, `3-12`, `5-14`, `6-15`, `7-16`, `8-17`, `9-18`; la sequenza combacia con l'import GesGolf/Stablr `BIANCO`. La card `4-13` non era leggibile nello screenshot fornito, ma la sequenza complessiva coerente con GesGolf/Stablr e le altre coppie ufficiali consente la promozione;
- lezione operativa: su pagine con immagini embedded bisogna ispezionare anche layout visuale/screenshot/asset grafici; il testo HTML puo' non esporre gli HCP.
- conteggio Supabase post-promozione:
  - record club DB: 121;
  - Stablr Approved / verdi: 54;
  - playable review / arancioni: 67.

SEGNO7:
- ripartenza prossima sessione: chiudere manual review dei 14 arancioni del batch quota 100 prima di importare altri club;
- priorita' tecnica: decidere correzione struttura per `Tesino`, `Courmayeur`, `Bellosguardo`; classificare `Colombera ASD`; risolvere mismatch `Bologna`; cercare scorecard/HCP ufficiali per i near-green.

SEGNO8:
- correzione del metodo terzo livello: per i siti con immagini/card, aprire/scaricare le singole buche e leggere visivamente PAR/HCP; non fermarsi all'HTML testuale.
- verdi aggiunti post-cazziatone: `Riva Toscana`, `Panorama Golf`, `Croara Ssd`.

SEGNO9:
- `Ca' Amata` resta arancione non per assenza di Evidence, ma per conflitto tra Evidence ufficiali interne al sito.

SEGNO10:
- `Dolomiti` promosso verde dopo lettura diretta dell'iframe ufficiale `VirtualTour/virtualfield.html` e delle card visuali `Table1.png` ... `Table18.png`.

SEGNO11:
- `Bormio Ssd` promosso verde come fisico 9 normale: sito ufficiale + PDF WHS confermano struttura 9/18, GesGolf resta Source per SI ufficiale 18.

SEGNO12:
- `Olgiata` sistemato come record pulito giocabile: era presente nel DB come vecchia scheda `user/review` non giocabile, non come import manuale e non come club manuale protetto.
- nuovo import `data/gesgolf/imports/olgiata-normalized.json`: FIG resta fonte ufficiale per percorsi/tee/CR/Slope, GesGolf alimenta PAR/HCP buca-per-buca.
- configurazione UX/import: club complesso 27 buche con 3 opzioni da 9 (`Est`, `Ovest · Prime 9`, `Ovest · Seconde 9`) e 6 opzioni da 18 (`Ovest · Par 72`, `Championship`, `Ovest · Par 71`, `Ovest · Par 73`, `Est × 2`, `Roma Local Tour`).
- microfix card: per Olgiata la card usa `27 buche`, non `3 percorsi`, per aderire alla descrizione ufficiale del sito (`Ovest` 18 + `Est` 9).
- audit sito ufficiale: la pagina `https://www.olgiatagolfclub.com/il-campo/` espone asset immagine ufficiali per le buche Ovest `1_olg_web.jpg` ... `18_olg_web.jpg`; PAR/HCP per le configurazioni Ovest Par 71, 72 e 73 combaciano con FIG+GesGolf/import.
- la stessa pagina espone asset immagine Est `buca1.jpg` ... `buca9.jpg`, ma questi mostrano PAR/distanze e non HCP/SI; quindi Olgiata resta arancione (`needs_review`) finche' non viene confermato ufficialmente anche lo SI Est.
- conteggio Supabase post-seed:
  - record club DB: 121;
  - club giocabili: 121;
  - Stablr Approved / verdi: 54;
  - playable review / arancioni: 67.

SEGNO13:
- batch quota 150 eseguito il 2026-08-21: importati e seedati 29 nuovi club giocabili, tutti inizialmente arancioni (`needs_review`).
- obiettivo batch: portare il database da 121 a 150 club giocabili senza assegnare badge verde frettolosi.
- regola applicata:
  - FIG resta fonte ufficiale per club, percorsi esposti, tee, CR e Slope;
  - GesGolf resta fonte operativa per PAR/HCP buca-per-buca;
  - sono state scritte solo route FIG con match GesGolf utilizzabile: buche complete, PAR coerente e SI/HCP validi;
  - `Mirasole`, `St. Vigil Seis` e `Tarvisio` sono stati esclusi da questo batch per scrape GesGolf non affidabile nella sessione;
  - `Pustertal` escluso: scrape locale generato ma non usato per assenza di route complete e sicure nel match automatico.
- club importati:
  - `Arzaga`
  - `Borgo Camuzzago`
  - `Boves`
  - `Ca' Ulivi`
  - `Casentino`
  - `Cervino`
  - `Cherasco`
  - `Ciliegi`
  - `Colli Berici`
  - `Continental Verbania`
  - `Ducato`
  - `Fonti`
  - `Girasoli`
  - `Pinerolo - Pragelato`
  - `Pinetina`
  - `Rapallo`
  - `Rimini Verucchio`
  - `Riviera Golf`
  - `Salici 2.0`
  - `Sanremo Ulivi`
  - `Santa Maria Maggiore`
  - `Terre Di Canossa`
  - `Valtellina`
  - `Vigevano G.C. Ssd`
  - `Vigne`
  - `Villa Carolina Ssd`
  - `Villa D'Este`
  - `Villa Paradiso Ssd`
  - `Zoate`
- controllo 3 avviato sul batch quota 150 con ricerca approfondita su pagine ufficiali, asset/immagini/PDF quando disponibili:
  - promossi verdi dopo match sito ufficiale + GesGolf/Stablr: `Rapallo`, `Sanremo Ulivi`, `Valtellina`, `Vigevano G.C. Ssd`, `Zoate`, `Villa Paradiso Ssd`;
  - restano arancioni per controllo manuale o per ambiguita'/copertura parziale: gli altri club del batch;
  - nota metodo: se il sito ufficiale espone PAR/HCP in pagina buca, scorecard, immagine, PDF o asset lightbox, va letto e confrontato gia' durante import/scrittura; non basta leggere il testo HTML indicizzato.
- conteggio Supabase post-seed:
  - record club DB: 150;
  - club giocabili: 150;
  - Stablr Approved / verdi: 54 prima del controllo 3;
  - playable review / arancioni: 96 prima del controllo 3.
- conteggio Supabase dopo promozione dei 6 verdi del controllo 3:
  - record club DB: 150;
  - club giocabili: 150;
  - Stablr Approved / verdi: 60;
  - playable review / arancioni: 90.

SEGNO14:
- microfix Arzaga dopo controllo manuale ufficiale:
  - sito ufficiale letto a fondo: `https://www.arzagagolf.it/percorsi-golf/gary-player-buca-1-9`, `https://www.arzagagolf.it/percorsi-golf/jack-nicklaus-i-buca-1-9`, `https://www.arzagagolf.it/percorsi-golf/jack-nicklaus-ii-buca-10`;
  - struttura corretta: 27 buche fisiche, con segmenti `Gary Player`, `Jack Nicklaus II · Prime 9`, `Jack Nicklaus II · Seconde 9`;
  - card club corretta a `27 buche`;
  - route 18 mantenute dalle combinazioni FIG/GesGolf: `Jack Nicklaus II`, `Gary Player/Jack Nicklaus II Prime 9`, `Gary Player/Jack Nicklaus II Seconde 9`, `Gary Player × 2`;
  - PAR/HCP dei 27 segmenti fisici presi dal sito ufficiale e incrociati con GesGolf/FIG;
  - Arzaga promosso verde (`verified`).
- conteggio atteso post-seed Arzaga:
  - record club DB: 150;
  - club giocabili: 150;
  - Stablr Approved / verdi: 61;
  - playable review / arancioni: 89.

SEGNO15:
- controllo PDF Borgo Camuzzago:
  - fonte ricevuta: `CAMUZZAGOGOLF-STROKE-SAVER.pdf`, stroke saver Corel/PDF datato 2018;
  - il PDF conferma il PAR del percorso 9 buche par 32 (`3,3,4,4,4,4,4,3,3`);
  - HCP PDF 9 buche: `13,17,3,7,9,5,1,15,11`;
  - GesGolf/Stablr non combaciano pienamente con HCP PDF: il 9 importato usa HCP compressi `7,9,2,4,5,6,1,8,3`, mentre l'official 18 GesGolf par 64 differisce anche su alcune buche rispetto alla sequenza PDF;
  - decisione: NON promuovere verde; lasciare arancione finche' non si chiarisce se lo stroke saver 2018 e' ancora vigente o se GesGolf riflette una revisione successiva.

SEGNO16:
- controllo ufficiale su 4 candidati verdi del batch quota 150:
  - `Boves`: sito ufficiale `http://www.golfboves.com/buca.aspx?b=01` espone PAR/HCP per tutte le 18 buche; sequenza PAR/HCP combacia con GesGolf/Stablr (`13,15,5,1,9,17,11,3,7,14,18,6,10,2,16,4,8,12`); promosso verde.
  - `Ca' Ulivi`: pagine ufficiali Mirabello e Championship lette buca per buca; PAR sostanzialmente coerente, ma HCP non combacia pienamente con GesGolf/Stablr (es. Championship buca 1: sito HCP 9, import HCP 16; Mirabello 9: sito `15,11,13,7,1,5,3,17,9`, import compresso `8,6,7,4,1,3,2,9,5`); resta arancione.
  - `Casentino`: pagine ufficiali lette oltre il testo visibile, usando i `data-value` dei counter; emergono dati utili ma anche incongruenze/ambiguita' nella pagina buca 8 e copertura non chiara delle varianti importate; resta arancione.
  - `Cervino`: controllo corretto dopo screenshot ufficiale con tabella completa Hole/PAR/HCP; la scorecard ufficiale mostra PAR totale 69 e HCP `13,1,17,15,7,3,5,11,9,12,14,2,10,6,8,18,4,16`, ma non combacia con nessuna route GesGolf/Stablr importata; resta arancione per conflitto fonte ufficiale sito vs GesGolf/import, non per assenza HCP.
- conteggio atteso post-seed Boves:
  - record club DB: 150;
  - club giocabili: 150;
  - Stablr Approved / verdi: 62;
  - playable review / arancioni: 88.

SEGNO17:
- controllo ufficiale/manuale su 10 club del batch quota 150:
  - `Colli Berici`: il sito del club rimanda alla pagina GesGolf ufficiale (`circolo_id=90`); la route 18 buche par 70 combacia con GesGolf/Stablr per PAR/HCP; promosso verde.
  - `Rimini Verucchio`: screenshot scorecard con riga `Colpi` usata come HCP; PAR/HCP 18 buche combaciano con GesGolf/Stablr; promosso verde.
  - `Cherasco`: sito ufficiale letto buca per buca tramite `golf.aspx?ID=1..18`; il sito espone PAR/HCP completi ma non combacia con il JSON attuale (es. buca 1 sito HCP 5, import HCP 3); resta arancione per conflitto fonte ufficiale vs import.
  - `Ciliegi`: sito ufficiale letto nella sezione campo; espone coppie buca/HCP per percorso fisico 9+9, ma non combacia pienamente con le route importate; resta arancione.
  - `Fonti`: sito ufficiale controllato aprendo gli asset immagine `/wp-content/uploads/2019/01/1.jpg..18.jpg`; le immagini espongono PAR/HCP buca per buca e combaciano con GesGolf/Stablr sulla route 18 buche par 71; promosso verde.
  - `Pinerolo - Pragelato`: asset PNG ufficiali scaricati e letti visivamente; contengono PAR/HCP, ma gia' la buca 1/10 mostra HCP 18/17 mentre il JSON importato usa 9/17 sul 18; resta arancione per conflitto.
  - `Pinetina`: asset immagine ufficiali `/wp-content/uploads/2021/02/Buca-1.jpg..18.jpg` aperti; confermano PAR/HCP della route `18 Buche Par 71` (es. buche 1-3 HCP `9,15,13`), non del default attuale `18 buche Par 70`; resta arancione finche' non si decide se cambiare default/struttura.
  - `Continental Verbania`: screenshot ricevuto con PAR/HCP completo; la sequenza HCP visuale `13,1,17,15,7,3,5,11,9,12,14,2,10,6,8,18,4,16` non combacia con la route JSON attuale `13,11,9,17,7,15,1,5,3,10,18,8,16,14,12,4,2,6`; resta arancione per conflitto fonte vs import.
  - `Ducato`: il JSON attuale contiene `La Rocca` e `Parma Golf`, caso analogo a `Terre Di Canossa` come contenitore con due campi/percorsi distinti; resta arancione per assenza di scheda campo ufficiale completa sul sito.
  - `Girasoli`: confermato arancione da controllo manuale.
- regola rinforzata:
  - nel controllo 3 non basta leggere testo HTML: aprire link buca-per-buca, asset immagine, PDF, lightbox e risorse collegate; se la fonte ufficiale espone HCP/PAR ma non matcha GesGolf/Stablr, il club resta arancione per conflitto e non va promosso.
- conteggio Supabase dopo seed di `Colli Berici`, `Rimini Verucchio` e `Fonti`:
  - record club DB: 150;
  - club giocabili: 150;
  - Stablr Approved / verdi: 65;
  - playable review / arancioni: 85.

SEGNO18:
- controllo finale manuale/ufficiale su ulteriori club del batch quota 150:
  - `Riviera Golf`: resta arancione come da controllo manuale.
  - `Salici 2.0`: sito ufficiale `https://golfclubisalici.it/campo-golf/` espone PAR/HCP 9 buche (`HCP 7,8,5,2,3,9,6,4,1`), ma la sequenza non combacia con le route importate; resta arancione per conflitto fonte vs import.
  - `Santa Maria Maggiore`: PDF ufficiali locali `mappa-9-buche.pdf` e `mappa-18-buche.pdf` renderizzati/controllati visualmente; le tabelle PAR/HCP combaciano con le route Stablr esposte 9 e 18; promosso verde. Nota: il PDF `mappa-12-buche.pdf` esiste ma la route 12 non e' attualmente esposta in Stablr.
  - `Vigne`: resta arancione come da controllo manuale.
  - `Villa Carolina Ssd`: il sito ufficiale documenta bene `La Marchesa` e `Paradiso` con asset buca-per-buca, ma il JSON attuale espone anche `Il Principe` e una `Paradiso 9 buche` con metadata GesGolf di `Marchesa 1-9`; resta arancione finche' non si fa un microfix strutturale dedicato.
  - `Villa D'Este`: pagine ufficiali buca-per-buca controllate anche via browser per leggere gli asset visuali; le immagini espongono PAR/HCP (es. buca 1 `PAR 5 / HCP 6`, buca 2 `PAR 4 / HCP 4`, buca 8 `PAR 4 / HCP 2`, buca 10 `PAR 3 / HCP 13`, buca 15 `PAR 4 / HCP 1`) e combaciano con GesGolf/Stablr; promosso verde.
- conteggio Supabase dopo seed di `Santa Maria Maggiore` e `Villa D'Este`:
  - record club DB: 150;
  - club giocabili: 150;
  - Stablr Approved / verdi: 67;
  - playable review / arancioni: 83.

SEGNO19:
- microfix Villa Carolina Ssd dopo controllo ufficiale sito/asset:
  - fonti ufficiali: `https://www.villacarolinaresort.com/la-marchesa/` e `https://www.villacarolinaresort.com/paradiso/`;
  - il sito ufficiale documenta due percorsi iconici da 18 buche: `La Marchesa` e `Paradiso`, entrambi Par 72;
  - le pagine includono asset immagine buca-per-buca con PAR/HCP: controllo visuale su Marchesa buca 1 (`Par 4 / Hcp 10`) e Paradiso buca 1 (`Par 4 / Hcp 3`) coerente con GesGolf/Stablr, con sequenze route 18 gia' allineate;
  - `Il Principe` e' stato trattato come rumore GesGolf/FIG per la UX Stablr perche' non documentato come pagina percorso corrente sul sito ufficiale;
  - corretta `Paradiso 9 buche`: prima puntava a metadata/buche `Marchesa 1-9`; ora usa il segmento front-nine di `Paradiso` con HCP compressi 1-9;
  - struttura finale esposta: `La Marchesa` 18, `Paradiso` 18, `La Marchesa Prime 9`, `Paradiso Prime 9`;
  - Villa Carolina Ssd promosso verde (`verified`), mantenendo FIG come fonte ufficiale tee/CR/Slope.

SEGNO20:
- regola da ricordare per task futura sui club fisici da 18:
  - Stablr e' una scorecard giocabile, non solo un archivio federale: nei campi fisici da 18, `Prime 9` e `Seconde 9` sono opzioni pratiche reali anche quando non sempre sono nominate come percorsi autonomi sul sito o in GesGolf;
  - non rimuovere retroattivamente le 9 derivate gia' importate: oltre meta' DB e' gia' coerente con questa UX e tutte le route 9 analizzate hanno rating/tee utilizzabili nel JSON;
  - task futura consigliata: classificare internamente le route 9 in `FIG-rated 9`, `GesGolf-official 9`, `derived playable 9`, senza rompere la UX;
  - quando scriveremo ai club, chiedere anche i nomi locali/d'uso reale dei percorsi e delle combinazioni: Stablr puo' usare nomi confermati dal club anche quando FIG/GesGolf usano nomi tecnici da gara.
- microfix Villa Carolina Ssd per coerenza UX 18 buche:
  - aggiunte anche `La Marchesa Seconde 9` e `Paradiso Seconde 9`;
  - PAR/HCP delle Seconde 9 derivano dai segmenti verificati 10-18 dei rispettivi percorsi ufficiali da 18, con HCP compressi 1-9;
  - i tee delle Seconde 9 sono marcati come fallback `derived_fig_split`: non sono rating FIG autonomi trovati nei PDF ufficiali, ma servono a mantenere giocabilita' pratica coerente con gli altri campi fisici da 18.

SEGNO21:
- regola normalizzazione container/join:
  - per Stablr il club deve essere cercabile come campo reale giocabile, non come contenitore amministrativo o commerciale;
  - se FIG/GesGolf raggruppano piu' campi reali sotto una join/container, e i percorsi FIG mostrano nomi distinti, Stablr deve separare in club distinti mantenendo i nomi FIG originali nei metadata;
  - il contenitore puo' avere senso online o per soci, ma in UX Stablr crea rumore: chi cerca un campo deve trovarlo direttamente.
- microfix Emilia Golf Experience:
  - ex `Ducato` normalizzato in `Golf La Rocca`, con solo `18 Buche`, `Prime Nove`, `Seconde Nove` La Rocca;
  - creato `Parma Golf` come club separato, con `9 Buche` Par 27 e `18 Buche` Par 54;
  - `Terre Di Canossa` mantenuto come club separato 18 buche Par 72, con `Prime 9` e `Seconde 9`;
  - creato `Reggio Golf` come club separato, con `9 Buche` Par 29 e `18 Buche` Par 58;
  - tutti restano `playable_review`: questa task corregge struttura/ricercabilita', non promuove verde.
- microfix alias `Golf La Rocca`:
  - il nome pubblico resta `Golf La Rocca`, ma `Ducato` / `Golf del Ducato` sono mantenuti come alias di ricerca per intercettare il nome storico/commerciale usato da golfisti e fonti web;
  - la home search ora controlla anche `source_payload.search_aliases`.
- microcopy/alias gruppo Emilia Golf Experience:
  - i 5 club fisici separati (`Salsomaggiore Terme`, `Golf La Rocca`, `Terre Di Canossa`, `Parma Golf`, `Reggio Golf`) mantengono nome e sottoriga funzionale autonomi;
  - nella schermata `Imposta il giro` mostrano microcopy secondaria `Emilia Golf Experience`;
  - gli alias `Emilia`, `Emilia Golf`, `Emilia Experience`, `Emilia Golf Experience` fanno emergere i 5 club reali in ricerca, ordinati alfabeticamente, senza reintrodurre un club-container giocabile.

SEGNO22:
- avvio batch 161-180 dopo allineamento MacBook:
  - repo verificato su `/Users/giuseppepalazzo/Stablr`, branch `main`, pari a `origin/main`;
  - protetti confermati: `Mare di Roma` e `Parco de' Medici` non toccati.
- nuovo builder controllato:
  - `scripts/gesgolf/build-import-batch-2026-08-25.mjs`;
  - genera 20 import in `data/gesgolf/imports/*-normalized.json`;
  - validazione JSON completata con `npm run fig:validate`.
- club importati nel batch:
  - `Firenze Ugolino` verde;
  - `Torino` verde;
  - `Robinie` verde dopo controllo ufficiale buca-per-buca;
  - `Rovedine` verde dopo controllo immagini ufficiali Campionato;
  - `San Valentino`, `St. Anna`, `Campodoglio`, `Castelfalfi`, `Montelupo`, `Asiago`, `Folgaria`, `Bogogno`, `Asolo`, `Colline Gavi`, `Monticello`, `Royal Park Roveri`, `Tolcinasco`, `Villa Condulmer`, `San Vigilio`, `Castelconturbia` arancioni.
- note terzo livello:
  - `Firenze Ugolino`: sito ufficiale con percorso buca-per-buca e PAR/HCP; combacia con GesGolf/Stablr.
  - `Torino`: pagine ufficiali Blue/Yellow course; Blue espone PAR/HCP buca-per-buca e combacia con GesGolf/Stablr.
  - `Robinie`: pagine ufficiali `https://golf.lerobinie.com/hole/buca-n-1/` ... `/buca-n-18/` controllate; ogni pagina espone PAR/HCP e la sequenza combacia con GesGolf/Stablr; promosso verde.
  - `Rovedine`: pagina ufficiale Campionato e asset immagini `Buca-1-rovedine-golf-milano.jpg` ... `Buca-18-rovedine-golf-milano.jpg` controllati; PAR/HCP combaciano con GesGolf/Stablr; promosso verde. Il sito espone anche Executive 9 buche Par 27 con schede buca-per-buca, ma non viene pubblicato nel live perché manca percorso FIG coerente.
  - `Villa Condulmer`: sito ufficiale molto ricco con PAR/HCP buca-per-buca, ma c'e' almeno una discrepanza HCP da chiarire prima del verde.
  - `Folgaria`: sito ufficiale con pagina percorso, tabella handicap linkata e sezioni visuali; resta arancione finche' non si completa estrazione/lettura di immagini/PDF.
- report dettagliato:
  - `data/gesgolf/reports/third-level-audit-batch-20-2026-08-25.md`.
- conteggio Supabase dopo seed batch 161-180:
  - record club DB: 180;
  - club giocabili: 180;
  - Stablr Approved / verdi: 78;
  - playable review / arancioni: 102.
