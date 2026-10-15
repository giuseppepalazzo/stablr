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
   | `BACKUP_R2_ENDPOINT` | `https://<account-id-32-hex>.r2.cloudflarestorage.com` |
   | `BACKUP_R2_BUCKET` | Nome bucket privato dedicato |
   | `BACKUP_R2_ACCESS_KEY_ID` | Credenziale S3 limitata al bucket |
   | `BACKUP_R2_SECRET_ACCESS_KEY` | Segreto S3 limitato al bucket |

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
