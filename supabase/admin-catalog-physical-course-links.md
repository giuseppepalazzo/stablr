# Fase 3a — Percorso sorgente e identità fisiche

## Applicazione manuale

Prerequisiti: fondazione fisica e revisione strutture già applicate
(`admin-catalog-physical-foundation.sql` e `admin-catalog-structure-review.sql`).
Nel SQL Editor eseguire **una sola volta l'intero contenuto** di
`supabase/admin-catalog-physical-course-links.sql`, inclusi `BEGIN` e `COMMIT`.
Non riapplicare gli script precedenti. Nessun backfill: l'applicazione non crea
strutture, buche o collegamenti reali e non riclassifica record esistenti.

## Contratto e autorizzazioni

- `admin_catalog_physical_course_links` conserva il Percorso sorgente esatto,
  uno snapshot del Percorso e delle sue buche, nota, autore, revisione e stato
  `needs_review` / `verified`. Un Percorso non può essere associato a due strutture.
- Tre colonne nullable in `admin_catalog_physical_holes` conservano il collegamento
  sorgente, l'UUID esatto di `route_holes` e la posizione. I record precedenti
  mantengono questi campi NULL. Identità, numero e Par base vengono registrati
  soltanto alla conferma Admin; non viene copiato alcun SI fisico.
- L'allowlist degli eventi della fondazione comprende anche la nuova tabella.
  Creazione e verifica producono eventi append-only nella stessa transazione.
- RLS consente SELECT solo ad Admin autenticati; nessuna scrittura diretta API.
  Le tre RPC pubbliche sono `SECURITY DEFINER`, con `search_path` fissato,
  autorizzazione Admin esplicita e nessun accesso anon/player/service API:
  - `admin_catalog_physical_course_preview`: lettura, senza selezione automatica;
  - `admin_catalog_physical_course_register`: conferma, nota, revisione struttura
    e snapshot sorgente attesi; crea tutte le identità e un collegamento da revisionare;
  - `admin_catalog_physical_course_verify`: seconda conferma, nota, revisione
    collegamento e mapping attesi; verifica soltanto il collegamento 1:1.
- Due helper privati (`source`, `inspect`) non sono invocabili dai ruoli API.
  Gli audit conservano autore server e prima/dopo; record verificati sigillati.

## Controlli e limiti

La sorgente deve essere un Percorso attivo dello stesso club attivo. La struttura
deve essere già verificata manualmente: `fisico_9` accetta 9 buche, `fisico_18`
18, `multi_9` un singolo Percorso da 9. Cardinalità completa, numeri distinti
e consecutivi e Par 3–6 sono obbligatori. I metadati espliciti di derivazione
noti bloccano la registrazione; non viene dedotta alcuna corrispondenza da nome,
Par, posizione o somiglianza.

I numeri sorgente sono preservati: 1–9 / 1–18; per `multi_9` anche 10–18 se già
presenti così. Più Percorsi con numeri 1–9 sovrapposti nella stessa struttura
restano bloccati: questa fase non assegna offset né introduce una numerazione
alternativa. Identità già presenti non vengono unite o riutilizzate implicitamente.

Registrazione e verifica bloccano concorrenti modifiche alla sorgente durante
la transazione (lock NOWAIT, nessun DML live). Un cambiamento dello snapshot
sorgente, anche dei suoi metadati/SI, richiede nuova revisione e blocca la verifica:
nessun aggiornamento silenzioso della base. Un errore, incluso nell'audit, annulla
l'intera operazione. Nessun mapping viene verificato automaticamente alla creazione.

Le FK verso `course_routes`, `route_holes` e autori sono riferimenti `RESTRICT`,
senza cascade o aggiornamenti live: una sorgente utilizzata non può essere
eliminata fisicamente. Le sole modifiche ai dati sono nella fondazione e audit.
Nessun consumer giocatore, import, giro, bozza o versione viene modificato.

## Rollback e fuori perimetro

Prima dell'applicazione non occorre rollback. Dopo l'applicazione si può
disabilitare l'accesso alla nuova UI/RPC e lasciare la fondazione inutilizzata:
i consumer esistenti non la leggono. Non rimuovere automaticamente strutture,
collegamenti, identità o audit; dopo registrazioni reali un'eventuale dismissione
richiede un piano esplicito che conservi le evidenze e gestisca i riferimenti.
Non viene fornito uno script DROP distruttivo.

Restano fuori fase: configurazioni giocabili, 18 ripetute, prime/seconde nove,
combinazioni, override, propagazione, modifica Par fisico, riconciliazione di
sorgenti cambiate o numerazioni sovrapposte. Nessuna RPC precedente viene ridefinita.

## Verifica isolata

`scripts/tests/admin-catalog-physical-course-links.test.mjs` esegue lo SQL in
PostgreSQL/WASM (PGlite), solo con fixture. Verifica autorizzazioni, revisione,
conferme distinte, vincoli, rollback, audit e conservazione di catalogo, giri,
bozze/versioni e sicurezza preesistenti. I test UI coprono anteprima senza
scritture, conferme, ripresa, sorgenti incompatibili e audit visibile.
