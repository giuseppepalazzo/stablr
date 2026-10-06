# Editor Route/combinazione esistente

L'entità persistente è `route_combinations`, tipo workflow `route_combination`.
È distinta dal Percorso (`course_routes`, tipo workflow `route`). Il catalogo
attuale vincola le combinazioni a **18 buche** e a due origini distinte.

## Applicazione manuale

Prima dell'applicazione verificare che siano già presenti: schema catalogo e FIG/WHS, accesso Admin,
`admin-catalog-workflow.sql`, `admin-club-editor.sql`, `admin-course-editor.sql`
e `admin-catalog-abandon-draft.sql`.

Nel SQL Editor del progetto corretto creare una nuova query, incollare tutto
`supabase/admin-route-editor.sql` (inclusi `begin` e `commit`) ed eseguire
**una sola volta**. La notifica PostgREST è inclusa. Non riapplicare gli script
storici: questo script è intenzionalmente one-shot e una seconda esecuzione
fallisce senza sostituire gli oggetti già presenti.

Non è stato applicato remotamente. Non genera bozze/versioni per record esistenti
e non modifica colonne, policy, grant delle tabelle live o dati catalogo durante
la migration. Le scritture live avvengono solo per conferma della RPC specifica.

## Campi e limiti

Editabili: `name` (trim, obbligatorio, massimo 200 caratteri) e `is_active`
(boolean). `updated_at` viene aggiornato come metadato catalogo esistente.
La disattivazione lascia tutte le righe di buche e tee intatte; la Route resta
raggiungibile nel Club e nei Percorsi origine per la futura riattivazione.

Ordine: manca una colonna `display_order` dedicata a `route_combinations`.
Il player legge eventualmente `source_payload.display_order`: se presente
viene mostrato in sola lettura. Non modificare il payload di fonte per simulare
un campo editabile. Estensione futura minima: `display_order integer null`,
seguita da un contratto snapshot validato e una decisione esplicita sulla lettura
dell'ordine da parte dei consumer. Nessuna colonna nuova in questo script.

Read-only: `club_id`, `front_route_id`, `back_route_id`, struttura 18, `total_par`,
sequenza buche, SI, fonti/identificatori/payload, matching, note. Le note non hanno
un campo dedicato: si mostrano solo eventuali `source_payload.notes`/`note`;
un futuro campo `notes text` richiede migration e contratto separati. Matching
e stato esterno mostrati sono quelli reali del Club, esplicitamente etichettati.
Le origini sono mostrate con nomi e posizione; nessun editor di FK grezze.

## Controlli effettivi

La stessa funzione server genera il contesto letto dalla UI e ricontrollato
alla pubblicazione. Richiede struttura 18; due origini distinte nello stesso
Club, ciascuna di 9 o 18 buche; 18 righe; tutti i numeri giro 1..18 presenti
una sola volta; nove buche per posizione; origini e posizioni corrispondenti
a prime/seconde nove; nessun duplicato della coppia percorso/buca fisica;
numeri fisici entro la cardinalità dell'origine e presenti in `route_holes`.
Se `total_par` esiste, deve uguagliare la somma dei Par della combinazione.
Un Par assente resta assente e non viene ricostruito nel catalogo.

I duplicati dei numeri di giro sono già normalmente impediti dall'UNIQUE
esistente; il controllo è comunque esplicito. La stessa buca numerata 1 in
due percorsi diversi è lecita e non viene segnalata come doppione.

Per pubblicare come attiva entrambe le origini devono essere attive. La
disattivazione è permessa anche con origini disattivate, purché la struttura
sia coerente. Una struttura incompleta/non coerente blocca **tutte** le
pubblicazioni, anche di soli metadati; salvataggio/abbandono bozza restano
disponibili. Nessuna riparazione automatica dei dati.

## RPC e sicurezza

- `admin_route_get_draft(p_route_id uuid)`: contesto read-only e sola bozza
  aperta dell'Admin corrente; non crea bozze.
- `admin_route_open_draft(p_route_id uuid)`: apre/riprende una bozza di una
  combinazione esistente, anche disattivata, in un Club attivo.
- `admin_route_save_draft(p_draft_id uuid, p_snapshot jsonb, p_expected_revision bigint)`:
  proprietà, record esistente, schema 1, allowlist esatta e CAS sulla revisione;
  non aggiorna il live.
- `admin_route_publish_draft(p_draft_id uuid, p_expected_revision bigint)`:
  proprietà, tipo/schema, stato draft, revisione, record esistente, base/versione
  correnti e controlli di coerenza. In un'unica transazione aggiorna solo
  nome/stato operativo, crea versione immutabile con snapshot/diff/autore/data
  e chiude la bozza. Nessun JSON generico o SQL dinamico scrive il catalogo.

Per Abbandona bozza si riutilizza `admin_catalog_archive_draft` con tipo
`route_combination`: nessuna RPC aggiuntiva di archiviazione live.

Tutte le quattro RPC sono SECURITY DEFINER con search_path `pg_catalog`,
oggetti qualificati, grant EXECUTE solo ad `authenticated` e controllo interno
di UID, ruolo autenticato e `is_admin()`. Player/anon/service API non possono
invocarle. Gli helper sono privati alla API. Un trigger protegge base, identità,
proprietà, revisione e allowlist anche contro il saver generico esistente.
Bozze generiche/ripristinate senza base server non sono pubblicabili qui.

La base server comprende tutti i campi tecnici della combinazione, le origini,
le righe buche della combinazione e delle origini. Pubblicazione/open bloccano
brevemente gli scrittori delle due tabelle buche, le due origini e la combinazione,
così il controllo non lascia passare inserimenti/aggiornamenti concorrenti.
L'ordine dei lock prende la riserva di scrittura della tabella combinazioni
prima delle origini, compatibilmente con il contratto Percorso esistente.
Un deadlock con altre transazioni viene annullato da PostgreSQL e mostrato
come operazione da riprovare; non produce scritture parziali.

## Test e prossimi contratti

Test PostgreSQL isolati: `scripts/tests/admin-route-editor.test.mjs`, fixture
con CHECK/FK/UNIQUE reali, grant/RLS preesistenti e tutti i workflow già presenti.
Test UI: `RouteEditor.test.js` e `AdminRouteFlow.test.js`; ingressi Club/Percorso,
bozza, uscita, diff/conferma, errori, coerenza, abbandono e riattivazione.
PGlite esegue un singolo backend: il test con doppia conferma verifica un solo
successo, non simula due sessioni PostgreSQL indipendenti.

Rimandati: Nuova Route, ordine editabile, note dedicate, cambi di origini/struttura,
modifica/riparazione buche, Tee/rating, ripristino operativo di versioni,
archiviazione del live e Revisioni. Nessun codice dell'app giocatore modificato.
