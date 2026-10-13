# Nuovi Percorsi nei Club esistenti

Applicare una sola volta l’intero `supabase/admin-existing-club-new-courses.sql`,
inclusi BEGIN/COMMIT, dopo `admin-new-club-publish.sql` e tutti i suoi prerequisiti.
Non riapplicare o modificare SQL storici. Nessuna applicazione remota avviene nel task.
Prerequisiti già presenti nel flusso Nuovo Club: workflow/editor Club e abbandono
bozze, `admin-new-club-courses.sql`, `admin-new-club-course-holes.sql`,
`admin-new-club-course-tees.sql`, `admin-new-club-publish.sql`, sul catalogo
con colonne sorgente/FIG-WHS. Se già applicati, eseguire solo il nuovo script.

## Flusso

Riepilogo Club → **Aggiungi percorso** → elenco personale dei nuovi Percorsi.
Nome, struttura 9/18 e ordine → Salva bozza → Configura buche → Gestisci tee →
Anteprima pubblicazione → motivazione → conferma finale.
L’elenco, la ripresa e la preview leggono soltanto. Il primo salvataggio crea
un contesto personale e il Percorso privato, senza un Club fittizio o una bozza
dei metadati del Club pubblicato. Nessun record live viene creato fino alla conferma.
Uscita protetta e abbandono conservano gli snapshot; gli altri Percorsi restano intatti.

## Contratto

`admin_existing_club_course_contexts` associa in modo immutabile un contenitore
workflow `course` null-live al UUID esatto del Club e all’Admin. I figli `route`,
griglia privata e tee riusano le bozze già presenti. Il contenitore non è un
Percorso live e non è modificabile tramite saver/archiver generici.
La sola estensione dell’helper parent riconosce questi contenitori registrati,
con proprietà/snapshot/stato verificati. Non amplia tipi workflow o autorizzazioni.
Un trigger specifico protegge identità, allowlist, revisioni e chiusura dei figli.

RPC: `admin_existing_club_courses`, `admin_existing_club_course_save`,
`admin_existing_club_course_archive`, `admin_existing_club_course_preview`,
`admin_existing_club_course_publish`. Tutte Admin authenticated con UID,
controlli personali, search_path fisso e nessun grant helper. RLS sola lettura
personale sulle due tabelle nuove; nessun DML API, nemmeno service role.

Ogni pubblicazione riguarda un solo Percorso. Server: Club attivo e già giocabile,
nome non duplicato nello stesso Club (anche record inattivi), griglia completa
9/18, Par 3–5, SI permutazione 1..N, almeno un tee attivo con CR finito e Slope
intero 55–155. Par totale e ambito tee sono derivati dalla griglia. Tee inattivi
possono conservare CR/Slope NULL. Nomi tee distinti anche fra categorie per
rispettare il vincolo live corrente; ordine tee conservato nel payload/audit.
Un Club non giocabile può avere bozze, ma la preview blocca la pubblicazione:
questa task non ne cambia automaticamente stato o visibilità.

Conferma: revisione, hash dell’anteprima esatta e nota 1–500 caratteri. Lock
NOWAIT su contenitore, Percorso/figli, Club live e riserva di scrittura su
`course_routes` per impedire duplicati/phantom anche da import legacy. Advisory
lock transazionale per Club fra queste RPC; tutti i requisiti vengono riletti
sotto lock. Un errore annulla l’intera transazione, anche dopo audit/versione.

Solo INSERT nei nuovi `course_routes`, `route_holes`, `route_tees`. Nessun UPDATE
su Club, Percorsi preesistenti, import, combinazioni, fondazione, classificazioni,
giri o snapshot. Una versione iniziale `route` e una ricevuta immutabile
`admin_existing_club_course_publications` conservano gerarchia, mapping, autore,
nota/data/hash. Tee/griglia sono archiviati con snapshot intatti; Percorso bozza
chiuso `published`, pubblicabile solo in presenza di versione e ricevuta reali.
Le altre bozze nello stesso contenitore non vengono chiuse o modificate.

## Limiti e recupero

Nessun collegamento FIG/GesGolf/fisico automatico, nuova combinazione, distanza,
override SI tee o modifica al player. Fonte nuova `stablr`; tutti i riferimenti
e stati del Club restano invariati. Il catalogo Admin aggiorna riga e conteggi
dopo la ricevuta; l’app continua a usare i propri consumer live esistenti.

Prima della conferma: abbandonare il singolo Percorso; nessun rollback live.
Dopo la pubblicazione: non eliminare ricevute/versioni o usare rollback distruttivi;
correggere con gli editor live esistenti. Nessun ripristino automatico di un Club.

Test manuale minimo dopo SQL: Club esistente giocabile → Aggiungi percorso →
crea bozza 9/18 → griglia valida → tee attivo CR/Slope → riapri dal Club →
Anteprima pubblicazione. Verifica totale/ambito e chiudi senza pubblicare dati fittizi.
L’eventuale conferma reale è un’azione separata esplicita dell’Admin.
