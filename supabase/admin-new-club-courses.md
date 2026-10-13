# Percorsi privati di un nuovo Club

Applicare una sola volta `supabase/admin-new-club-courses.sql` nel SQL Editor,
dopo workflow, Club editor e abbandono bozze già presenti. Nessuna applicazione
remota viene eseguita dal repository.

Ogni Percorso è una riga `admin_catalog_drafts`, tipo `route`, con
`live_entity_id = NULL`, `parent_draft_id` riferito alla bozza Club privata dello
stesso Admin, senza base/versione pubblicata. Lo snapshot contiene esclusivamente
nome obbligatorio, `holes_count` 9/18 e ordine intero. La selezione FIG del Club
non genera Percorsi automaticamente.

Le RPC `admin_new_club_courses`, `admin_new_club_course_save` e
`admin_new_club_course_archive` richiedono JWT authenticated e Admin corrente;
verificano la proprietà della bozza Club e della bozza Percorso. Creazione,
salvataggio e abbandono serializzano sul Club con lock NOWAIT, e gli aggiornamenti
richiedono la revisione del Percorso. Un trigger limitato a questi figli protegge
anche gli accessi tramite workflow generico. Nessun nuovo grant DML o policy.

Salvare il Percorso salva solo il figlio; i dati generali Club si salvano con
la propria CTA. Uscita e ritorno dalla modifica chiedono Salva / Scarta / Resta.
Abbandonare un Percorso lo archivia senza cancellarlo. Abbandonare il Club
mantiene i figli conservati ma inaccessibili alle RPC dedicate, perché il padre
non è più aperto. Nessuna versione pubblicata fittizia viene creata.

Fuori perimetro: live, pubblicazione, buche, tee/rating, import e app giocatore.
Club e figli restano incompleti, privati, non pubblicabili e non giocabili.

Rollback: rimuovere l'accesso UI e i grant delle sole tre RPC nuove, conservando
le bozze. Non eliminare i figli o riapplicare migration storiche. I consumer live
non dipendono da queste bozze.

Test manuale: aprire una bozza Club (manuale o FIG), aggiungere un Percorso 9/18,
salvarlo, uscire e riprendere il Club; rinominare/riordinare il Percorso e provare
Resta/Scarta. Confermare l'abbandono del solo Percorso; il Club resta disponibile
e nessun elemento nuovo compare nel catalogo pubblicato.
