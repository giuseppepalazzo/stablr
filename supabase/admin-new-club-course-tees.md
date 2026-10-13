# Tee e rating privati del Nuovo Club

Applicare una sola volta `supabase/admin-new-club-course-tees.sql` nel SQL Editor,
dopo `admin-new-club-course-holes.sql`. La migration è transazionale; non è un backfill.

Un tee è una bozza personale `new_course_tee`, figlia del Percorso privato (`route`).
Non usa il tipo `route_tee` riservato all’editor live, né estende i tipi delle versioni pubblicate.
Nome, colore facoltativo, categoria (`men`, `women`, `unspecified`), CR numerico
facoltativo, Slope intero facoltativo 55–155, stato operativo e ordine sono in allowlist.
Rating assenti restano salvabili come bozze incomplete. Ambito e Par totale si leggono
dalla struttura e dalla griglia buche corrente: nessun totale duplicato nello snapshot tee.

RPC personali, solo Admin autenticati:
- `admin_new_course_tees`: elenco/context read-only, senza creare una griglia.
- `admin_new_course_tee_save`: crea/salva con revisioni tee, Percorso e griglia attese.
- `admin_new_course_tee_archive`: archivia la sola bozza tee, conserva i dati.

I mutatori acquisiscono lock NOWAIT Club → Percorso → griglia → tee. Un indice
univoco impedisce nomi uguali (trim/case-insensitive) nella stessa categoria e nel
medesimo Percorso/ambito; categorie distinte sono consentite. Il trigger applica
ownership, identità e allowlist anche ai salvataggi workflow generici. Tee attivi
nel workflow impediscono il cambio 9/18 anche dopo l’abbandono della griglia.
Una griglia incompleta blocca creazione/salvataggio tee; elenco e abbandono restano
disponibili via RPC. Par totale diventa non disponibile finché la griglia non è valida.

Le policy/grant esistenti non cambiano; nessun DML diretto aggiuntivo.
Anon, player, service API e altri Admin non possono invocare queste RPC sulla bozza.
La lettura generale delle bozze rimane quella Admin già esistente nella fondazione.

Fuori perimetro: live/publish, distanze, import, rating giocatore, combinazioni.
Rollback operativo: non usare la nuova UI/RPC; le bozze private salvate restano
conservate. Non rimuovere il tipo finché esistono righe `new_course_tee`.
