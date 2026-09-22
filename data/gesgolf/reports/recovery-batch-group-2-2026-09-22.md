# Recovery batch finale — gruppo 2/3 — 2026-09-22

## Scope e regola editoriale

Recovery mirato di `San Donato`, `San Michele`, `Sappada`, `Sicilia'S Picciolo` e `Stupinigi`.

- FIG determina identita', playable course, tee e rating.
- Le route sono pubblicate solo quando PAR, SI/HCP e routing sono completi senza dati inventati.
- GesGolf non e' requisito per `playable_unverified`.
- Route FIG legacy, alternative o non corroborate restano catalogate ma non vengono esposte e non bloccano le configurazioni affidabili.
- Il verde richiede una decisione editoriale motivata sull'intera matrice pubblicata, non il semplice conteggio delle fonti.

## Decisioni finali

| Club | Route FIG considerate | Route pubblicate | Route non pubblicate | Stato | Decisione |
| --- | --- | --- | --- | --- | --- |
| San Donato | 18/68 2015; 18/70 e 9/35 2024; Prime 9/35; Seconde 9/33; `prime 9 due volte`/70 | 18/68, Prime Nove/35, Seconde Nove/33 | 18/70 2024, 9/35 2024, `prime 9 due volte`/70 | `playable_unverified` | **ORANGE** |
| San Michele | 9/35, 18/70 | 9/35 | 18/70 | `playable_unverified` | **ORANGE** |
| Sappada | 9/31, 18/62 | 9/31, 18/62 | nessuna | `playable_unverified` | **ORANGE** |
| Sicilia'S Picciolo | 18/72, Prime Nove/36, Seconde Nove/36 | tutte e tre | nessuna | `certified` | **GREEN** |
| Stupinigi | 9/30, 9/31, 9/32, 18/60, 18/62, 18/64 | 9/31, 18/62 | 9/30, 9/32, 18/60, 18/64 | `playable_unverified` | **ORANGE** |

## San Donato

### Matrice pubblicata

- PAR 18: `4,4,4,4,4,3,4,4,4,4,3,3,4,5,3,4,3,4` = `35+33=68`.
- SI 18: `1,9,7,5,13,3,15,11,17,4,18,10,8,6,16,12,14,2`.
- Prime Nove e Seconde Nove sono segmenti deterministici della stessa route 18.

### Evidence e conflitti

- FIG: famiglia `18 buche 2015` Par 68, `Prime Nove` Par 35 e `Seconde Nove` Par 33, con rating e tee.
- Hole19 espone la matrice PAR/SI completa usata dal payload.
- All Square espone la stessa matrice SI ma una matrice PAR che totalizza 69: viene usata solo come conferma indipendente degli SI, non del PAR.
- GolfHandicapp collega la configurazione `2015b.11 par3` a Par 68 e ai rating FIG, ma espone SI pari a zero e quindi non utilizzabili.
- Il sito ufficiale conferma attivita' e gare correnti ma non una scorecard completa.
- Una fonte recente descrive inoltre un 18/68 come 34+34: non viene fusa con la famiglia 35+33.

La famiglia 2015 e' giocabile, ma il disallineamento temporale e la divergenza fra fonti impediscono il verde. Le route FIG 2024 restano non pubblicate perche' manca la loro matrice specifica.

Fonti:

- `https://www.sandonatogolf.it/`
- `https://www.hole19golf.com/courses/san-donato-golf-resort-spa`
- `https://www.allsquaregolf.com/golf-courses/italy/golf-club-san-donato`
- `https://www.golfhandicapp.com/courses/san-donato`

## San Michele

### Matrice pubblicata

- PAR 9: `4,3,5,4,3,4,4,4,4` = 35.
- HCP del primo giro leggibili sulle nove grafiche ufficiali: `4,17,1,9,15,13,7,11,3`.

### Evidence e conflitti

- Il sito ufficiale corrente conferma nove buche fisiche, Par 70 su 18 e doppie partenze.
- Le nove grafiche ufficiali confermano tutti i PAR e tutti gli HCP necessari alla route 9.
- All Square e FlyAway confermano il PAR fisico 35 ma non pubblicano HCP utilizzabili.
- Le grafiche delle buche fisiche 3 e 9 riportano soltanto `HCP 1` e `HCP 3`; non espongono i corrispondenti valori del secondo giro.
- I valori mancanti `2` e `5` non sono stati dedotti per esclusione.
- Il materiale storico del Grand Hotel San Michele presenta una diversa allocazione HCP e non viene mescolato con le grafiche correnti.

La route FIG 9/35 e' completa e giocabile arancione. La 18/70 resta non pubblicata finche' non viene trovata una scorecard corrente con tutti i diciotto HCP.

Fonti:

- `https://www.sanmichele.golf/`
- grafiche ufficiali `https://www.sanmichele.golf/wp-content/uploads/2024/01/Buche-400x600-1.jpg` ... `-9.jpg`
- `https://www.allsquaregolf.com/golf-courses/italy/golf-club-san-michele`
- `https://flyawaygolf.com/golfs/golf-club-san-michele`

## Sappada

### Matrici pubblicate

