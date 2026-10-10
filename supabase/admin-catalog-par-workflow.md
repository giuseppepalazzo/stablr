# Workflow Par sicuro

Applicare **una sola volta**, manualmente nel SQL Editor, l’intero
`admin-catalog-par-workflow.sql`, dopo `admin-catalog-physical-par.sql` e
`admin-catalog-physical-par-source-drafts.sql` e le rispettive dipendenze.
La migration è transazionale, non contiene backfill o DML catalogo e fallisce
senza modifiche parziali se già applicata o se il contratto precedente differisce.
Applicare SQL prima di distribuire la nuova UI. Nessun SQL remoto è eseguito dagli script di test.

## Perimetro

- La preview globale legge tutti i Percorsi e combinazioni, inclusi gli esclusi.
  Valida cardinalità completa 9/18, numerazione, Par 3–6, SI distinti 1–18,
  totale, riferimenti esatti e fondazione. Non crea strutture/collegamenti.
- Senza padre/relazione fisica dichiarata: abilitazione autonoma locale, senza
  ipotizzare ereditarietà da nomi, Par, posizione o offset.
- Con sorgente fisica verificata: publisher fisico esistente. Le stesse righe
  del 9×2 non possono ricevere override locali del solo 18.
- Una configurazione verificata con righe live indipendenti può creare
  esplicitamente un override locale. Interrompe l’ereditarietà soltanto dello
  slot interessato e preserva identità, ordine, occorrenza, SI e snapshot originari.
- Matrici tee ambigue, griglie incomplete, sorgenti mutate e riferimenti
  non verificati restano esclusi/bloccanti. Un legame assente non viene inventato.

## Batch e UI

Avanzata → Struttura e collegamenti → **Prepara batch Par**. Una nota e una
conferma approvano abilitazioni e le sole proposte tee `curato + derivato`
con configurazione fisica già verificata e ambito esatto. Uguaglianza del Par
è un controllo di coerenza successivo al legame, non una prova di origine.
I tee non dimostrabili restano sconosciuti e bloccano la pubblicazione interessata.

L’abilitazione non certifica la pubblicabilità: ogni bozza ricontrolla le basi.
Nel dettaglio club, **Par configurazioni** apre le modifiche locali/override;
**Apri buche fisiche verificate** mantiene il publisher ereditario.
Gli editor griglia originari continuano a gestire SI; non possono pubblicare
Par, nemmeno cambiamenti compensati a totale invariato. Le loro bozze restano
intatte: nessuna archiviazione, eliminazione o rebase automatico.

## Tabelle e RPC

- `admin_catalog_par_targets`: decisioni di abilitazione immutabili/versionate
  dalla topologia esatta, autore, nota e data. Nessuna FK live/adozione di nuovi UUID.
- `admin_catalog_par_workflow_batches`: ricevuta append-only per hash proposta.
- `admin_catalog_local_par_drafts`: bozze personali con revisione/base e capacità
  transazionale privata `publishing` per il singolo slot.
- `admin_catalog_local_par_versions`: Prima/Dopo, diff, nota/autore/data e seal
  immutabile; non riscrive registrazioni, versioni catalogo o giri precedenti.

RPC pubbliche: `admin_catalog_par_workflow_preview/confirm`,
`admin_catalog_local_par_list/open/save/publish/abandon`.
Solo JWT `authenticated` con UID di un Admin attuale; anon, player e service
API respinti. RLS attiva, nessun grant diretto sulle quattro tabelle, helper privati,
`SECURITY DEFINER` con `search_path=pg_catalog`. Nessuna risposta raw/source payload.

Preview senza scritture; confirm ricostruisce i candidati sotto lock per club,
con subtransazione per club: errore → rollback di abilitazioni, classificazioni,
audit e ricevute di quel club. Gli altri club validi restano confermati nella
stessa transazione. Retry identico restituisce la stessa ricevuta; altro autore
o nota non può riusare l’approvazione. Hash anti-concorrenza, non certificazione.

La pubblicazione locale blocca live, tee, foundation e bozze pertinenti con
NOWAIT; verifica proprietà, revisione, base e allowlist. Aggiorna atomicamente
un Par, il totale della sola configurazione, eventuale slot override e i soli
tee derivati correnti. Tee sconosciuti/da revisionare/obsoleti, override tee non
coperti o bozze realmente modificate sovrapposte bloccano senza scritture.
SI, CR/Slope, distanze, altre entità, giri e snapshot non vengono aggiornati.

Le pubblicazioni fisiche controllano solo il componente esatto di dipendenza,
senza ignorare riferimenti live esatti non coperti. Le bozze locali realmente
sovrapposte bloccano anche il publisher fisico; quelle vuote o indipendenti no.
Una combinazione senza padre verificato che cita la sorgente fisica resta
bloccante finché il batch non approva esplicitamente la sua autonomia; dopo
approvazione viene mostrata fra le configurazioni autonome escluse, senza
propagazione o cambiamento dei suoi totali. La sola presenza del riferimento
live non la trasforma automaticamente in una configurazione ereditaria.

## Rollback

Prima di approvare batch: ignorare la UI/tabelle nuove; nessun live è cambiato.
Una decisione non viene cancellata. Dopo pubblicazioni, ripristinare valori
tramite una nuova bozza e pubblicazione compensativa con le stesse verifiche;
mai riscrivere versioni o ripristinare il DB con SQL distruttivo.
Non rimuovere la migration dopo pubblicazioni/override: ripristinare prima
gli effetti con un contratto compensativo verificato. Nessun consumer giocatore
legge le nuove tabelle; resta il medesimo catalogo live.

Test PostgreSQL/PGlite isolati e PostgreSQL nativo con due connessioni coprono
Admin-only, assenza DML preview/batch live, CAS, rollback tardivo, retry,
9×2, intervalli Fiuggi e riferimenti esatti multi-9 Parco De’ Medici.
Le fixture sono soltanto nei test; la preview reale è sempre eseguita dall’Admin,
mai simulata nel browser con queste fixture.
