# RPC metadati: conflitti applicativi senza retry server

Applicare una sola volta `supabase/admin-catalog-metadata-conflict-errors.sql`,
**dopo** `admin-catalog-editor-metadata.sql`, già applicato. Non rieseguire gli
script storici. Nessuna modifica a dati, RLS, timeout o Keep Alive.

## Causa e perimetro

Le condizioni permanenti «Bozza cambiata o chiusa» e «Base live o versione cambiata»
usano SQLSTATE `40001`. PostgREST 14 può ritentare internamente la transazione per
questo codice: una sola richiesta può produrre molti errori, rollback e `set_config`,
anche dopo il timeout del browser. Non è un timer React. La versione remota e i PID
effettivamente coinvolti richiedono conferma dai log Supabase.

Riferimento ufficiale:
https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b

La migration conserva l'implementazione originale come helper privato e converte
`40001` in `PT409` (HTTP 409) al solo confine `admin_catalog_metadata`.
Messaggio, controlli Admin/proprietà, revisioni, fingerprint, hash, note, lock NOWAIT
e rollback restano invariati. Nessun retry/rebase/archivio automatico. Il browser
riconosce entrambi i codici durante il rilascio. Gli altri endpoint non cambiano:
anche il workflow nuove combinazioni contiene messaggi simili, ma senza CONTEXT
remoto non gli si attribuisce l'incidente osservato.

## Verifica operativa successiva (non eseguita da questo intervento)

Confrontare, in un'unica verifica log, versione PostgREST, `process_id` e CONTEXT
dei `40001` con metodo/endpoint e conteggio delle richieste API nello stesso
intervallo. Non servono token, parametri RPC o payload.

**L'applicazione dello SQL non garantisce di interrompere worker già in loop.**
Supabase prescrive di identificarli tramite PID e fermarli separatamente, oppure
riavviare il progetto. Nessuna terminazione o riavvio è inclusa/autorizzata qui:
richiede un successivo intervento operativo esplicito. Non aumentare i timeout.

Un conflitto successivo deve tornare prontamente come HTTP 409, senza pubblicazione
né incremento continuo degli errori a parità di richieste HTTP. Misurare nuovamente
CPU/errori dopo la rimozione dei worker precedenti; non attribuire preventivamente
l'intero carico del catalogo a questo solo problema.
