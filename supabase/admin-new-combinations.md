# Nuove combinazioni 18 in Club pubblicati

## Applicazione manuale

Eseguire **una sola volta** l'intero `supabase/admin-new-combinations.sql`, inclusi
BEGIN/COMMIT. Prerequisiti: workflow, editor Route e abbandono, bozze tee private
(`admin-new-club-course-tees.sql`), publisher Nuovo Club, nuovi Percorsi nei Club
esistenti, `admin-combination-tee-crud.sql` (ordine tee dedicato) e fondazione multi-9
completa, incluso `admin-catalog-structure-club-lock.sql`.
Non riapplicare SQL storici. Nessuna applicazione remota o pubblicazione reale
è effettuata dai test.

## Perimetro e UX

Club → **Aggiungi combinazione** → nuova bozza personale o ripresa → nome,
prime/seconde nove selezionate esplicitamente → SI propri → tee/rating privati →
Salva bozza → Anteprima pubblicazione → Pubblica combinazione → motivazione e
conferma finale. Uscita protetta, salvataggio/ripresa e abbandono non distruttivo
riusano il workflow; rimuovere un tee dalla bozza non tocca mai tee pubblicati.

Il contratto live resta quello attuale: 18 buche, due Percorsi distinti, una
sola combinazione per coppia ordinata anche se inattiva. Nessuna modifica di
indici o vincoli live. Le sezioni disponibili sono esclusivamente configurazioni
9 `multi9_9` verificate nella stessa struttura `multi_9`, con link fisici esatti,
attivi e allineati. Sezioni non compatibili o mutate sono escluse con spiegazione.
9, 9×2, sezioni senza contratto verificato e composizioni fra strutture diverse
restano fuori perimetro, non vengono simulate o ricostruite.

Par: ereditato dalle 18 identità fisiche selezionate, totale ricalcolato dal server.
SI: input esplicito, nessuna copia/calcolo dalle nove origine; per pubblicare è
richiesta la permutazione completa 1..18. SI sorgente è conservato separatamente.
Tee: nome, colore, categoria, ordine, stato, CR e Slope; normalizzazione e validazione
riusano il contratto tee privato. Nomi distinti anche fra categorie per rispettare
l'indice live; almeno un tee attivo, CR finito e Slope intero 55..155 per tutti i
tee attivi. Ambito 18 e Par totale sono derivati, mai accettati dal client.
Nessun rating, distanza o override tee viene dedotto dalle origini.

## Contratto e sicurezza

RPC authenticated Admin: `admin_new_combinations`, `admin_new_combination_save`,
`admin_new_combination_preview`, `admin_new_combination_publish`.
Abbandono: `admin_catalog_archive_draft(..., 'route_combination', revisione)`.
Helper privati senza grant API; SECURITY DEFINER con search_path pg_catalog,
UID/JWT/Admin attuale, proprietà e allowlist rigorose. Nessun nuovo tipo workflow:
bozza `route_combination` null-live, snapshot unico con SI e tee privati.
Nessun DML API diretto sulle ricevute, append-only con protezione UPDATE/DELETE/TRUNCATE.

List/preview soltanto lettura. Il salvataggio richiede hash server delle sezioni,
revisione attesa e non effettua rebase automatici. La pubblicazione richiede hash
dell'anteprima esatta e nota; lock transazionale del Club, lock NOWAIT su bozza e
tabelle sorgente/fondazione impediscono scritture e phantom concorrenti.
Controlli ripetuti sotto lock; anche errori di audit/versione/chiusura fanno rollback
dell'intera operazione. Nessuna scrittura su Club, Percorsi, buche fisiche, tee,
combinazioni preesistenti, import, giri o snapshot storici.

La sola conferma crea `route_combinations`, 18 `route_combination_holes`, i nuovi
`combination_tees`, configurazione/components/slot verificati nella fondazione,
audit append-only, versione iniziale e ricevuta `admin_new_combination_publications`;
chiude infine la sola bozza sorgente. Par ereditato e SI propri restano distinti.
Le classificazioni Par dei nuovi tee non vengono inventate: restano sconosciute
fino a un'approvazione separata nel workflow esistente. Una successiva pubblicazione
Par fisico continua quindi ad applicare i suoi blocchi reali.

## Player, recupero e test UX

Nessun consumer modificato: il player già carica le combinazioni attive e i relativi
tee 18 per UUID. La nuova combinazione compare solo dopo commit completo e il
successivo caricamento catalogo. Nessuna proiezione distanze/SI tee è precompilata.
La versione iniziale mantiene il contratto metadati dell'editor Route; la ricevuta
immutabile conserva l'intera anteprima di creazione con buche, tee e origini.

Prima della pubblicazione: abbandonare la bozza. Un errore di conferma annulla tutto.
Dopo una pubblicazione reale: correggere con gli editor esistenti, non eliminare
record/versioni/ricevute; nessun rollback distruttivo automatico.

Test UX minimo dopo SQL: Club con sezioni multi-9 già verificate → Aggiungi
combinazione → scegliere una **coppia ordinata non ancora pubblicata**, nome, SI
1..18 e tee con CR/Slope reali → salva, esci/riprendi → anteprima: verificare
ordine, Par ereditato, SI, tee, assenza modifiche a record esistenti → chiudere
senza pubblicare dati fittizi. Soltanto su una combinazione reale autorizzata,
confermare con nota e verificare selezione/tee 18 nel player dopo ricaricamento.
