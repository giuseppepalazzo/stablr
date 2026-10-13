# Buche di un Percorso privato

Applicare una sola volta `supabase/admin-new-club-course-holes.sql`, dopo
`admin-new-club-courses.sql` e le migration degli editor buche live già presenti.
Nessuna applicazione remota dal repository.

La griglia è una bozza `new_course_holes_grid` in `admin_catalog_drafts`, figlia
del Percorso privato `route`, a sua volta figlio del nuovo Club dello stesso Admin.
Live/base/versione restano NULL. Le bozze/versioni e gli editor live non acquisiscono
questo nuovo tipo pubblicabile; nessuna tabella live viene letta o modificata.

`Configura buche` crea/riprende una sola griglia attiva con tutti i numeri 1–9 o
1–18, Par/SI inizialmente NULL. Le RPC open/save/archive serializzano sul Club e
Percorso con NOWAIT. Save e archive verificano revisione della griglia e del
Percorso. Il trigger dedicato protegge proprietà, schema, identità e domini anche
tramite il salvataggio generico. Anon/player/service non possono invocare le RPC;
restano invariati grant DML e policy delle tabelle esistenti.

Snapshot: `holes_count`, `holes[]` con `physical_hole_number`, `par`,
`stroke_index`. Numero/ordine sono immutabili; Par solo 3/4/5 oppure NULL nella
bozza incompleta; SI intero 1–9 o 1–18 oppure NULL. Il salvataggio parziale,
anche con SI duplicati, è consentito ma non produce lo stato configurato.
Il Percorso ha **buche configurate** solo con griglia completa, tutti i Par e
permutazione SI esatta 1..N. Il totale è calcolato, mai memorizzato come dato live;
la UI distingue totale parziale. Tee/rating e pubblicazione restano fuori fase.

Abbandona bozza buche archivia l'intera griglia mantenendo snapshot e revisione;
il Percorso rimane privato. La successiva apertura crea una nuova griglia vuota.
Una griglia attiva impedisce cambiamenti 9/18: abbandonarla esplicitamente prima
di cambiare struttura. Nome/ordine rimangono modificabili. Padre archiviato:
griglia conservata e non modificabile, senza archivio/cancellazione automatica.

RPC: `admin_new_course_holes_summaries` (lettura), `admin_new_course_holes_open`,
`admin_new_course_holes_save`, `admin_new_course_holes_archive`. Tutte richiedono
Admin autenticato e proprietario del Club/Percorso/griglia; risposte limitate al
suo albero privato. Nessun collegamento FIG automatico e nessuna versione fittizia.

Rollback: disabilitare l'accesso UI e revocare le sole RPC nuove, mantenendo le
bozze e il nuovo tipo/constraint. Non eliminare lo storico o riapplicare vecchi SQL.

Test manuale: aprire una bozza Club, selezionare un Percorso 9/18, Configura buche;
compilare Par/SI, salvare, uscire e riprendere. Provare un SI duplicato: resta da
completare. Correggerlo: buche configurate, sempre privato. Confermare abbandono
della griglia e verificare che il Percorso rimanga e la nuova griglia sia vuota.
