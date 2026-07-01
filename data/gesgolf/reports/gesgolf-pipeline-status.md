# GesGolf Pipeline Status

## Obiettivo

Usare GesGolf come fonte secondaria strutturata per buche, par e Stroke Index, mantenendo FIG come catalogo ufficiale master per club, percorsi, Course Rating e Slope.

## Vincoli confermati

- Non aggiornare automaticamente il DB live.
- Non toccare i club protetti:
  - Mare di Roma
  - Parco De' Medici
- Parco De' Medici resta benchmark di confronto, non fonte da sovrascrivere.
- Prima di convalidare un nuovo campo per il DB live, usare un controllo a tre livelli:
  1. FIG come catalogo ufficiale per club, percorsi, Course Rating e Slope.
  2. GesGolf come fonte strutturata per buche, par e Stroke Index.
  3. Sito ufficiale del club, quando disponibile, per confermare descrizione campo e/o scorecard prima della scrittura controllata su Supabase.
- Se il sito ufficiale non e' disponibile o non espone dati sufficienti, il club resta da review manuale.

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
- route totali valutate: 32
- `import_ready`: 13
- `needs_review`: 6
- `protected_reference`: 11
- `excluded_reference`: 2

Club gia' interamente `import_ready`:
- `Albisola`
- `Aosta Arsanieres`
- `Ambrosiano`
- `Antognolla` *(giocabile in revisione / arancio, non verde)*

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
  - il sito ufficiale conferma un percorso 18 buche PAR 72 e una scorecard buca-per-buca coerente con GesGolf:
    - `https://golfclubambrosiano.com/percorso/`
    - `https://golfclubambrosiano.com/wp-content/uploads/2023/11/Scorecard.pdf`
  - anche i 9 buche ereditano i segmenti corretti del 18 ufficiale, non SI compressi 1-9

Quarto caso importabile con cautela:
- `Antognolla`
  - importa `18 buche` da `Championship`
  - importa `Prime Nove` da `first 9`
  - importa `Seconde Nove` da `second 9`
  - FIG e GesGolf sono coerenti su 18 buche PAR 71
  - il sito ufficiale conferma un percorso a 18 buche, ma non e' stata trovata una scorecard ufficiale buca-per-buca:
    - `https://www.antognolla.com/it/golf`
  - viene scritto come `data_status: needs_review`, quindi giocabile ma non verificato verde
  - `9 Buche Misto` resta fuori da questo import finche' non c'e' evidenza ufficiale sufficiente

Altri club ancora da review:
- `Acaya`
- `Alpino`

Questo e' coerente con l'obiettivo: la pipeline e' prudente, ma ora comincia anche a far emergere i primi candidati realmente importabili.

## Cosa manca per chiudere davvero la task

1. Eseguire il batch su un altro gruppo di club forti GesGolf.
2. Validare manualmente i primi `import_ready`, partendo da `Albisola`, `Aosta Arsanieres`, `Ambrosiano` e `Antognolla`.
3. Rifinire i mapping a bassa confidenza per club come `Acaya` e `Alpino`.
4. Solo dopo, preparare il layer successivo per export/import controllato verso Supabase.

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
