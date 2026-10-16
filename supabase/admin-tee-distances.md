# Task 4 — Distanze dei tee pubblicati

## SQL manuale

Applicare **una sola volta** `supabase/admin-tee-distances.sql`, dopo
`supabase/admin-tee-si-overrides.sql` e i relativi prerequisiti (workflow,
griglie, fondazione fisica verificata e CRUD tee Percorso/combinazione).
Non riapplicare SQL storici. Nessun SQL remoto è eseguito da questa task.

La migration è transazionale, senza backfill. Crea soltanto la proiezione
`catalog_tee_distances` e i relativi controlli, riusando bozze/versioni esistenti
con tipi ristretti `route_tee_distances` e `combination_tee_distances`.

## Contratto

- RPC Admin-only `admin_tee_distances`: `detail`, `open`, `save`, `preview`,
  `publish`, `archive`, `restore`. UID/JWT/Admin attuale, proprietà personale,
  revisione ottimistica e base server-side; helper non invocabili via API.
- Preview/detail read-only. Pubblicazione con hash dell'anteprima e nota:
  versione immutabile con autore/data/diff, proiezione e chiusura della bozza
  nella stessa transazione. Lock NOWAIT sulle sorgenti e advisory lock per tee;
  un errore annulla tutto. Ripristino sempre in **nuova bozza**.
- Nessun DML API diretto. Il player autenticato legge solo la proiezione minima
  dei tee attivi di club giocabili. Anon e service API non hanno accesso;
  bozze, audit privato, payload e autore non arrivano al player.
- Identità: tipo/UUID tee, configurazione verificata, ambito 9/18, ID buca live,
  slot fisico verificato e occorrenza. Nessuna deduzione da nome/colore/Par.
  Non esiste FK al tee importato: un UUID ricreato non eredita vecchie distanze.
- 9×2: 18 celle distinte, anche se riusano 9 identità fisiche. Multi-9 e intervalli
  del fisico 18 usano soltanto le mappe già verificate, senza nuove inferenze.
  Nessuna copia o propagazione automatica tra tee, ambiti o configurazioni.
- Metri interi `0..2147483647` (limite del tipo integer, non limite golfistico).
  `null` significa mancante, non zero e non ereditarietà. Totale completo solo
  con tutte le distanze; prime/seconde nove e somme parziali sono separati.
  Totali sempre calcolati sul server, non accettati nello snapshot client.
- Mancanti, zero e sostituzione di matrici legacy sono avvisi da confermare.
  Identità/cardinalità errate, valori non validi e basi mutate sono bloccanti.
- Nessuna tabella normalizzata distanze esisteva prima: matrici e totali raw
  FIG/GesGolf rimangono invariati. Non vengono precompilati tramite nomi/colori.
  Senza proiezione resta il vecchio comportamento; una proiezione gestita con
  celle nulle **non** riattiva il fallback legacy. Un contratto non valido mostra
  distanza non disponibile, senza cambiare i calcoli o bloccare il gioco.

Nessuna scrittura a tee/metadati, Par/SI/CR/Slope, fondazione, import, giri o
snapshot storici. La ricostruzione dei giri passati ignora le nuove distanze.
Per compensare una pubblicazione, ripristinare una versione in bozza e
pubblicarla con una nuova anteprima; mai cancellare storico/proiezioni.

## Verifica UX minima

Tee pubblicato → **Gestisci distanze** → Modifica distanze. Inserire una colonna
da 9/18 valori (una cella per riga o tab Excel), con `—` per i mancanti e `0`
solo se esplicito. Applica alla bozza, salva, verifica totali e Prima/Dopo.
Fino alla conferma nessuna distanza è pubblicata. Su un tee pilota autorizzato,
controllare poi chiusura bozza, ripresa/ripristino, distanza per buca nel player
e indipendenza delle due occorrenze nel 9×2. Se il collegamento non è verificato,
deve comparire il blocco, senza abilitazione o classificazione automatica.

Test isolati: `scripts/tests/admin-tee-distances.test.mjs` (PGlite) e
`scripts/tests/admin-tee-si-concurrency.test.mjs` (PostgreSQL locale, due sessioni).
Nessuna pubblicazione reale o migration remota è stata eseguita dai test.
