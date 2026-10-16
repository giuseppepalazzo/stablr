# Override SI specifici del tee

## Applicazione manuale

Applicare **una sola volta** `supabase/admin-tee-si-overrides.sql` nel SQL Editor
del progetto corretto, dopo un backup verificato. È un'unica transazione.
Prerequisiti già previsti: workflow catalogo/editor griglie, fondazione fisica
Fasi 1–3c e multi-9, CRUD tee Percorso e combinazione. Non riapplicare migration
storiche. Nessuna applicazione remota o pubblicazione è eseguita da questo task.

## Contratto e sicurezza

- RPC `admin_tee_si`: azioni fisse `detail`, `open`, `save`, `preview`, `publish`,
  `archive`, `restore`. Solo JWT authenticated con UID di un Admin attuale.
  Proprietà personale e revisione richieste per ogni bozza; nessun proxy JSON.
- Riusa bozze/versioni esistenti con tipi ristretti `route_tee_si` e
  `combination_tee_si`. Nessun backfill o modifica alle versioni preesistenti.
- `catalog_tee_si` contiene soltanto la proiezione pubblicata necessaria al player.
  Lettura autenticata dei tee attivi di club giocabili (Admin anche storico).
  Nessun DML API, nessun accesso anon/service, nessun payload/autore/bozza.
  Gli ID della fondazione sono riferimenti, non accesso alle tabelle private.
- Identità: tipo e UUID tee, genitore, ambito, slot verificato, ID buca live e
  occorrenza. Il tee non ha FK: un UUID importato ricreato NON eredita l'override.
- Configurazione, struttura, buche e collegamento fisico devono essere verificati.
  Prime/Seconde Nove leggono il proprio slot live già collegato esplicitamente:
  nessuna nuova deduzione da offset. Il 9×2 usa due occorrenze distinte dello
  stesso ID buca; SI standard base/base+1 solo per la regola già dichiarata.
- 18: permutazione completa 1–18. 9: permutazione della scala SI verificata
  esistente (anche dispari/pari o sottoinsieme di 1–18), mai normalizzazione.
  Salvare una bozza incompleta/duplicata non pubblica: preview/conferma bloccano.
- Un SI nullo nella griglia gestita significa esplicitamente SI configurazione.
  Rimuovere l'override pubblica questa scelta; NON riattiva la matrice legacy.
  Nessun contratto pubblicato: comportamento legacy preesistente invariato.
  Matrici legacy non attribuite al tee per nome/colore: presenza segnalata, valore
  precedente indicato come non attribuito. Override SI già presenti nella vecchia
  fondazione richiedono revisione esplicita; nessuna adozione automatica.
- Anteprima read-only e conferma vincolata a revisione/base/snapshot correnti,
  nota obbligatoria; advisory lock per tee e lock NOWAIT sulle sorgenti, sulle
  dipendenze e sui draft (anche phantom). Pubblicazione serializzata brevemente
  sui draft: se occupati fallisce esplicitamente, senza scritture parziali.
- In un'unica transazione: versione immutabile con diff/autore/data/nota,
  proiezione corrente e chiusura bozza. Nessuna scrittura a griglie standard,
  tee/rating, Par, fondazione, distanze, import, giri o snapshot esistenti.
- Un SI modificato nella griglia live invalida il contratto: il player blocca
  l'avvio per quel tee invece di usare un fallback silenzioso. Cambi base e
  bozze griglia con differenze SI reali bloccano la pubblicazione; bozze identiche
  o modifiche a solo Par non diventano falsi conflitti SI sovrapposti.

## Ripristino e test UX minimo

Da Club → Percorso/combinazione → Gestisci tee → tee → **Gestisci override SI**:
aprire una bozza, scambiare due SI della stessa scala, salvare e aprire Pubblica.
Verificare ambito, Prima/Dopo e nota obbligatoria; fino alla conferma nulla è live.
Su un tee pilota autorizzato, confermare e controllare chiusura bozza e nuova
versione, senza variazioni a Par/CR/Slope. Verificare anche rimozione esplicita.

Ripristina crea soltanto una **nuova bozza** da una versione dello stesso tee,
con la base attuale: richiede nuova anteprima/conferma per compensare il live.
Una bozza già aperta deve essere pubblicata o abbandonata esplicitamente prima.
Lo storico e gli snapshot dei giri non vengono riscritti; la ricostruzione
legacy dei giri passati non applica il nuovo contratto SI.

Fuori perimetro: attribuzione/import matrici legacy, riparazione collegamenti
non verificati, override su combinazioni manuali non persistite, propagazione
tra tee o ambiti, distanze e modifica di SI standard.

Test locali: `node --test scripts/tests/admin-tee-si-overrides.test.mjs`
(`STABLR_PGLITE_MODULE` se PGlite è installato fuori repository) e
`scripts/tests/admin-tee-si-concurrency.test.mjs` con `STABLR_PG_BIN` e
`STABLR_PG_MODULE` puntati a un PostgreSQL temporaneo e al modulo `pg`.
