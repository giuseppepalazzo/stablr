# Fase 2 — Struttura e collegamenti

Applicare una sola volta, manualmente nel SQL Editor, l'intero
`supabase/admin-catalog-structure-review.sql` (BEGIN/COMMIT inclusi), dopo
`admin-catalog-physical-foundation.sql`. Sono richiesti gli schemi catalogo/FIG
e il collegamento FIG già usati dall'Admin. Non riapplicare script precedenti.

La migration aggiunge solo due RPC di lettura, STABLE, SECURITY DEFINER, con
search_path fisso e controllo Admin autenticato prima delle SELECT:

- `admin_catalog_structure_review_queue()`: restituisce club e combinazioni del
  catalogo attivo, con lo stato reale della fondazione. Il filtro UI predefinito
  mostra club senza classificazione verificata e combinazioni prive di una
  configurazione verificata con tutti i collegamenti fisici verificati. Il
  filtro «Classificati / verificati» mantiene consultabili le decisioni concluse.
- `admin_catalog_structure_review_detail(text, uuid)`: evidenze del club o della
  combinazione, FIG solo tramite foreign key già esistente, payload GesGolf/import
  conservati nel catalogo, proposte e audit della fondazione. I riferimenti buca
  legacy sono controllati per uguaglianza esatta, senza correzioni di numerazione.

Le due RPC hanno EXECUTE solo per authenticated; player, anon, identità mancanti
e service API sono respinti. Nessuna policy, grant su tabelle, funzione storica,
tabella o trigger viene modificato. Nessuna scrittura avviene durante la lettura.

Le uniche azioni UI persistenti riusano `admin_catalog_foundation_create_structure`
e `admin_catalog_foundation_review_structure` della Fase 1. La prima conferma crea
una struttura `non_classificato / needs_review`; una conferma successiva consente
la classificazione manuale con fonte, riferimento e nota. `non_classificato` resta
Da revisionare. Una classificazione esplicita conferma `verified` e rende la
struttura consultabile in sola lettura, come previsto dal contratto sigillato
della Fase 1. Il controllo revisione resta quello server-side esistente.

Classificare il club non verifica una combinazione. La UI non crea buche fisiche,
configurazioni, collegamenti o override e non offre azioni per modificarli.
Nessun dato catalogo live, import, giro, bozza o versione pubblicata viene scritto.
Nessun consumer giocatore viene modificato. Non sono presenti contatori o elenchi
basati sui precedenti totali 30/63: i candidati sono ricavati dai record attuali.

Per sospendere questa fase basta ignorare la nuova area Admin; i consumer attuali
continuano a funzionare senza queste letture. Un eventuale rollback va effettuato
con un nuovo script dedicato, limitato alle due RPC di lettura e alla UI; le
decisioni e l'audit della fondazione devono essere conservati.

Test isolati: `scripts/tests/admin-catalog-structure-review.test.mjs` (PGlite) e
`src/admin/StructureReview.test.js` (UI/contratto client). Non richiedono accesso
remoto e usano fixture soltanto nei test.
