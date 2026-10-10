# Canale FIG protetto · Actions → Edge broker → archivio

Implementazione locale; non sono stati applicati SQL, secrets, deploy o workflow.
Non è pronta per produzione finché non sono completate le configurazioni sotto
e verificato il runtime Edge. Nessun backfill, abbinamento live o classificazione.

## Contratto e confine di fiducia

Un solo nuovo workflow `tee-evidence-batch.yml`, solo `workflow_dispatch` su `main`,
con `preview` o `confirm`. Il runner usa soltanto Node built-in: non installa SDK,
non costruisce React, non esegue SQL, non carica artifact GitHub e non ha secrets
Supabase, JWT Admin, GitHub App o altre credenziali permanenti. Il token OIDC
GitHub è effimero e rimane in memoria; non viene stampato né scritto su file.
Il raw è letto esclusivamente da `data/fig/raw/fig-slope-course-rating-raw.json`
nel checkout del commit dispatch, senza input path/URL/comandi.

Edge autentica direttamente GitHub: `verify_jwt=false` riguarda SOLO questa
funzione e non disabilita alcuna RLS/RPC. JOSE 6.1.0 verifica RS256/firma da JWKS
fisso GitHub, issuer/audience, iat/nbf/exp, durata massima 10 minuti, tolleranza
clock 15 secondi. Poi verifica repository e owner per nome e ID numerico, subject
esatto (formato storico oppure immutabile GitHub), branch main, workflow_dispatch,
workflow path fisso, SHA esplicitamente autorizzato e coincidente con source SHA,
github-hosted, actor_id autorizzato e run_attempt STRINGA `1`. Environment,
workflow riusabili, PR/base/head ref, fork, altri eventi/branch e rerun sono negati.
Non si fa affidamento sui soli branch/path: un workflow modificato ha un altro
workflow_sha e viene respinto finché quella revisione non viene approvata.

Solo dopo questi controlli e validazione del body il broker crea il client
service. Mapping server-side actor_id → UUID STABLR: mai dall'input. Le RPC
ricontrollano il profilo Admin attuale prima di preparazione/upload/conferma.
Nessuna impersonazione via username/email o sostituzione UUID.

Il broker offre solo due operazioni chiuse. Preview accetta `operation, raw,
raw_sha256`; conferma solo `operation, proposal_id, approval_sha256, note`.
Extra campi, Origin browser, richieste non POST, hash diversi o dati fuori
perimetro sono negati. CORS non è la barriera di autorizzazione: anche senza
Origin serve un OIDC valido. Limite pilota raw 1 MiB/body 2 MiB (il raw attuale
è sotto questo limite); nessun troncamento. L'estrattore archivio è lo stesso
modulo versionato del CLI, spostato in `_shared`, senza cambio semantico/versione.

La sorgente è attestata dal codice workflow autorizzato che legge il path fisso,
NON da un hash arbitrario del chiamante: un hash da solo non autentica la fonte.
Nessuna lettura GitHub App. Un token OIDC trafugato resta un bearer sensibile:
TLS, nessun log e registry anti-replay riducono il rischio, non lo rendono pubblico.

## Persistenza e approvazione

Nuovo SQL incrementale ONE-SHOT: `supabase/admin-catalog-tee-evidence-broker.sql`.
Prerequisito: `admin-catalog-tee-evidence.sql` nella versione server-only approvata.
Non modificare/rieseguire SQL storici. Nessun dato esistente viene aggiornato.

Due sole tabelle aggiuntive, append-only, senza DML/SELECT diretto per ruoli API:

- `admin_catalog_tee_broker_preparations`: testo UTF-8 esatto preparato, hash,
  proposta, autore e contesto GitHub minimizzato, con FK SOLO interne all'archivio.
- `admin_catalog_tee_broker_requests`: operazione, run, hash jti (mai token/jti
  integrali), hash richiesta, proposta/ricevuta, autore e contesto, append-only.

RPC nuove, tutte SECURITY DEFINER/search_path pg_catalog, grant solo service_role:

- `admin_catalog_tee_broker_preflight(text,jsonb,text,uuid)`: sola lettura;
  autorizzazione/schema/replay prima dello Storage.
- `admin_catalog_tee_broker_stage(text,jsonb,text,uuid)`: invoca stage esistente
  e registra preparazione esatta + contesto/richiesta nella stessa transazione.
- `admin_catalog_tee_broker_prepared(uuid,uuid)`: lettura interna dei soli metadati
  della preparazione posseduta (hash/actor/revisione); nemmeno questa RPC restituisce
  testo completo. I metadati interni non sono esposti in output HTTP/React/Actions.
- `admin_catalog_tee_broker_confirm(uuid,text,text,jsonb,text,uuid)`: invoca confirm
  esistente e registra contesto GitHub/receipt atomicamente.

Helper non eseguibili direttamente neppure da service_role. SQL valida schema
contesto; firma OIDC, mapping e SHA allowlist sono responsabilità del broker.
Il service role è parte della trust boundary, confinato in Edge; non diventa
una credenziale a privilegio ridotto. Un compromesso del broker è comunque grave.

Preview crea un ID deterministico SOLO per identificare la richiesta/run, non
un'identità tee/live. Lo stesso run + raw riprende la stessa preparazione. Nuovo
run = nuovo manifest/UUID/hash e nuova approvazione necessaria. Il raw va in
Storage privato con upsert:false e controllo dei byte dopo upload/download.
Una preflight è read-only; stage ricontrolla sotto lock transazionale NOWAIT,
con uniqueness per repository/run e hash jti. Una gara di upload o un errore
successivo può lasciare un oggetto raw senza preparazione, mai una ricevuta
parziale: Storage e PostgreSQL non sono una singola transazione distribuita.
Nessuna pulizia automatica o sovrascrittura.

