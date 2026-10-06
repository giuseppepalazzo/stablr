# Editor Buche di una combinazione esistente

Applicazione manuale: aprire il progetto di produzione nel SQL Editor, incollare
l'intero `supabase/admin-hole-grid-editor.sql` e premere Run una sola volta.
Prerequisiti già applicati: fondazione `admin-catalog-workflow.sql`, editor Club,
Percorso, Abbandona bozza e `admin-route-editor.sql`. Lo script include
`BEGIN/COMMIT` e la notifica di aggiornamento della cache RPC. Non è idempotente:
in caso di errore correggere la causa dopo rollback, non riapplicare se riuscito.
Non è stato eseguito remotamente durante lo sviluppo.

## Modello effettivo

Il dettaglio Route Admin identifica `route_combinations`; la sua sequenza reale è
in `route_combination_holes`, con riferimenti a `course_routes` e `route_holes`.
Non vengono ricostruite o modificate le buche fisiche. Il workflow aggiunge il
tipo `combination_holes_grid` ai soli vincoli delle tabelle workflow esistenti;
`live_entity_id` identifica la combinazione. Una bozza per combinazione e Admin,
con tutti gli ID buca reali, ordine, Par e SI nello snapshot. Bozze dati Route e
bozze griglia sono distinte. Nessun backfill o storico artificiale.

## RPC e sicurezza

- `admin_hole_grid_get_draft(uuid)`: contesto reale e bozza del chiamante,
  senza crearla.
- `admin_hole_grid_open_draft(uuid)`: apre/riprende l'intera griglia.
- `admin_hole_grid_save_draft(uuid,jsonb,bigint)`: CAS sulla revisione.
- `admin_hole_grid_publish_draft(uuid,bigint)`: controllo base, validazione,
  update esplicito Par/SI su tutte le 18 righe, singola versione immutabile,
  chiusura della bozza nella stessa transazione.
- `admin_hole_grid_archive_draft(uuid,bigint)`: abbandono della sola bozza.

Tutte sono SECURITY DEFINER con search_path fisso e oggetti qualificati.
EXECUTE è concesso solo ad authenticated; ciascuna esige identità autenticata
e ruolo Admin tramite `admin_catalog_require_admin()`. Anon, player e service_role
non possono invocarle. Helpers privati, nessun permesso diretto di scrittura,
nessuna modifica a policy live. Un trigger blocca anche un salvataggio generico
che tenti di alterare proprietà/base/identità/schema o l'allowlist della griglia.
Le RPC generiche create/restore non accettano il nuovo tipo: quel contratto
dedicato è rimandato.

## Regole e limiti deliberati

- Editabili: `route_combination_holes.par` (3–6) e `stroke_index` (1–18).
  Il SI è unico, non separato per genere. Draft parziali con null e SI duplicati
  possono essere salvati, ma non pubblicati.
- Numero/ordine (`round_hole_number`) è fisso: identifica la sequenza delle
  prime/seconde nove e ha un vincolo UNIQUE non differibile. Riordinare richiede
  un futuro contratto della sequenza; non viene alterato quel vincolo.
- ID, origine, posizione, buca fisica, `source_stroke_index` e `display_label`
  sono invariati. `display_label` è un'etichetta, non viene reinterpretata come
  nota. Non esistono fonte/note o SI uomini/donne dedicati sulla riga buca.
  Fonte e note già disponibili sulla combinazione sono mostrate read-only.
- Pubblicazione: 18 righe esistenti, numeri completi 1–18, nove righe per origine,
  nessun duplicato fisico, origini reali nello stesso Club, riferimenti buca
  presenti; ogni SI 1–18 una sola volta e Par completo. Il totale Par deve
  coincidere con `route_combinations.total_par` quando presente. Cambiare il
  totale richiede un futuro contratto: qui non si aggiornano combinazione o Tee.
- Base: confronto completo combinazione, righe griglia, percorsi e buche origine,
  oltre a revisione/versione base. Lock compatibili con gli editor esistenti;
  NOWAIT sulle righe origine/Club evita attese circolari con altri contratti.
  Il lock della tabella buche serializza temporaneamente le operazioni griglia.
- Nessun inserimento/eliminazione di buche live, nessuna modifica a percorsi,
  altre combinazioni, Tee/distanze/rating, fonti/matching o giri salvati.
- Restano futuri: griglia di un singolo Percorso (`route_holes`), riordino
  relazionale, modifica totale Par, ripristino dedicato dello storico griglia,
  genere, note/fonte persistenti per buca, Tee/rating e Revisioni.

## Test PostgreSQL locali

Con PGlite disponibile (anche in cartella temporanea):

```sh
STABLR_PGLITE_MODULE=/percorso/pglite/dist/index.js node --test scripts/tests/admin-hole-grid-editor.test.mjs
```

Fixture solo nei test: CREATE TABLE effettivi estratti dalle migration storiche,
permessi/ownership, revisione e snapshot, SI/Par, integrità origini, conflitto base,
rollback dopo update se lo storico fallisce, immutabilità, chiusura, abbandono,
nessuna scrittura a entità collegate e race di salvataggio su una revisione.
PGlite serializza le richieste locali: non è una prova multi-sessione dei lock
in produzione, dove PostgreSQL gestisce i lock transazionali descritti sopra.
