# Backup database STABLR — Step 1

Workflow: `.github/workflows/database-backup.yml`. Ogni giorno alle **03:43 UTC**
e manualmente con **Run workflow → main**, prima delle migration. Solo repository
originale/main; nessun trigger PR, nessun artifact GitHub, nessuna modifica SQL.

## Configurazione una tantum (non eseguita da questa task)

1. **Cloudflare R2**: bucket dedicato privato, senza `r2.dev`, dominio pubblico o
   CORS. Token S3 **Object Read & Write limitato a quel bucket**, non account-wide.
   Abilitare una **Object lifecycle rule**: prefisso `database/`, eliminazione
   dopo **10 giorni**; includere anche le ricevute, stesso prefisso. L'eliminazione
   è asincrona (non garantita al minuto). Non attivare lock incompatibili con la
   scadenza. Questa regola è obbligatoria: il workflow non cancella oggetti.
2. Su un computer fidato generare una coppia con `age-keygen -o /percorso/offline/backup-age.key`.
   Conservare **la chiave privata in due copie offline sicure** (password manager
   e copia separata). Non inserirla in GitHub/R2/repository. La chiave pubblica
   `age1...` è il destinatario: il runner può cifrare ma non decifrare.
3. GitHub repository → Settings → Secrets and variables → Actions:

   | Secret | Valore |
   | --- | --- |
   | `BACKUP_DATABASE_URL` | URI PostgreSQL da Supabase Connect, **direct oppure session pooler porta 5432**, utente con lettura completa di schema/dati/Auth; password URL-encoded. Non REST URL, anon/service key o transaction pooler 6543. Preferire session pooler IPv4 sul Free. |
   | `BACKUP_AGE_RECIPIENT` | Solo destinatario pubblico `age1...` |
   | `BACKUP_R2_ENDPOINT` | Endpoint S3 del bucket: `https://<account-id-32-hex>.r2.cloudflarestorage.com`; per bucket giurisdizionali usare esattamente `.eu.r2…`, `.us.r2…` o `.fedramp.r2…` indicato da Cloudflare. |
   | `BACKUP_R2_BUCKET` | Nome bucket privato dedicato |
   | `BACKUP_R2_ACCESS_KEY_ID` | **Access Key ID S3** R2: 32 caratteri esadecimali, non bearer API token, Account ID o Secret Access Key. |
   | `BACKUP_R2_SECRET_ACCESS_KEY` | **Secret Access Key S3** R2 abbinata: 64 caratteri esadecimali. Non il token API originale. |

   Dopo aver verificato nel dashboard R2 la lifecycle, impostare la **variabile
   pubblica** `BACKUP_RETENTION_10_DAYS_CONFIGURED=true`. Default mancante = blocco.
   La precedente conferma a 30 giorni non è più utilizzata: aggiornare la regola
   R2 a 10 giorni prima di impostare la nuova variabile.
   È un'attestazione dell'operatore, non una verifica automatica della regola:
   R2 non espone `GetBucketLifecycle` nella sua API S3. Nessun token aggiuntivo di
   amministrazione Cloudflare necessario.
4. Abilitare Actions e notifiche email per workflow falliti; proteggere `main`
   e le modifiche a workflow/script (review obbligatoria). Chi può modificare un
   workflow con accesso ai Secrets può esfiltrarli: R2/DB devono avere credenziali
   dedicate con privilegi minimi. Non concedere a fork/PR accesso ai Secrets.

Non servono JWT Admin, chiavi Supabase service role o modifiche all'app.
Il DB può richiedere l'utente `postgres` per leggere Auth: il backup imposta
transaction read-only, **ma non riduce i privilegi intrinseci della credenziale**.
Un login DB dedicato realmente read-only può essere predisposto in una task
separata, verificando l'accesso a tutte le tabelle e ai ruoli.

## Copertura e integrità

- `pg_dump` **completo**, formato custom: schema e dati di tutti gli schemi locali
  non di sistema, comprese `public`, `auth` e le altre strutture Admin, funzioni,
  trigger, RLS, ACL, sequenze e metadata Storage presenti nel database. Nessun
  filtro implicito Supabase CLI che possa far presumere Auth coperto.
- Transazione sorgente **REPEATABLE READ READ ONLY** con snapshot esportato,
  condiviso con `pg_dump`; conteggi di `auth.users` e `auth.identities` nello
  stesso snapshot. Nessuna INSERT/UPDATE/DELETE sul DB sorgente.
