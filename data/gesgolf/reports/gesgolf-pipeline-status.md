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
- Prima di convalidare un nuovo campo per il DB live, usare un controllo a tre livelli:
  1. FIG come catalogo ufficiale per club, percorsi, Course Rating e Slope.
  2. GesGolf come fonte strutturata per buche, par e Stroke Index.
  3. Sito ufficiale del club, quando disponibile, per confermare descrizione campo e/o scorecard prima della scrittura controllata su Supabase.
- Se il sito ufficiale non e' disponibile o non espone dati sufficienti, il club resta da review manuale.
- Regola default giro:
  - club fisico 9 buche con 18 ufficiale derivato, ad esempio Albisola/Aosta/Mare di Roma: default 9 buche;
  - club fisico 18 buche con Prime Nove/Seconde Nove, ad esempio Ambrosiano/Antognolla/Fioranello: default 18 buche;
  - club complesso o con piu' percorsi/combinazioni ufficiali da 9 buche, ad esempio Parco De' Medici: default 18 buche.
- Regola badge:
  - `Stablr Approved` verde si usa solo per campi controllati manualmente e marcati con `source_payload.stablr_approved: true`;
  - in UI il badge e' solo icona verde, senza scritta; evitare label tipo `Verificato` o `Approved` sulla card, perche' appesantiscono e confondono stato tecnico e controllo manuale;
  - tassonomia badge card club: `Approved`, `Review`, `Community`;
  - al momento sono approvati manualmente solo `Albisola` e `Ambrosiano`;
  - `verified` senza approvazione manuale non deve mostrare il badge verde.
- Regola di semplificazione prodotto:
  - i club semplici fisici da 9 buche devono partire di default a 9 buche e, salvo eccezioni, avere una route `9 Buche` e una route `18 Buche`;
  - se GesGolf/FIG espongono varianti 9 ufficiali coerenti e utili, possono essere mantenute come varianti 9 dedicate; per Albisola la nomenclatura e' `Prime 9 · Par 32` default e `Prime 9 · Par 33` variante;
  - se FIG/GesGolf espongono varianti ufficiali 18 buche per un club fisico da 9, queste possono diventare opzioni giocabili 18 buche dedicate, non una ripetizione automatica della route 9;
  - quando il sito ufficiale conferma una variante 18, quella variante diventa default; le altre varianti FIG/GesGolf restano disponibili quando coerenti, perche' GesGolf e' considerata una fonte operativa piu' che attendibile per par e Stroke Index;
  - se esiste un 18 strutturato, non mostrare in UX la composizione libera del giro; la scelta manuale resta solo fallback tecnico per club senza opzioni 18 ufficiali;
  - per club fisici da 18 buche con `Prime Nove` e `Seconde Nove`, il default resta `18 Buche`; se l'utente sceglie 9 buche, default `Prime Nove`, con `Seconde Nove` come seconda scelta;
  - i club semplici fisici da 18 buche devono esporre solo `18 Buche`, `Prime Nove` e `Seconde Nove`;
  - i club complessi multi-percorso restano esclusi da questa semplificazione e saranno trattati con workflow dedicato.
- Regola naming:
  - per club semplici usare nomi funzionali e non proprietari: `9 Buche`, `18 Buche`, `Prime Nove`, `Seconde Nove`;
  - usare nomi GesGolf/FIG specifici solo se sono davvero iconici e distintivi per distinguere percorsi diversi, soprattutto nei club complessi o multi-percorso;
  - esempi da evitare nei club semplici: `Ambro 1`, `Campionato`, `Normale`, se non indicano una scelta realmente distinta per il giocatore;
  - in card club mostrare `9 buche · Par X`, `18 buche · Par X`, oppure `N percorsi` per club complessi con piu' percorsi reali.
  - le varianti giocabili di un club semplice, ad esempio le 5 varianti di `Albisola`, non devono mai essere contate come `N percorsi` nella card club: la card descrive il campo fisico, non il numero di opzioni nel setup giro.
  - nelle card percorso del setup giro non duplicare buche/par se il nome li contiene gia': `Prime 9 · Par 32`, non `Prime 9 · Par 32 · 9 buche · Par 32`.

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
- `import_ready`: 84
- `needs_review`: 302
- `protected_reference`: 11
- `excluded_reference`: 8

Club gia' interamente `import_ready`:
- `Albisola`
- `Aosta Arsanieres`
- `Ambrosiano`
- `Antognolla` *(giocabile in revisione / arancio, non verde)*
- `Aosta Brissogne` *(giocabile in revisione / arancio, non verde)*
- `Arenzano Pineta` *(giocabile in revisione / arancio, non verde)*
- `Bagnaia` *(giocabile in revisione / arancio, non verde)*
- `Barlassina` *(giocabile in revisione / arancio, non verde)*
- `Bogliaco` *(giocabile in revisione / arancio, non verde)*
- `Bollina` *(giocabile in revisione / arancio, non verde)*
- `Caorle` *(giocabile in revisione / arancio, non verde)*
- `Citta' D'Asti` *(giocabile in revisione / arancio, non verde)*
- `Colli Bergamo` *(giocabile in revisione / arancio, non verde)*
- `Colombaro` *(giocabile in revisione / arancio, non verde)*
- `Cortina Ssd` *(giocabile in revisione / arancio, non verde)*
- `Fioranello` *(giocabile in revisione / arancio, non verde)*
- `Globale Jesolo` *(giocabile in revisione / arancio, non verde)*

Secondo caso validato:
- `Aosta Arsanieres`
  - importa `18 Buche` da `Aosta 18 buche`
  - importa `9 Buche` da `9 buche`
  - esclude `OLD C.` come alias 18 duplicato
  - esclude `PR NOVE` per anomalia GesGolf: 18 dichiarate con seconda meta' vuota/azzerata
  - conferma la regola Stroke Index per club fisico 9 + 18 ufficiale: il 9 buche eredita il segmento del 18 ufficiale, non i compressi 1-9

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
- ultimo club scritto su Supabase: `Globale Jesolo`;
- ultimi club sbloccati e scritti come arancio / `needs_review`:
  - `Globale Jesolo`

Ripartenza prossima sessione:
- continuare con il prossimo blocco di 10 club fortemente matchati FIG/GesGolf dopo `Grado`;
- prossimo batch previsto:
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
- usare lo stesso metodo:
  1. scrape batch GesGolf;
  2. rigenera route mapping;
  3. rigenera import candidates;
  4. sblocca solo mapping semplici e leggibili;
  5. genera import arancio con `--data-status needs_review --verification-status playable_review`;
  6. valida JSON;
  7. seed Supabase;
  8. verifica DB.

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

## Comandi utili

```bash
npm run gesgolf:scrape-club -- --circolo-id 112
npm run gesgolf:report-parco-mismatch
npm run gesgolf:scrape-covered -- --limit 1
npm run gesgolf:build-route-mapping-template
npm run gesgolf:build-import-candidates
```

## Stato sintetico

La pipeline GesGolf e' pronta.
Il gating decisionale e' pronto.
Manca la fase di espansione su piu' club e il primo set di mapping realmente validati.
