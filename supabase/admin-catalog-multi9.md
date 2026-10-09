# Multi-9: fondazione e approvazione batch

Applicare manualmente, **una sola volta e in questo ordine**, integralmente nel
SQL Editor, dopo le migration della fondazione Fasi 1–3c già applicate:

1. `supabase/admin-catalog-structure-club-lock.sql`.
2. `supabase/admin-catalog-multi9.sql` (versione aggiornata, mai applicata prima).

Entrambi contengono BEGIN/COMMIT; nessun backfill o record pilota viene inserito.
Il secondo script rifiuta l'applicazione se manca il primo.
Non riapplicare o modificare gli script storici. Il codice non effettua SQL remoto.

## Contratto e criteri deterministici

- La struttura deve essere già classificata manualmente `multi_9` e verificata;
  una sola struttura multi-9 verificata per club. Nessuna classificazione batch.
- Club attivo; almeno due origini esplicite delle combinazioni ufficiali attive.
- Percorsi componenti identificati SOLO dalle FK front/back delle combinazioni:
  stesso club, attivi, 9 buche, numeri locali 1–9 univoci, Par 3–6, totale
  dichiarato coerente, nove SI distinti nell'intervallo persistente 1–18.
  Metadati espliciti di derivazione/ripetizione bloccano la sorgente.
- La chiave fisica è il collegamento al Percorso sorgente + numero locale;
  l'UUID della buca resta stabile. Vecchie identità senza origine restano tali:
  non vengono adottate/collegate e bloccano un batch ambiguo. Per fisico_9/18
  restano obbligatori un'unica origine e numeri non duplicati nella struttura.
  Il contratto storico 3a conserva anche le sorgenti esplicite numerate 10–18;
  non vengono rinumerate né incluse nel nuovo batch, che richiede 1–9.
- Ogni combinazione deve avere 18 righe ordinate 1–18 e SI 1–18 univoci;
  ogni coppia `route_id + physical_hole_number` deve risolvere esattamente una
  buca. Gli ordini espliciti front/back e route_position devono coincidere.
  Nessun nome, Par o offset viene usato per identificare una buca.
- Par ereditato solo quando uguale alla sorgente fisica e totale coerente;
  differenze richiedono un futuro contratto di override esplicito e sono escluse.
  SI delle nove/combinazioni copiato senza normalizzazione/calcoli dal live.
- Un collegamento fisico già presente è riusabile SOLO se verificato, corrente
  e identico 1:1. Configurazioni già presenti, sorgenti collegate diversamente,
  numerazioni incomplete/duplicate e strutture ambigue escludono l'intero club.
- Le nove ripetute come 18, Percorsi non referenziati e modelli non multi-9
  sono fuori perimetro. I Percorsi esclusi sono mostrati con motivazione; non
  impediscono i soli componenti ufficiali coperti. Nessun tee viene letto per
  dedurre Par/SI, appiattito o modificato.

## RPC e approvazione

Tre endpoint SECURITY DEFINER con search_path fisso, autorizzati ad authenticated
ma con controllo obbligatorio UID + JWT authenticated + is_admin:

- `admin_catalog_multi9_preview(p_structure_id)` — anteprima singolo club.
- `admin_catalog_multi9_batch_preview(p_structure_ids default null)` — proposta
  in sola lettura: tutti i multi-9 o una selezione esplicita, massimo 50 strutture.
- `admin_catalog_multi9_batch_register(p_candidates,p_reason,p_confirm)` — nota
  obbligatoria e conferma esplicita; ricostruisce e confronta ogni baseline.

Admin/Codex può preparare una proposta JSON tramite preview, senza scritture.
La UI la conserva solo in memoria: selezione club, elenco configurazioni,
anteprima mappa/Par/SI, esclusi, nota e conferma unica. Nessun batch approvato
automaticamente o in background. La conferma registra E verifica le identità,
le configurazioni 9 autonome e le 18 con due componenti ordinati verificati.

