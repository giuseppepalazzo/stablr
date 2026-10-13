# Pubblicazione atomica Nuovo Club

Applicare una sola volta `supabase/admin-new-club-publish.sql` nel SQL Editor,
dopo `admin-new-club-course-tees.sql` e le precedenti migration private.
Non rieseguire script storici. Nessuna applicazione remota è effettuata dal task.

- `admin_new_club_preview(uuid)`: solo letture, checklist e manifest minimizzato
  della bozza personale con revisioni e hash SHA-256; nessun open/create implicito.
- `admin_new_club_publish(uuid,bigint,text,text)`: Admin autenticato proprietario,
  revisione Club, hash anteprima esatta e motivazione 1–500 caratteri obbligatori.

Percorsi aperti (`route` null-live sotto il Club privato) sono attivi in questa fase;
quelli abbandonati non vengono pubblicati. Tutti i Percorsi aperti devono avere
griglia completa 9/18, Par 3–5 e SI univoci 1..N. Tutti i tee attivi devono avere
CR numerico e Slope intero 55–155; almeno un tee attivo per Percorso. Tee disattivati
possono conservare rating NULL. Ambito e Par totale sono sempre derivati sul server.

Il vincolo live esistente richiede nomi tee distinti nello stesso Percorso/ambito,
anche tra categorie diverse: l’anteprima blocca queste collisioni, senza modificare
indici/record esistenti, rinominare o accorpare tee. La categoria è salvata nel
campo live `gender` (`men`, `women`, NULL). L’ordine tee, privo di colonna live dedicata,
è conservato nel payload di provenienza e nell’audit; nessun consumer viene modificato.

Nome Club normalizzato con la stessa regola whitespace/punteggiatura del consumer
esistente; controllo duplicati include record inattivi. Fonte FIG selezionata deve
ancora esistere con UUID/identità esterna esatti e non essere già collegata. Si conserva
la provenienza acquisita e `figClubCode` come riferimento esplicito, lasciando
`fig_club_id` NULL e matching non assegnato. Nomi/città non determinano matching.

Transazione: lock NOWAIT sul Club privato e discendenti, sul record FIG selezionato,
e SHARE ROW EXCLUSIVE NOWAIT su `clubs` per proteggere duplicati/phantom anche contro
import o scrittori legacy. Hash e requisiti sono ricalcolati sotto lock. Inserimenti
espliciti in `clubs`, `course_routes`, `route_holes`, `route_tees` nuovi; nessun UPDATE
su catalogo esistente. Una versione aggregata Club e la ricevuta append-only
`admin_new_club_publications` registrano snapshot della gerarchia, autore, data,
motivo, hash e mappa bozze/live. Le versioni storiche restano immutabili.

Le bozze figlie sono archiviate con snapshot intatti, la root è chiusa come
`published`. Identità null-live e parent rimangono intatti; la mappa live è nella
ricevuta. Errori di inserimento/audit/chiusura causano rollback di ogni scrittura.
Ripetere la conferma non crea un secondo Club. Il trigger di chiusura richiede
versione/ricevuta effettive; un flag client/GUC non autorizza la pubblicazione.

Sicurezza: due RPC con grant authenticated e controllo UID/JWT/Admin/proprietario;
helper senza grant API, search_path fisso. Nessun DML API sulla nuova ricevuta,
lettura RLS solo Admin autore, eventi/versione immutabili anche UPDATE/DELETE/TRUNCATE.
Anon, player, service API e altri Admin non invocano il contratto personale.

Fuori perimetro: nuove combinazioni, distanze, backfill, fondazione fisica,
classificazioni tee, import, giri, app giocatore, rollback distruttivo di un Club
già pubblicato. Un errore prima del commit mantiene tutte le bozze riapribili.

Test manuale iniziale: bozza fittizia → Percorso completo → tee attivo con CR/Slope
→ salva → checklist → Anteprima pubblicazione. Verificare conteggi, Par/SI, totale
e tee. **Chiudere l’anteprima senza premere Pubblica Club**; nessun record live.
