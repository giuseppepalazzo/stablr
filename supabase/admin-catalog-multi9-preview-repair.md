# Multi-9: riallineamento della preview

## Evidenza e causa

Letture del 9 ottobre 2026, senza scritture remote:

- la UI Admin autenticata riceve `candidates: []`, `excluded: []` dalla
  `admin_catalog_multi9_batch_preview`;
- `admin_catalog_multi9_club_preview(p_club_id)` restituisce HTTP 404,
  `PGRST202`, anche alla stessa sessione Admin;
- i record pubblicati di Parco De’ Medici hanno tre componenti 9 completi,
  27 buche fisiche e quattro combinazioni ufficiali 18 con riferimenti esatti;
- in PostgreSQL isolato, questi stessi record riproducono `0 / 0` con la
  vecchia scoperta basata sulle strutture già classificate. Il contratto di
  proposta per club restituisce invece il candidato corretto, senza strutture
  preliminari e senza scrivere alcuna riga.

Il contratto esposto da produzione/PostgREST non è quindi allineato a quello
club-proposals presente nel repository. Le API non consentono di distinguere
definizione SQL non allineata da cache non allineata; non si assume quale dei
due sia la causa del disallineamento e non si richiede di rieseguire SQL storico.

## Applicazione manuale

Prerequisiti: fondazione Fasi 1–3c, lock per club e multi-9 già applicati.
Non rieseguire alcuno script storico, incluso club-proposals.

Nel SQL Editor del progetto STABLR:

1. Aprire una nuova query e incollare integralmente
   `supabase/admin-catalog-multi9-preview-repair.sql`.
2. Eseguire una sola volta, dall’inizio `BEGIN` al `COMMIT` incluso.
3. Lo script ripristina il contratto club-proposals già previsto e notifica
   il reload della cache PostgREST. Non registra alcun club/batch.
4. Dopo l’applicazione distribuire il frontend aggiornato; ricaricare Admin e
   usare `Prepara batch multi-9`. L’approvazione resta un’azione separata.

Un secondo tentativo fallisce e annulla l’intera transazione. Le dipendenze
obbligatorie sono controllate prima delle ridefinizioni.

## Contratto e sicurezza

La nuova RPC read-only `admin_catalog_multi9_proposal_preview(uuid[])` rende
espliciti `preview_contract: 2` e `discovery_scope: clubs_with_combinations`.
Il client richiede questa RPC, valida il contratto e mostra un errore se manca
o è incompatibile; non ripiega sulla vecchia risposta vuota.

La scoperta legge club con combinazioni reali (anche inattive/incomplete,
restituite come esclusioni motivate) oppure strutture multi-9 già presenti.
Non richiede una classificazione preesistente e non usa nomi come criterio.
I riferimenti devono risolversi esattamente con Percorso + numero locale;
Par/SI/cardinalità e collisioni restano controllati dal contratto esistente.

Le definizioni dell’ispettore e della conferma sono quelle club-proposals già
previste, senza nuove regole di scrittura. Se già installate, i corpi delle
RPC di registrazione restano identici. Sono ripristinate insieme per non
proporre baseline di tipo 2 a un vecchio endpoint che accetti solo strutture.
Restano lock per club, NOWAIT, snapshot, revisione, rollback per club,
isolamento del batch, audit/ricevute append-only e conferma esplicita.

Nessuna nuova tabella/policy, backfill o modifica dei dati all’applicazione.
Le sole scritture della conferma restano nella fondazione e nel suo audit.
Nessuna scrittura su catalogo live, tee, import, giri, bozze o versioni.
Le preview sono STABLE, senza DML. Tutte le funzioni richiedono Admin con
JWT authenticated; endpoint concessi solo ad authenticated, helper privati.
Anon, authenticated non Admin e service API sono respinti, senza fallback.

## Verifica

Fixture dei record reali solo nei test. Regressioni isolate per installazione
storica e club-proposals già applicato, candidato 3/27/4, esclusione motivata,
preview senza scritture, autorizzazioni e seconda applicazione bloccata.
La suite multi-9 esistente esegue anche la nuova migration prima dei test
di atomicità, conflitti, concorrenza e immutabilità del catalogo.