- Lettura/decompressione di tutto il dump tramite `pg_restore` verso `/dev/null`
  (nessuna esecuzione SQL), oltre al controllo TOC per definizione e dati di **ogni tabella locale non appartenente
  a estensioni**, inclusi tutti i record Auth; backup rifiutato se manca copertura.
  Tabelle esterne FDW: definizioni sì, contenuti remoti no. Oggetti delle estensioni
  seguono le regole native `pg_dump` (definizioni ricreate dall'estensione e dati
  delle sue configuration tables): sono inventariati, non dichiarati copiati
  integralmente. Inventario delle versioni delle estensioni incluso.
- Ruoli esportati separatamente con `pg_dumpall --roles-only --no-role-passwords`.
  **Password login PostgreSQL escluse**; password hash dei giocatori e dati Auth
  invece inclusi nel dump cifrato. I globals dei ruoli non fanno parte dello
  snapshot MVCC del DB: evitare cambi ai ruoli durante il backup.
- Manifest cifrato: inventario, conteggi Auth, versioni server/client, hash SHA-256
  dei file. Tutto dentro `.tar.age`, cifrato **prima** di qualsiasi upload.
- Chiave oggetto UUID univoca, `If-None-Match: *` contro sovrascritture. Rilettura
  **integrale da R2** con confronto SHA-256, non affidamento all'ETag. Ricevuta
  `.verified.json` solo dopo verifica; contiene solo checksum, byte e data.
  Oggetti senza ricevuta non sono backup verificati. Nessun dump/log DB/manifest
  completo compare nei log, nel repository o negli artifact GitHub.
- File temporanei privati, ripuliti a fine processo; timeout/fallimenti danno
  exit nonzero. Fallimenti SDK/DB non stampano credenziali, URL o record.

## Primo backup di prova

Solo dopo commit/push **autorizzati separatamente** e configurazione sopra:

1. Actions → **Database backup (encrypted R2)** → Run workflow → **main**.
2. Attendere verde: summary con chiave oggetto, SHA-256 e copertura Auth;
   verificare presenza di `.tar.age` e `.verified.json` nel bucket privato.
   Se fallisce, **non procedere alla migration**. Né il job né questa task
   eseguono automaticamente migration o modifiche applicative.
3. Scaricare entrambi su computer fidato fuori dal repository, quindi verificare
   decifratura e ripristino isolato descritti sotto. Solo questo test prova che
   il backup reale è recuperabile; nessun recupero produzione è ancora certificato.

## Verifica / ripristino in ambiente isolato

Richiede `age`, Python >=3.9 e gli strumenti PostgreSQL **18 o versione non
inferiore al client registrato nel manifest**. La fotografia di Supabase richiede
estensioni compatibili: un PostgreSQL generico potrebbe non averle. Predisporre
un container/istanza Supabase PostgreSQL con le stesse estensioni/versioni, senza
API/Auth/SMTP/worker collegati alla produzione, **senza egress di rete e senza
scheduler/pg_cron attivi**, e un **database nuovo vuoto**
`stablr_restore_test`. Non puntare a un progetto esistente. I dump integrali
contengono internals Supabase: il ripristino su un progetto gestito già inizializzato
richiede un piano dedicato, non questo script.

Eseguire prima la verifica non mutante:

```sh
python3 scripts/backup/database_backup.py inspect \
  --encrypted /percorso/privato/backup.tar.age \
  --receipt /percorso/privato/backup.tar.age.verified.json \
  --identity /percorso/offline/backup-age.key
```

Impostare `RESTORE_DATABASE_URL` nella sola sessione locale (non salvarla in file
versionati né usare password in cronologia); host loopback e nome
`stablr_restore_*`. Poi:

```sh
python3 scripts/backup/database_backup.py restore --confirm-isolated \
  --encrypted /percorso/privato/backup.tar.age \
  --receipt /percorso/privato/backup.tar.age.verified.json \
  --identity /percorso/offline/backup-age.key
```

Guardie: rifiuta host remoti, DB `postgres`/nomi diversi, DB non vuoti, checksum
errati, path/symlink nell'archivio. Niente `DROP`, `--clean` o sovrascritture.
Ripristino schema/dati/ACL in una sola transazione, abortisce al primo errore;
conteggi Auth confrontati automaticamente. I soli nomi di ruoli mancanti sono
creati **NOLOGIN**, senza ripristinare privilegi superuser o password, prima
della transazione DB. Se il restore fallisce, possono restare questi ruoli inerti
nell'istanza sandbox: scartare l'istanza intera dopo il test.

È un **ripristino forense isolato**, non il ripristino della sicurezza produzione:
owner degli oggetti = operatore locale; `roles.sql` è conservato cifrato per
revisione/ripristino controllato delle vere appartenenze/privilegi. Verificare
anche conteggi campione/catalogo/giri, funzioni e RLS prima di progettare il
recupero operativo. Una prova a schema fixture non certifica Supabase reale.

