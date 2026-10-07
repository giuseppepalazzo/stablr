# Griglia buche fisiche del singolo Percorso

Applicare manualmente, una sola volta, **solo** il nuovo script
`supabase/admin-course-hole-grid-editor.sql` nel SQL Editor del progetto.
I contratti precedenti devono essere già applicati, incluso quello della griglia
combinazioni (`admin-hole-grid-editor.sql`). Incollare tutto il nuovo script,
comprensivo di BEGIN/COMMIT, ed eseguire Run. La notifica finale aggiorna la cache
RPC. Lo script è intenzionalmente non idempotente; una seconda applicazione
fallisce e deve essere annullata. Non riapplicare le migration storiche.
Nessun SQL remoto è stato eseguito durante l'implementazione.

## Modello e campi reali

`course_routes` → `route_holes` tramite `route_id`. Le righe reali contengono
`id`, `physical_hole_number`, `par`, `stroke_index`, `display_label`, `created_at`.
Non ci sono campi distinti SI uomini/donne né fonte/note per buca.
Sono modificabili **solo Par e SI/HCP**. Identità, numero/ordine, relazione,
etichetta e data di creazione rimangono invariati. La fonte del Percorso è
mostrata read-only. Nessuna modifica a course_routes, combinazioni, Tee, distanze,
rating o giri già salvati.

Il tipo workflow aggiunto è `route_holes_grid`, con `live_entity_id` uguale al
Percorso; rimane distinto da `combination_holes_grid`. La bozza contiene tutti
gli ID fisici esistenti e una base catturata dal server. Un indice impedisce più
bozze aperte per lo stesso Percorso e Admin. Nessun record storico è generato
durante la migration o il salvataggio bozza.

## Validazione SI fondata sui dati

Mare di Roma ha nove buche, totale Par 35 e SI ordinati 1,3,5,7,9,11,13,15,17.
Il catalogo contiene anche nove buche con SI 1–9, pari 2–18 e altri sottoinsiemi
importati della scala 1–18. Non vengono normalizzati o ricostruiti i mapping.

- **18 buche:** ogni SI da 1 a 18 esattamente una volta.
- **9 buche, insieme live completo/valido:** lo snapshot base conserva l'insieme
  dei nove SI distinti reali, nell'intervallo 1–18. Si può modificarne
  l'assegnazione alle buche, mantenendo quell'insieme esattamente una volta.
- **9 buche con SI incompleti/duplicati:** la sequenza di correzione prevista è
  1–9, mostrata chiaramente nella UI. La convenzione viene catturata nella base;
  il payload client non può sostituirla né modificarla al salvataggio.

La pubblicazione richiede il numero esatto di righe live, numeri completi 1–9 o
1–18 senza duplicati/fuori range, Par interi 3–6 e SI essenziali presenti.
Se il Percorso ha un `total_par`, il totale della griglia deve coincidere;
altrimenti il totale resta null sul live e viene solo calcolato in UI.
Bozze con Par/SI null o SI duplicati possono essere salvate per proseguire il
lavoro, ma non pubblicate. L'editor non aggiunge/rimuove/riordina buche.

## RPC dedicate e sicurezza

- `admin_course_hole_grid_get_draft(uuid)` — contesto e bozza del chiamante,
  senza creare nulla.
- `admin_course_hole_grid_open_draft(uuid)` — apre/riprende una griglia solo se
  il Percorso possiede buche fisiche reali e appartiene a un Club attivo.
- `admin_course_hole_grid_save_draft(uuid,jsonb,bigint)` — allowlist e revisione
  ottimistica.
- `admin_course_hole_grid_publish_draft(uuid,bigint)` — pubblicazione dell'intera
  griglia, singola versione immutabile con autore/data/snapshot/diff e chiusura
  della bozza nella stessa transazione.
- `admin_course_hole_grid_archive_draft(uuid,bigint)` — abbandono non distruttivo
  della sola bozza, senza versioni o aggiornamenti live.

SECURITY DEFINER, search_path fisso, nomi qualificati. EXECUTE concesso solo ad
authenticated; ogni RPC verifica JWT autenticato e ruolo Admin. Proprietà,
schema, revisione, stato e base sono validati. Helpers non eseguibili via API.
Nessun nuovo grant/policy sul catalogo. Il trigger dedicato protegge la griglia
anche dal saver generico del workflow. Le RPC generiche create/restore non
accettano il nuovo tipo: ripristino dedicato rimandato.

Il lock SHARE ROW EXCLUSIVE su route_holes precede i lock sulle righe Percorso e
Club e impedisce scritture/phantom per tutta l'operazione. NOWAIT sulle righe
evita attese circolari con altri editor. Confronto completo di Percorso, buche,
versione base e revisione; aggiornamento esplicito dei soli Par/SI. Il lock
serializza temporaneamente gli editor di buche fisiche. Nessuna lettura o
scrittura delle tabelle combinazioni da parte delle nuove RPC.

## Verifiche locali

Test PostgreSQL con PGlite e definizioni effettive di CREATE TABLE, solo fixture:
permessi/RLS, ownership, allowlist, campi mancanti, 9/18 e convenzioni SI,
conflitti base/revisione, rollback dopo update, versioni immutabili, abbandono,
assenza di modifiche alle combinazioni e applicazione one-shot. PGlite
serializza le richieste: i test di race verificano il compare-and-swap, non
simulano connessioni PostgreSQL indipendenti per i lock.

Test UI: CourseEditor con buche fisiche e senza; protezione Salva/Scarta/Resta,
griglia dedicata, resume, diff Prima/Dopo, conferma finale, abbandono, errori e
ritorno allo stesso editor Percorso. Suite completa e build richieste.