- PAR 9: `3,4,3,3,4,4,3,4,3` = 31.
- SI 9: `9,3,8,2,5,6,1,4,7`.
- La 18/62 usa la trasformazione Stablr standard: primo giro `2×SI−1`, secondo giro `2×SI`.
- SI 18: `17,5,15,3,9,11,1,7,13,18,6,16,4,10,12,2,8,14`.

Il sito ufficiale descrive tutte le nove buche e conferma i PAR; Hole19 pubblica la stessa matrice PAR e gli SI completi; FIG conferma 9/31 e 18/62. Il dato e' completo e giocabile, ma resta arancione perche' gli SI non sono pubblicati dalla fonte ufficiale del club.

Fonti:

- `https://www.golfclubsappada.com/percorso/`
- `https://www.hole19golf.com/courses/golf-club-sappada`

## Sicilia'S Picciolo

### Matrice certificata

- PAR 18: `4,3,4,4,3,5,5,3,5,3,4,5,4,4,3,4,4,5` = 72.
- SI 18: `8,18,12,6,14,4,2,16,10,15,1,9,13,3,17,5,11,7`.
- Prime Nove e Seconde Nove sono segmenti della stessa matrice certificata e corrispondono alle route FIG Par 36.

### Motivo del GREEN

Il sito ufficiale corrente pubblica dati hole-by-hole e coincide con la matrice su 17 buche. Solo la buca 2 ripete i dati della buca 1 (`PAR 4 / HCP 8`): il duplicato e' isolabile come refuso di rendering perche':

- FIG richiede Prime Nove Par 36 e percorso 18 Par 72; il valore ufficiale visualizzato produrrebbe invece un totale incompatibile;
- FlyAway e 18Birdies pubblicano entrambe buca 2 `PAR 3 / HCP 18`;
- 18Birdies coincide sull'intera matrice 1–18;
- tutti gli altri 17 valori ufficiali coincidono con la matrice secondaria.

Il conflitto e' quindi risolto senza introdurre una regola ad hoc o fondere versioni diverse. Tutte le route pubblicate sono certificate.

Fonti:

- `https://www.ilpiccioloetnagolfresort.com/it-IT/golf`
- `https://flyawaygolf.com/golfs/il-picciolo-etna-golf-resort`
- `https://18birdies.com/golf-courses/club/7c7f6c60-86ac-11e4-8c28-020000005b00/il-picciolo-golf-club`

## Stupinigi

### Matrici pubblicate

- PAR 9: `4,3,3,4,4,3,3,3,4` = 31.
- HCP 9 GesGolf: `1,5,9,3,15,17,7,13,11`.
- PAR 18: la stessa matrice ripetuta = 62.
- HCP secondo giro: `2,6,10,4,16,18,8,14,12`.

### Evidence e conflitto residuo

- FIG contiene la famiglia esatta 9/31 e 18/62 con rating coerenti.
- GesGolf corrente, circolo `40`, pubblica PAR e HCP completi per la famiglia 31/62.
- Il sito ufficiale dichiara un percorso fisico da nove buche e un giro Par 62.
- Nello stesso sito la descrizione hole-by-hole assegna tuttavia Par 5 alla buca 5; i nove PAR visualizzati totalizzano 32 e richiamano la distinta famiglia FIG 32/64.

La famiglia FIG/GesGolf 31/62 e' completa e giocabile. Il conflitto interno del sito ufficiale impedisce il verde. Le famiglie 30/60 e 32/64 restano identita' FIG non pubblicate in attesa di scorecard/versioning specifico.

Fonti:

- `https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=40`
- `https://www.golfclubstupinigi.com/percorso-golf-club-stupinigi/`

## Artefatti e validazioni

- Builder: `scripts/gesgolf/build-recovery-batch-group-2-2026-09-22.mjs`.
- Payload: `san-donato-normalized.json`, `san-michele-normalized.json`, `sappada-normalized.json`, `sicilia-s-picciolo-normalized.json`, `stupinigi-normalized.json` in `data/gesgolf/imports/`.
- Tutti i cinque payload hanno superato `npm run fig:validate`.
- Guardrail passati: numero buche, somma PAR/FIG, SI interi 1–18, unicita' SI per route, copertura 1–18 sulle route 18 e tee FIG.

## Seed e verifica remota

- Stato prima del seed: 212 club attivi e giocabili; 99 verdi; 113 arancioni.
- I cinque source ID FIG non erano presenti nella tabella `clubs`.
- Seed eseguito una sola volta sui cinque payload.
- Verifica post-seed: 5 club, 11 route, 135 righe buca e 45 tee; nessuna differenza fra payload e remoto.
- Stato dopo il seed:
  - club attivi: 217;
  - club giocabili: 217;
  - club non giocabili: 0;
  - verdi / `verified`: 100;
  - arancioni / `needs_review`: 117;
  - righe `fig_clubs` attive remote: 228, incluse 8 identita' alias legacy HTML-encoded;
  - identita' FIG canoniche locali: 220.

## Residuo catalogo

Restano fuori dal layer giocabile cinque identita' FIG canoniche, con 21 route attive complessive da riesaminare:

- `Tauriana` — 2 route;
- `Tirrenia` — 3 route;
- `Valpescara` — 7 route;
- `Verdura` — 6 route;
- `Villa Giusti` — 3 route.