## Limiti e manutenzione

### Diagnostica sicura del job

Ogni fase stampa solo `BACKUP phase=<fase> status=started|ok|failed` e, in caso
di errore, un codice in allowlist. Distinzione fra `postgres_connection`,
`database_export`, `archive_verification`, `roles_export`, `encryption`,
`r2_client`, `r2_upload`, `r2_verification`, `r2_receipt` e `configuration`.
Per gli errori S3 sono aggiunti `s3_code` (solo codici canonici in allowlist) e
`http_status` (intero 100–599). `s3_reason` classifica il messaggio soltanto in
cause fisse: `AccessKeyFormat`, `JurisdictionEndpoint`, `ContentEncoding`,
`Checksum`, `PayloadSignature`, `ConditionalWrite`, `ContentLength`,
`Authorization` oppure `Unclassified`; mai il messaggio originale o i suoi valori.
Codici arbitrari diventano `Other`; stato assente
o non valido diventa `Unavailable`. Mai stampare `Error.Message`, header,
request ID, body XML/JSON, endpoint o credenziali. Il vecchio
`R2_REQUEST_FAILED` da solo non distingue una richiesta incompatibile da altri
errori S3: non dimostra quale feature o configurazione abbia causato il rifiuto.
Mai abilitare `set -x`, stampare l'ambiente, stderr grezzo PostgreSQL/age o
eccezioni SDK complete. La chiusura delle pipe gestisce anche `BrokenPipeError`
senza sostituire la causa originale con un errore generico. I tool PostgreSQL
non chiedono password interattivamente: usano esclusivamente la credenziale
configurata dal job.

| Codice | Configurazione/controllo pertinente |
| --- | --- |
| `PG_AUTH_FAILED` | Verificare la password e l'URI URL-encoded in `BACKUP_DATABASE_URL`; niente reset automatico. |
| `PG_DNS_FAILED`, `PG_NETWORK_UNREACHABLE`, `PG_CONNECTION_TIMEOUT`, `PG_CONNECTION_REFUSED` | Verificare host/rete. Se l'endpoint diretto è solo IPv6 e il runner non lo raggiunge, usare la URI **Session pooler** IPv4 del dashboard Supabase, porta **5432** e relativo username; mai transaction pooler 6543. Nessun fallback automatico. |
| `PG_POOLER_REJECTED` | Verificare host e username esatti della URI session pooler, progetto e limiti connessioni. |
| `PG_SSL_FAILED` | Verificare TLS/certificati; non disabilitare SSL per aggirare il problema. |
| `PG_PERMISSION_DENIED` | Credenziale senza copertura sufficiente: verificare l'accesso ad Auth/catalogo/ruoli. Nessuna esclusione automatica di dati. |
| `PG_INVENTORY_FAILED`, `PG_SNAPSHOT_FAILED`, `ARCHIVE_COVERAGE_FAILED` | Inventario/snapshot/copertura non validi: nessun upload, non eseguire migration. |
| `AGE_RECIPIENT_INVALID` | Verificare il destinatario **pubblico** `BACKUP_AGE_RECIPIENT`, non usare la chiave privata. |
| `R2_ACCESS_DENIED`, `R2_CREDENTIALS_INVALID`, `R2_SIGNATURE_INVALID` | Verificare le credenziali R2 limitate al bucket e i permessi Object Read & Write. |
| `R2_BUCKET_NOT_FOUND`, `R2_CONNECTION_FAILED`, `R2_TLS_FAILED` | Verificare bucket ed endpoint account R2 HTTPS. |
| `R2_INTEGRITY_FAILED`, errore in `r2_receipt` | Backup non verificato: nessuna ricevuta di successo. Non procedere alla migration. |
| `R2_NOT_IMPLEMENTED` / `NotImplemented` / HTTP 501 | Feature rifiutata dal servizio: verificare compatibilità della richiesta e dell'endpoint; mai rimuovere la precondizione anti-sovrascrittura per aggirare l'errore. |
| `R2_INVALID_ARGUMENT`, `R2_INVALID_REQUEST` / HTTP 400 | Richiesta/argomento non accettati; non attribuire automaticamente il problema alle chiavi. |
| `R2_MISSING_CONTENT_LENGTH`, `R2_BAD_DIGEST` | Framing o integrità del corpo rifiutati; lunghezza esplicita per archivio e ricevuta, nessuna rinuncia al controllo SHA-256. |
| `R2_CLOCK_SKEW` / HTTP 403 | Verificare l'orologio del runner prima di cambiare credenziali. |
| `CONFIG_R2_ACCESS_KEY_INVALID`, `CONFIG_R2_SECRET_KEY_INVALID` | Nei GitHub Secrets usare la coppia S3 R2, non il bearer API token né l'Account ID. Il formato viene verificato **prima di connessione/export PostgreSQL**, senza stampare valori o trasformare token. |