Confirm recupera il testo esatto SOLO dentro SQL e ricalcola SHA; non ricrea il
manifest dal checkout successivo. Richiede stesso Admin/actor/repository, nota,
hash e una revisione preview ancora autorizzata. L'approvazione è consumata dalla
UNIQUE(proposal_id) già presente: nessun UPDATE di stato, nessun secondo consumo.
Retry identico ritorna la ricevuta precedente; cambia hash/proposta/nota/body o
contesto per lo stesso run → conflitto. Un nuovo dispatch confirm può recuperare
la STESSA ricevuta con stesso Admin/actor, hash e nota; non crea un altro batch.
Il pulsante GitHub Re-run è sempre negato. Se il token scade avviare un nuovo
dispatch confirm identico, non una nuova preview per un semplice retry.

Risposte allowlisted sia in Edge sia nel runner: preview restituisce UUID/hash,
versione, conteggi e motivi aggregati; confirm solo ricevuta/conteggi. Mai raw,
manifest, path Storage, URL firmati, JWT, service key, UUID Admin o payload SQL.
Gli errori sono costanti, senza console/body backend. Non inserire dati personali
o segreti nella nota: gli input di dispatch sono comunque visibili su GitHub.
React e le RPC Admin restano invariati: consultano solo ricevute confermate.

## Configurazione manuale finale (NON eseguita)

1. Applicare una volta il SOLO SQL incrementale sopra, DOPO l'archivio approvato.
   Se il prerequisito non esiste fermarsi; non tentare di riapplicare script storici.
2. Revisionare/pubblicare il workflow sul branch `main` e proteggerlo insieme a
   client/broker/estrattore. Autorizzare il commit completo, non il nome workflow
   o un tag mobile. Nessun commit/push è eseguito da questo task.
3. Configurare SOLO nelle Edge Function secrets, mai GitHub secrets/REACT_APP:
   - `EVIDENCE_OIDC_AUDIENCE`: `stablr:tee-evidence:<ambiente>` (suffix a-z/0-9/-).
   - `EVIDENCE_GITHUB_REPOSITORY_ID`: ID numerico reale di giuseppepalazzo/stablr.
   - `EVIDENCE_GITHUB_OWNER_ID`: ID numerico reale di giuseppepalazzo.
   - `EVIDENCE_GITHUB_ADMIN_MAP`: JSON `{"<actor_id numerico>":"<UUID Admin STABLR>"}`.
   - `EVIDENCE_GITHUB_WORKFLOW_SHAS`: JSON `["<SHA commit main revisionato, 40 hex>"]`.
   Il runtime deve avere `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` server-only
   forniti dalla piattaforma; verificarne disponibilità, senza stamparli. Nessun
   JWT Admin, password o token GitHub App da configurare.
4. Deploy manuale della sola `tee-evidence-broker`, usando `supabase/config.toml`.
   Nessun deploy automatico nel workflow batch. Verificare firma/JWKS reale e
   budget CPU/durata/memoria Edge prima di abilitare il workflow; i test Node
   locali non attestano i limiti della piattaforma remota (CPU max 2s/request).
5. Configurare DUE GitHub Actions repository VARIABLES PUBBLICHE (non secrets):
   `EVIDENCE_BROKER_URL=https://<project-ref>.supabase.co/functions/v1/tee-evidence-broker`
   e `EVIDENCE_OIDC_AUDIENCE` identica al valore Edge. Abilitare Actions/OIDC;
   job richiede solo contents:read e id-token:write. Non configurare service role
   o JWT Admin su GitHub. Ulteriori protezioni environment dipendono dal piano;
   questo workflow non richiede environment/custom subject.

Poi Giuseppe: Run workflow **preview**, controlla riepilogo/esclusi, Run workflow
**confirm** con UUID proposta + SHA + nota; consulta ricevuta nell'Admin.
Non copiare manifest/token, non creare artifact GitHub. Per aggiornare main/raw
autorizzare il nuovo workflow_sha dopo revisione; revocare vecchi SHA blocca anche
conferme delle loro preparazioni, non cambia ricevute già registrate.

## Verifiche e sospensione

Test isolati con JWT RS256 firmati e JWKS fixture, claim validi/invalidi/mancanti,
Storage simulato e PostgreSQL/WASM. Nessun token reale/upload/workflow/Supabase.
Testano ACL/RLS, minimizzazione, append-only, CAS/replay, rollback anche se fallisce
il nuovo audit, e presenza dei lock NOWAIT. Non sostituiscono una gara tra due
connessioni PostgreSQL o un test del gateway Storage/Edge remoto.

Per sospendere: disabilitare workflow, revocare actor/SHA policy e disabilitare
broker/grant RPC incrementali; lasciare intatte evidenze/ricevute/preparazioni.
Nessun rollback live, nessun consumer da migrare. Nessuna FK/scrittura a catalogo,
tee, classificazioni, import, giri, bozze/versioni; solo FK interne all'archivio.

Fonti di contratto: [GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc),
[Edge auth](https://supabase.com/docs/guides/functions/auth),
[Edge limits](https://supabase.com/docs/guides/functions/limits).
