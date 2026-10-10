# Propagazione sicura Par fisico

## Applicazione manuale

Applicare **una sola volta**, nel SQL Editor del progetto corretto, l'intero
`supabase/admin-catalog-physical-par.sql`. Sono prerequisiti le migration già
applicate della fondazione (fino a multi-9), il lock per club, origine dati v2,
classificazioni tee e gli editor catalogo. Nessuno script storico va rieseguito.
La migration è transazionale: non crea proposte, non classifica tee e non aggiorna
il catalogo durante l'applicazione. Poi ricaricare Admin.

### Correzione successiva del publisher (Mare di Roma)

Se la migration iniziale è già applicata, eseguire **soltanto una volta**
`supabase/admin-catalog-physical-par-source-drafts.sql`. Non rieseguire la
migration iniziale. Il fix incrementale ridefinisce funzioni, senza modificare
righe live, foundation, bozze, versioni, classificazioni o audit durante
l'applicazione. Preserva grant, lock e transazione del publisher.

La configurazione autonoma esattamente collegata al Percorso fisico è indicata
come base aggiornabile ed è richiesta nella preview; la 18 ripetuta eredita due
occorrenze. La regressione di Buca 1 5→4 verifica totali 35→34 / 70→68 e otto tee.
Un vecchio fingerprint bozza è riconosciuto solo se coincide esattamente con
l'intera base corrente calcolata con l'algoritmo originale: nessun rebase o nuova
adozione. La lettura e la migration non lo cambiano; un salvataggio esplicito,
dopo questa prova, può convertirlo al nuovo formato senza cambiare la base dati.

## Contratto

Tre nuove tabelle RPC-only: bozze personali Par, versioni immutabili Par e ricevute
immutabili del batch tee. API anon/player/service non possono leggere, inserire,
aggiornare o eliminare direttamente alcuna riga. Solo Admin autenticati con UID
e ruolo verificati possono usare le RPC pubbliche:

- `admin_catalog_par_tee_proposal`, `admin_catalog_par_tee_confirm`;
- `admin_catalog_par_list`, `admin_catalog_par_open`, `admin_catalog_par_save`;
- `admin_catalog_par_abandon`, `admin_catalog_par_publish`.

Helpers, capability transazionale e baseline interne non sono API. Risposte e
versioni contengono soltanto l'impatto tecnico consentito, mai raw, payload FIG,
snapshot di editor o segreti. La funzione origine dati mantiene la stessa API.

Il batch è **per club**, con un'unica conferma e nota obbligatoria. Propone solo
`curato + derivato`, regola esplicita `sum_configuration_effective_par`, sulla
configurazione verificata unica dell'esatto UUID padre e ambito. Il fallback di
ambito dal padre è quello del consumer corrente, non un collegamento dedotto.
L'uguaglianza del totale è solo un controllo finale di coerenza. Classificazioni
già esistenti sono sempre preservate. L'archivio FIG incompleto non è usato come
certificazione. Preview senza scritture; hash SHA-256 ricalcolato server-side;
retry della stessa approvazione restituisce la ricevuta, un altro autore/nota no.

Il publisher richiede una bozza dedicata, revisione, hash d'impatto corrente,
nota e conferma esplicita. La stessa transazione aggiorna base Par, righe live
ereditarie esattamente collegate, totali e soli tee derivati curati impattati;
chiude la bozza e registra versione/audit. Le occorrenze 18 su 9 ripetute cambiano
il totale di configurazione due volte, ma ciascuna riga fisica live una sola volta.
SI, CR/Slope, distanze, override, giri e tutti gli storici precedenti restano uguali.

## Baseline e concorrenza

Le snapshot di registrazione verificate restano immutabili. Ogni pubblicazione
crea un nuovo anchor SHA-256 del grafo corrente nella nuova versione: soltanto
se il grafo attuale coincide esattamente, origine dati riconosce le relazioni già
verificate come correnti. Una successiva variazione estranea invalida l'anchor.
Le baseline delle sole decisioni `curato + derivato` già correnti vengono
aggiornate nella stessa transazione, con l'audit esistente; non sono nuove
attestazioni o adozioni di decisioni sconosciute/obsolete.

Lock advisory NOWAIT per club e lock di tabella NOWAIT coprono anche import,
editor preesistenti e inserimenti concorrenti. In questa prima versione i lock
di tabella sono intenzionalmente conservativi e temporaneamente serializzano
scritture catalogo anche di club diversi. Nessun lock rimane dopo commit/rollback.
La deroga al sigillo fisico vale esclusivamente per il Par esatto della bozza
del publisher, nel suo transaction ID privato; nessun GUC la può abilitare.

## Blocchi e limiti

- Copertura completa del catalogo del club, cardinalità e collegamenti verificati
  sono requisiti distinti. Una configurazione live non coperta è impatto ignoto,
  non assenza di impatto. Nessun match da nome, colore, Par o offset.
- Sorgenti/revisioni mutate, SI o sequenze incoerenti, collegamenti ambigui e matrici
  tee non associate esattamente bloccano senza scritture. Dopo il fix, solo bozze
  catalogo realmente modificate sui target impattati bloccano: campi editabili
  confrontati server-side con live e base originale, senza contesto/timestamp.
  Bozze mai modificate, identiche al live o su target estranei restano salvate e
  non bloccano. Nessuna archiviazione o riscrittura automatica; bozze sovrapposte
  non confrontabili con un contratto sicuro restano bloccanti.
- Tee sconosciuti, da revisionare o obsoleti bloccano soltanto se impattati.
  Una classificazione `certificato + derivato` resta conservativamente bloccata:
  occorre un futuro contratto esplicito di riattestazione, non la riscrittura
  automatica della prova certificata.
- Override Par tee verificati su **tutte** le occorrenze impattate escludono quel
  tee dall'aggiornamento; override parziali/non verificati bloccano. SI override
  non viene modificato. Override di configurazione restano esclusi; se condividono
  la stessa riga live di un valore ereditario, la collisione blocca.
- Nessun batch multi-club, nuovi collegamenti, editor dei valori SI/override,
  backfill, aggiornamento import o modifica consumer.

## Rollback e pilota

Prima di qualsiasi uso si può ignorare la nuova UI/revocare le nuove RPC.
Dopo pubblicazioni non eliminare tabelle/versioni né ripristinare snapshot
storiche: il rollback funzionale è una **nuova pubblicazione compensativa**,
con bozza, nuova preview e stessi controlli. Se le basi sono cambiate si blocca.

Pilota consigliato: Mare di Roma, percorso fisico 9 e configurazione 18 ripetuta.
Il numero effettivo proposto viene calcolato dal server in preview, mai dalla UI.
Un solo test manuale finale, dopo applicazione: prepara/approva il batch, apri una
buca fisica, salva un Par diverso, controlla entrambe le occorrenze e i totali,
conferma e verifica chiusura bozza/storico. Nessuna pubblicazione è eseguita dagli
script di test o automaticamente dalla feature.

## Verifiche locali isolate

I test SQL caricano i prerequisiti in PGlite temporaneo. Il test concorrenza usa
PostgreSQL nativo temporaneo con due sessioni, indicando `STABLR_PG_BIN` e
`STABLR_PG_MODULE`; non collega alcun DB Supabase. Fixture solo nei test.
Eseguire test Node (`scripts/tests/*.test.mjs`), suite app, build e
`git diff --check`. I test includono rollback dopo aggiornamenti live, batch
interrotto, compensazione e blocchi per sovrapposizioni/concorrenza.