Ogni club è eseguito in una subtransazione: lock NOWAIT, snapshot sorgenti e
revisione struttura attesi. Un errore annulla tutte le righe/audit di quel club,
che compare negli esclusi; non annulla gli altri club validati. La RPC restituisce
esiti per club e salva una ricevuta immutabile in `admin_catalog_multi9_batches`.
Tutti gli esiti persistono al COMMIT della RPC (non commit separati tra club).
Il replay non crea duplicati: baseline cambiata/configurazioni presenti bloccano.

Il batch e le due RPC storiche di creazione/revisione struttura acquisiscono
prima un lock transazionale **sullo stesso club**, non solo sulla struttura
selezionata: `SELECT ... FROM clubs FOR NO KEY UPDATE NOWAIT`. È una sola riga
esistente, non una scrittura catalogo; protegge anche nuove strutture concorrenti
perché tutte le RPC autorizzate usano la stessa chiave. Nessuna scrittura diretta
API sulle strutture è autorizzata. L'unicità multi-9 viene ricontrollata sotto
lock prima delle registrazioni. Occupato: SQLSTATE `55P03`, nessuna scrittura
del club; nel batch il club è escluso e gli altri proseguono. Il lock rimane fino
al COMMIT/ROLLBACK esterno (si libera al rollback della subtransazione fallita).
`NO KEY UPDATE` resta compatibile con `KEY SHARE` delle FK dei giocatori.

Le RPC richiedono isolamento READ COMMITTED (predefinito API): REPEATABLE READ
e SERIALIZABLE vengono rifiutati con `25001`, per non riutilizzare una fotografia
precedente al lock che potrebbe nascondere strutture appena confermate.
Il nuovo helper è privato: EXECUTE revocato anche ad authenticated/service_role;
le RPC storiche mantengono firme, controllo Admin e audit già esistenti.

`admin_catalog_configuration_components` rende espliciti i due padri e le loro
revisioni. Tabelle nuove Admin-read-only via RLS, scritture esclusivamente dalle
RPC; anon/player/service API e helper privati non hanno accesso. Componenti,
ricevute e audit append-only. Nessuna scrittura su catalogo, tee, import, giri,
bozze/versioni o modifica ai consumer. Nessuna nuova colonna sulle righe già
incluse negli snapshot 3b/3c; i contratti precedenti restano invariati.

## Pilota e limiti

Parco De' Medici: il flusso può proporre tre nove (27 identità fisiche), tre
configurazioni 9 e quattro combinazioni 18, SOLO dopo classificazione manuale
della struttura e se le sorgenti superano tutti i controlli al momento della
preview/conferma. Nessun UUID/nome del pilota è hardcoded nel contratto.
Marina Velka, ripetizioni 18, multi-9 senza FK ufficiali, override Par/SI tee,
modifiche delle identità verificate e propagazione restano fuori fase.

## Rollback

Prima di registrazioni nuove è possibile progettare il rollback DDL soltanto
verificando le vecchie unicità. Dopo numeri locali coincidenti tra nove diverse,
NON ripristinare il vincolo globale né rinumerare/eliminare identità. Rollback
operativo: disattivare la nuova UI e revocare le tre RPC, mantenendo fondazione,
componenti, ricevute e audit. Nessun rollback live/giri/storico necessario.

## Test isolati

`STABLR_PGLITE_MODULE=<percorso modulo pglite> node --test scripts/tests/admin-catalog-multi9.test.mjs`
I dati Parco-shaped sono fixture del solo PostgreSQL isolato, mai seed remoti.

Per verificare anche due Admin realmente concorrenti, installare il runtime
`embedded-postgres` solo in una directory temporanea e usare:

`STABLR_EMBEDDED_POSTGRES_MODULE=<percorso embedded-postgres/dist/index.js> node --test scripts/tests/admin-catalog-multi9.test.mjs`

Questa modalità crea e arresta un cluster locale temporaneo, vincolato a
127.0.0.1, senza accettare URL remoti. Prova entrambe le direzioni della contesa,
COMMIT/ROLLBACK, isolamento dei club, unicità dopo un commit concorrente,
assenza di righe/audit parziali e compatibilità con FK KEY SHARE.
