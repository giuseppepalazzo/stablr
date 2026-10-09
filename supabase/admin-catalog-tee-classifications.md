# Classificazione isolata del Par totale tee

Applicare una sola volta, integralmente nel SQL Editor, il nuovo
`supabase/admin-catalog-tee-classifications.sql`. Prerequisiti: fondazione fisica
Fasi 1–3c e multi-9, lock per club, RPC minimizzata `admin_catalog_data_origin`
contratto v2. Se non ancora applicata, applicare prima la migration corretta
`admin-catalog-data-origin.sql`; non rieseguire SQL storico già applicato.
Questo task non applica SQL remoto.

## Contratto

Due tabelle nuove: `admin_catalog_tee_classifications` (una decisione corrente per
tipo `route_tee` / `combination_tee` e UUID esatto) e
`admin_catalog_tee_classification_events` (audit append-only). Nessun backfill:
assenza di riga = attestazione e comportamento sconosciuti, senza scritture.

La classificazione riguarda solo **Par totale**, non certifica CR/Slope. Dimensioni
indipendenti: attestazione `certificato / curato / sconosciuto`; comportamento
`derivato / richiede_revisione / sconosciuto`; provenienza separata. Un valore
uguale, la fonte FIG, il nome, il colore o una combinazione non classificano nulla.
Anche certificato + derivato richiede scelta ed evidenze esplicite.

L'Admin dichiara ambito 9/18 e applicabilità (NULL = non dichiarata). Non si modifica
il live e non si inventa un genere NULL. Se il live dichiara già ambito/genere,
la decisione deve concordare. Ambito live NULL non diventa automaticamente una
decisione: va scelto e documentato.

Certificato richiede un riferimento documentale specifico, il Par non NULL di quel
tee, ambito e applicabilità dichiarati, provenienza e nota. Il documento viene
attestato **manualmente dall'Admin**, non scaricato/verificato automaticamente.
Curato richiede riferimento a decisione Admin, nota e valori concordanti, anche
per un Par live assente. Sconosciuto non può dichiarare evidenze attestanti.

Derivato richiede una configurazione verificata collegata al genitore esatto del
tee, con ambito corrispondente e regola `sum_configuration_effective_par` selezionata
esplicitamente. Si sommano i Par effettivi delle occorrenze, preservando gli override
di configurazione espliciti; non si aggiornano Par/SI. Si rivalidano cardinalità,
identità/link verificati, sorgenti correnti, padre e componenti/revisioni.
Il Par tee non NULL deve corrispondere al totale; NULL è rappresentabile senza
riempirlo. Matrici tee non associate e override Par tee impediscono questa regola:
nessun matching da nome/colore e nessun appiattimento. Nessuna classificazione
attiva un blocco negli editor o un comportamento giocatore.

## Letture, conferma e sicurezza

Quattro RPC Admin-only:

- `admin_catalog_tee_classification_list(uuid)`;
- `admin_catalog_tee_classification_detail(uuid,text,uuid)`;
- `admin_catalog_tee_classification_preview(uuid,text,uuid,jsonb,bigint)`;
- `admin_catalog_tee_classification_confirm(uuid,text,uuid,jsonb,bigint,jsonb,boolean)`.

Le prime tre sono STABLE/read-only. Preview non salva proposte. Confirm richiede
nota, consenso esplicito, revisione attesa (0 se assente) e baseline della preview.
Lock per club READ COMMITTED e lock SHARE NOWAIT sulle dipendenze proteggono anche
editor/import che non usano il lock club e inserimenti phantom. Controllo base dopo
lock; errori, compreso audit fallito, annullano tutta la decisione. I lock sono
conservativi: durante la breve conferma possono bloccare scritture di altri club.

SECURITY DEFINER, search_path pg_catalog e controllo UID/JWT authenticated/Admin;
EXECUTE solo authenticated sulle quattro RPC, nessuno sui helper. RLS consente
solo lettura Admin sulle due nuove tabelle; nessun DML diretto. Anon, player, UID
assente e service API respinti. DELETE/TRUNCATE delle classificazioni e qualsiasi
riscrittura/rimozione degli eventi sono vietati. Nessuna policy esistente cambia.

Risposte costruite con allowlist: metadati tee/genitore, evidenza strutturata
specifica, campi della decisione, autori indicati come Admin corrente/altro Admin,
date e revisioni. La baseline contiene scalari tecnici e impronte server-side;
mai source_payload, snapshot delle sorgenti/editor, basi delle bozze, utenti/email,
JSON arbitrari o payload completi. L'audit conserva Prima/Dopo solo della decisione;
non duplica i payload live.

## Obsolescenza, compatibilità e rollback

Nessuna FK verso tee/catalogo/configurazioni/sorgenti: gli import possono eliminare
e ricreare i record senza nuovi impedimenti. Un UUID scomparso resta nello storico
come `target_missing`; nessuna adozione del nuovo UUID. Se sorgente, rating/Par,
ambito, applicabilità, griglia o configurazione/base cambiano, la lettura restituisce
`obsolete` e valori effettivi sconosciuti, senza modificare la decisione registrata.
Il ritorno esatto alla baseline può renderla nuovamente corrente: il confronto è
tecnico, non una revisione automatica. Una nuova conferma manuale crea un evento e
incrementa la revisione; nessuna cancellazione dello storico.

Scritture solo nelle due tabelle nuove. Nessuna modifica a tee, CR/Slope, distanze,
catalogo/griglie, import, giri, bozze/versioni, consumer o editor live. La UI è un
blocco dedicato dentro Avanzata → Struttura e collegamenti: consultazione volontaria,
filtri indipendenti, dettaglio baseline/evidenza/storico e preview/conferma manuale.
Nessuna voce sidebar, batch, pubblicazione Par o propagazione.

Rollback operativo: nascondere il nuovo blocco o revocare EXECUTE su confirm;
conservare classificazioni e audit. Correggere decisioni tramite revisioni nuove.
Prima dell'applicazione nessuna riga; errori nella migration fanno rollback, una
seconda applicazione fallisce atomicamente. Nessun rollback dei dati live necessario.

Test SQL isolati via PGlite, senza rete/produzione; controllano autorizzazioni,
baseline/CAS, conferma, fonte generica insufficiente, derivazione 9/18 e multi-9,
obsolescenza/recreazione UUID, audit immutabile/atomico e assenza di scritture live.
Il CAS tra due Admin è testato sequenzialmente; NOWAIT/lock sono nel contratto SQL,
PGlite non simula sessioni PostgreSQL indipendenti.
