# Verifica FIG — governance isolata

## Contratto e limite della fonte

La pagina pubblica FIG espone nomi, Percorso, Par e coppie CR/Slope, **non ID
esterni stabili**. Ogni fotografia riuscita conserva immutabilmente tutti questi
valori e la data; l'hash del contenuto identifica un'osservazione, non un club.
Una riga cambiata compare come osservazione aggiunta/scomparsa **Da identificare**.
Nessun nome, Par, posizione, città o slug viene usato per attribuirla a STABLR.
Il primo controllo genera la coda di osservazioni senza collegamento, non finte
modifiche rispetto a una baseline inesistente. Duplicati identici mantengono la
cardinalità. Ordine e HTML decorativo non creano differenze.

Separatamente ogni controllo fotografa il **catalogo FIG già importato** e fa
il confronto precedente/attuale/STABLR soltanto sui FK `clubs.fig_club_id` con
`fig_match_status=matched`, univoci. Non si afferma che questi UUID identifichino
le righe pubbliche. Cambiamenti FIG nel DB sono distinguibili da divergenze
editoriali del nome/località curati. Configurazioni/rating FIG sono consultabili,
ma non vengono ricreati né associati automaticamente a strutture live. Un nuovo
record pubblico resta Da identificare; un nuovo record **già nel catalogo FIG DB**
resta utilizzabile nel flusso esistente Crea da FIG (nessun import in questa fase).

`Ignora modifica` conserva la decisione su quella differenza. Un'uguale
divergenza editoriale ignorata non ricompare finché i dati non cambiano.
`Non corrisponde` registra un rifiuto persistente nella governance, impedendo
altre proposte su quella coppia: **non cambia il matching live**. Non è una
classificazione/matching automatico. `Apri proposta in bozza` è disponibile solo
per un Club esistente con collegamento verificato e fonte/base ancora identiche;
precompila esclusivamente nome/località, mai Percorsi/rating. Una bozza personale
già modificata non viene sovrascritta. Conferma, nota e bozza/audit sono atomici.
Se FIG non fornisce località, la proposta conserva quella curata anziché cancellarla.

## Applicazione manuale (nessuna risorsa remota modificata da questo task)

1. Nel SQL Editor del progetto `sziakyhacffwvirhzboy`, eseguire **una sola volta**
   `supabase/fig-governance.sql`, dopo workflow/Club editor e catalogo FIG esistenti.
2. Configurare soltanto in Edge i seguenti valori (nessuna service key in React
   o GitHub):
   - `FIGCHECK_OIDC_AUDIENCE=stablr:fig-governance:production`
   - `FIGCHECK_REPOSITORY_ID=1193622237`
   - `FIGCHECK_OWNER_ID=28347789`
   - `FIGCHECK_GITHUB_ADMIN_MAP={"28347789":"257b01b3-32eb-4b6d-be0b-8ce2e4afc397"}`
     Verificare che il profilo sia ancora Admin. Il server lo ricontrolla a ogni RPC.
   - `FIGCHECK_WORKFLOW_SHAS=["<SHA del commit main contenente il workflow autorizzato>"]`
   - `FIGCHECK_ADMIN_ORIGINS=["<origine HTTPS effettiva dell’Admin>"]`
     Per il test locale aggiungere esplicitamente `http://localhost:3000`.
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` sono i valori
   server standard della piattaforma. Nessuno di essi viene restituito dalla funzione.
3. Deploy **solo** `supabase functions deploy fig-governance --project-ref sziakyhacffwvirhzboy`.
   Il config disabilita il JWT piattaforma solo per questa funzione: essa verifica
   esplicitamente la sessione Admin o firma/JWKS e tutti i claim OIDC del workflow.
4. Dopo commit/push autorizzati separatamente, impostare le **variabili pubbliche**
   GitHub `FIGCHECK_BROKER_URL=https://sziakyhacffwvirhzboy.supabase.co/functions/v1/fig-governance`
   e `FIGCHECK_OIDC_AUDIENCE=stablr:fig-governance:production`.
   Nessun secret Supabase in Actions. Workflow esatto `fig-governance.yml`, main,
   schedule lunedì **05:17 UTC** o dispatch, runner GitHub-hosted, primo tentativo,
   actor mappato e SHA autorizzato. Lo SHA deve essere esplicitamente aggiornato
   dopo successivi commit autorizzati; revisioni nuove falliscono chiuse.
   L'actor dello schedule (associato da GitHub alla sua configurazione) deve
   essere un actor presente nel mapping; nessuna eccezione per bot/non Admin.
   GitHub può ritardare/sospendere schedule inattivi: non è un SLA di esecuzione.

## Sicurezza, concorrenza e rollback

Tabelle senza grant API, RLS attivo, RPC UI Admin-only con UID/JWT/is_admin.
Begin/finish service-only con operatore ancora Admin; il browser non invoca queste
RPC. Broker manuale verifica getUser(token) e RPC Admin, mai UUID da input.
Canale GitHub dedicato riusa il disegno OIDC del broker evidenze senza cambiare
le sue policy dispatch-only. Run ID signed deduplicato, nessun comando/path/URL
controllato dal chiamante. CORS con origini esplicite. Nessun raw nei log/risposte.
Solo UUID/stato nei risultati broker; vista Admin riceve campi catalogo allowlist.

Lock globale transazionale, singolo run in corso, baseline attesa, retry con lo
stesso request ID/run ID non ripete fetch o crea altre fotografie. Lease interrotta
scade dopo 10 minuti al successivo avvio. Una lettura fallita/malformata o una
riduzione sospetta oltre 50% registra fallimento, non avanza la baseline e non
crea differenze. Nessun snapshot parziale: validazione e fotografia/coda/baseline
sono nella stessa transazione. Una run completata non può cambiare.
Snapshot, differenze e decisioni sono append-only; nessun DML live/import/player.
Solo l'azione Admin confermata può scrivere una bozza tramite le RPC esistenti.

Rollback non distruttivo: disabilitare lo schedule e rimuovere lo SHA autorizzato
o sospendere il broker, mantenendo fotografie/decisioni. Nessun consumer giocatore
dipende da questa fondazione. Nessun backfill o ripristino automatico di matching.

## Test manuale minimo

Admin → Avanzata → Verifica FIG → **Verifica FIG ora**. Attendere Riuscito e una
fotografia datata; aprire una voce pubblica e verificare **Da identificare**, nessuna
attribuzione STABLR e proposta in bozza disabilitata. Confermare Ignora modifica
con nota: la voce esce dalla coda e resta in Tutte le decisioni. Ripetere il
controllo: nuova fotografia, nessuna variazione fittizia se FIG non è cambiata,
decisione conservata, catalogo live invariato. Non serve pubblicare alcuna bozza.