Un `InvalidArgument` HTTP 400 **non identifica da solo il parametro sbagliato**:
può riguardare anche autenticazione/endpoint, non soltanto `PutObject` o il corpo.
La prova offline con boto3 1.40.57/botocore 1.40.76 conferma che il codice genera
lunghezza corretta, nessun `Content-Encoding`, `aws-chunked`, trailer o checksum
CRC automatico, mantenendo la precondizione. Non viene quindi introdotta una
modifica cieca agli header né rimossa la protezione per aggirare il 400.
Firma SigV4 e addressing path-style sono espliciti; vengono usate soltanto le
due credenziali S3 previste, senza ereditare un eventuale session token AWS estraneo.
I formati validi non provano da soli che la coppia abbia accesso al bucket.

`PutObject` usa un corpo di lunghezza nota (`ContentLength` esplicito),
`IfNoneMatch='*'` e soli metadata SHA-256. Nessun ACL, SSE KMS o object-lock
header S3 viene aggiunto dall'applicazione. La configurazione SDK mantiene
`request_checksum_calculation='when_required'`: niente checksum opzionali
automatici/trailer `aws-chunked`. Non è introdotto alcun retry senza
precondizione: un HTTP 412 resta un rifiuto e non produce ricevute aggiuntive.
SHA-256 e metadata sono confrontati dopo rilettura integrale da R2, come prima.

Il test `test_r2_sdk_request.py` usa il vero boto3 ma credenziali/dati sintetici:
intercetta le richieste firmate **prima della rete**, verifica header e framing,
round-trip SHA-256 e rifiuto della sovrascrittura. Il workflow esegue la suite
nel virtualenv con boto3 installato, prima di ricevere i Secrets. In locale il
test viene saltato se boto3 non è disponibile; non installare né contattare
servizi per eseguire i normali test unitari.

I log dei run precedenti con il solo messaggio generico **non permettono di
ricostruire quale servizio abbia fallito**. Un nuovo run con questa versione
identifica fase e motivo filtrato; non attribuire retroattivamente l'errore a
password, IPv6 o R2 senza questa evidenza.

### Copertura operativa

- **Non inclusi**: byte Storage (step successivo), secrets Edge/JWT/API, provider
  OAuth, SMTP, configurazioni dashboard, deploy Edge, DNS, password dei ruoli DB.
- Backup logico giornaliero, **non PITR**: possibile perdita fino a un giorno
  (maggiore se job fallisce o il progetto è sospeso). Prima di ogni migration:
  esecuzione manuale riuscita e ricevuta verificata.
- GitHub schedule può partire in ritardo ed essere disabilitato per inattività
  nei repository pubblici. Notifiche failure non rilevano un job mai partito:
  controllare settimanalmente l'ultima ricevuta o aggiungere heartbeat indipendente
  in un passo successivo. Quota Actions, egress Supabase e dimensione R2 da monitorare.
- Immagine ufficiale PostgreSQL 18 e versione boto3 fissata; client/server
  inventariati. Verificare periodicamente aggiornamenti dipendenze e disponibilità
  estensioni. Un errore di permessi/internals non produce un backup "riuscito".
- Retention R2 lifecycle obbligatoria ma non verificata da questo job; controllare
  periodicamente il dashboard e la scadenza effettiva. Le ricevute scadono insieme
  ai backup. Non conservare solo la copia offline della chiave nello stesso account.
- Nessun backup reale, upload, configurazione remota o restore produzione eseguito
  durante l'implementazione. Ripetere una prova restore dopo migration importanti.

Test locali senza rete/credenziali:
`python3 -m unittest discover -s scripts/backup/tests -v`.
Sono test di sicurezza/orchestrazione con tool/DB/S3 simulati **solo nei test**;
è presente anche uno smoke test con PostgreSQL/age reali su fixture locale, saltato
se gli strumenti mancano oppure l'utente è root. Il workflow lo esegue come
utente `postgres` prima di ricevere i Secrets. Il primo test operativo deve
comunque includere Supabase isolato con le estensioni reali: la fixture non lo
sostituisce.

Fonti: [Supabase backup](https://supabase.com/docs/guides/platform/backups),
[internals e restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/),
[API S3 R2](https://developers.cloudflare.com/r2/api/s3/api/),
[age](https://github.com/FiloSottile/age).
