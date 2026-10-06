# Editor di un Percorso esistente

## Applicazione manuale

Prerequisiti già applicati: schema catalogo condiviso, estensione FIG/WHS,
accesso Admin, `admin-catalog-workflow.sql` e `admin-club-editor.sql`.

1. Nel progetto di produzione corretto aprire il SQL Editor.
2. Creare una nuova query e incollare **l'intero** `supabase/admin-course-editor.sql`.
3. Eseguire una sola volta, includendo `begin` e `commit`.
4. Verificare il successo della transazione prima di utilizzare l'editor.

Non riapplicare gli script storici. Questa migration è intenzionalmente
one-shot: una seconda esecuzione fallisce e annulla la transazione. Non è
stata applicata da Codex e non crea bozze/versioni per i record esistenti.
La notifica PostgREST è compresa nella transazione.

## Mappatura e campi

L'Admin chiama oggi “Percorso” una riga di `course_routes`. Si riutilizza
quindi il tipo workflow `route`, già associato a quella tabella. Non si crea
una tabella `courses`, non si cambia il tipo concettuale `course` della
fondazione e non si aggiungono editor di combinazioni o segmenti.

Allowlist: `name`, `holes_count` (solo 9/18), `display_order` (integer nullable,
anche zero), `is_active` (boolean). Nome trim, obbligatorio, massimo 200 caratteri.
La disattivazione non archivia, non elimina e non modifica entità dipendenti.
I percorsi disattivati restano raggiungibili nel riepilogo Club per riattivarli;
i conteggi e la ricerca del catalogo continuano a considerare solo quelli attivi.

La struttura è modificabile solo su un record senza `total_par`, metadati
strutturali (`round_variant`, `physical_hole_count`, `product_simplification`),
buche, tee, combinazioni, buche combinazione, buche giro o giri che lo
riferiscono in `selected_routes`. Anche dipendenze disattivate bloccano il
cambio. La RPC ricontrolla tutto alla pubblicazione; solo per un cambio 9/18
blocca brevemente le scritture sulle tabelle dipendenti, prima di bloccare
il record live, evitando inserimenti concorrenti e riferimenti JSON invisibili
ai vincoli FK. Nessuna riga dipendente viene modificata.

Nome originale FIG (quando presente in `source_payload.fig_display_name`) e
nome GesGolf (`source_payload.gesgolf.route_name`) sono solo lettura. Non
esistono colonne editabili dedicate a nome originale, alias o note. Per una
futura estensione proporre, con una migration separata, `original_name text`,
`aliases text[]` e `notes text`, insieme a un nuovo contratto snapshot/allowlist
validato. Non aggiungerle implicitamente né usare `source_payload` come editor.

`club_id`, fonti, identificatori esterni, payload, matching, `total_par`, buche,
tee/rating e combinazioni non sono editabili. Nessuna relazione Admin sicura
per modificare associazioni FIG/GesGolf è introdotta.

## RPC e sicurezza

- `admin_course_get_draft(p_course_id uuid)`: sola bozza in corso dell'Admin corrente.
- `admin_course_open_draft(p_course_id uuid)`: apre/riprende una bozza di un
  record esistente, anche disattivato, appartenente a un Club attivo. Cattura
  base e timestamp sul server; restituisce bozza e contesto in sola lettura.
- `admin_course_save_draft(p_draft_id uuid, p_snapshot jsonb, p_expected_revision bigint)`:
  proprietà, allowlist tipizzata e revisione ottimistica; nessuna scrittura live.
- `admin_course_publish_draft(p_draft_id uuid, p_expected_revision bigint)`:
  tipo `route`, schema 1, proprietà, stato aperto, record esistente, base server,
  timestamp, contesto tecnico e versione base invariati, allowlist e dipendenze.
  Aggiorna esclusivamente i quattro campi consentiti e `updated_at`; inserisce
  versione immutabile con snapshot/diff/autore/data; chiude la bozza nella stessa
  transazione. Nessun cambiamento oppure conflitto => nessuna pubblicazione.

Tutte sono `SECURITY DEFINER`, con `search_path = pg_catalog`, nomi qualificati,
EXECUTE solo ad `authenticated`, controllo interno obbligatorio di `auth.uid()`,
`auth.role()` e `is_admin()`. Player, anon e service API sono rifiutati. Gli helper
non hanno EXECUTE API. Nessuna nuova policy o autorizzazione alle tabelle live.
Un trigger protegge proprietà/base/identità/schema/revisione/allowlist anche
contro il saver generico già esistente. Una bozza generica o ripristinata senza
base catturata dal server non può essere pubblicata da questo contratto.

## Verifiche locali

`scripts/tests/admin-course-editor.test.mjs`: PostgreSQL via PGlite, senza rete,
con fixture solo test; privacy, permessi, proprietà, allowlist, resume, CAS,
conflitti, dipendenze, reattivazione, atomicità, rollback e storico immutabile.
`Promise.allSettled` verifica doppie conferme nel singolo motore di test: non è
una simulazione di due sessioni PostgreSQL indipendenti.

`CourseEditor.test.js` e `AdminCourseFlow.test.js`: flusso UI, adapter RPC,
griglia differenze, conferma finale, bozza, uscita non salvata, navigazione,
stati read-only/errori e ritorno ai dati pubblicati.

Rimandati: nuovo percorso, entità Percorso separata dalle route, modifica della
struttura di percorsi configurati, nuovi campi, associazioni FIG/GesGolf,
Route/combinazioni/Buche/Tee/rating, ripristino operativo, archiviazione e Revisioni.
