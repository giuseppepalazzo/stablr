# Fase 3b — Configurazioni esplicite di una struttura fisica 9

## Applicazione manuale

Prerequisiti: fondazione fisica, coda di revisione e Fase 3a già applicate.
Eseguire **una sola volta** l'intero file
`supabase/admin-catalog-playable-configurations.sql` nel SQL Editor, inclusi
`BEGIN` e `COMMIT`. Non riapplicare gli script precedenti. Lo script aggiunge
contratti vuoti: non crea configurazioni, non collega club o buche reali e
non modifica consumer o record live.

## Modello riusato

Nessuna nuova tabella. In `admin_catalog_playable_configurations` vengono
aggiunti tre campi nullable: `physical_source_link_id`, `registration_kind`
(`autonomous_9` / `repeated_18`), `registration_snapshot`. Restano NULL sui record
esistenti. Un indice univoco impedisce doppie registrazioni dello stesso tipo
per lo stesso collegamento fisico verificato.

Una registrazione esplicita crea una configurazione `needs_review` e tutte le
righe in `admin_catalog_configuration_holes`. Ogni riga conserva identità fisica,
posizione, occorrenza, sorgente esatta, SI proprio e `par_mode=inherited`, con
`par_override=NULL`. Il mapping delle righe è esatto; la revisione dell'intera
configurazione richiede un'ulteriore conferma. Il Par effettivo è il Par base
della buca fisica verificata. I SI non vengono copiati nelle identità fisiche.

La configurazione 9 autonoma conserva i nove SI distinti live nell'intervallo
1–18, senza ridurli arbitrariamente a 1–9. Il 18 derivato richiede quel padre
già verificato e riusa gli stessi nove UUID fisici nelle posizioni 1–9 e 10–18,
con occorrenze 1 e 2. Conserva la revisione del padre e la regola esplicita:
prima tornata SI base, seconda `min(18, SI base + 1)`.

La regola coincide con `buildSingleRouteCompetitionSequence` in `src/App.js`.
Per i SI dispari 1–17 documentati per Mare di Roma, produce i 18 SI distinti
1–18. Per altre convenzioni che generano doppioni o valori mancanti, il 18
è bloccato: nessun nuovo algoritmo SI viene introdotto o dedotto. L'Admin
sceglie esplicitamente sorgente e tipo, senza selezioni automatiche per club.

## RPC e sicurezza

- `admin_catalog_playable_preview(uuid,uuid,text)`: sola lettura; sorgente e tipo
  opzionali inizialmente, nessuna selezione o scrittura implicita.
- `admin_catalog_playable_register(uuid,uuid,text,jsonb,text,boolean)`: richiede
  conferma, nota e base esatta; registra configurazione, righe e audit atomici.
- `admin_catalog_playable_verify(uuid,bigint,jsonb,jsonb,text,boolean)`: richiede
  seconda conferma, nota, revisione e snapshot esatti di base/righe; aggiorna
  solo lo stato della configurazione e il relativo audit.

Tre helper privati (`inspect`, `lock`, `guard`) non sono eseguibili tramite API.
Tutte le funzioni usano `SECURITY DEFINER`, `search_path=pg_catalog` e nomi
qualificati. Le RPC pubbliche concedono EXECUTE solo ad authenticated e
verificano UID, JWT autenticato e Admin. Anon, player e service API sono respinti.
RLS/grants delle tabelle restano quelli Admin-only della fondazione.

I due nuovi trigger, solo sulle tabelle configurazione/occorrenze della
fondazione, impediscono modifiche alle sequenze registrate o alla loro base
attraverso le RPC generiche precedenti. Una configurazione esistente non può
essere adottata implicitamente. La sola transizione ammessa per un record Fase
3b è una verifica completa con sorgente corrente; i verificati sono sigillati.
Le proposte precedenti mantengono i contratti già disponibili.

## Completezza, conflitti e audit

Richiesti: struttura `fisico_9` verificata, collegamento Fase 3a verificato,
nove identità verificate esatte, numeri 1–9 e Par validi. La preview rivalida
gli UUID sorgente e il mapping Fase 3a, senza match per nome, Par o offset.
Collisioni con configurazioni legacy della stessa sorgente/ambito o etichette
già registrate bloccano l'operazione: nessuna fusione automatica.

La base cattura struttura/revisione, collegamento/revisione, Percorso/buche
live, identità/revisioni fisiche, tee, override presenti e padre/righe/revisione.
Una modifica tra anteprima e conferma fallisce; una modifica dopo registrazione
blocca la verifica, senza aggiornare silenziosamente la base. Il Par ereditato
e i SI non sono editabili in questa schermata.

Lock NOWAIT su tabelle/righe proteggono da modifiche della sorgente e phantom;
la revisione e il mapping attesi proteggono da conferme obsolete. I lock sono
conservativi e possono temporaneamente serializzare operazioni su altri club.
Ogni errore, compreso un errore nell'audit, annulla l'intera transazione. Audit
append-only con autore, data, revisione e prima/dopo usa la tabella esistente.

L'anteprima espone separatamente `tee_specific_hole_matrix` del Percorso e gli
override già presenti nella fondazione. Sono evidenze originali, non vengono
applicati alla sequenza base, copiati, modificati o interpretati come assenti.
I consumer giocatore continuano a risolverli secondo il contratto corrente.

## Tabelle e limiti

Scritture solo su `admin_catalog_playable_configurations`,
`admin_catalog_configuration_holes` e `admin_catalog_foundation_events`.
Le FK aggiunte sono solo verso la fondazione, con RESTRICT. Nessun DML live,
nessuna scrittura su import, tee, override, giri, bozze o versioni. Nessuna RPC
storica viene sostituita e nessuna migration precedente viene modificata.

Restano fuori fase: consumer live, pubblicazione/propagazione, editor Par/SI,
18 fisici, multi_9, prime/seconde nove, combinazioni tra Percorsi, gestione
override e riconciliazione di basi cambiate o configurazioni legacy. La UI
mostra questi casi come bloccati, senza creare dati sostitutivi.

Per sospendere la fase dopo l'applicazione si può disabilitare il nuovo accesso
UI e revocare le tre nuove RPC; i consumer esistenti non dipendono dal contratto.
Conservare record, riferimenti e audit dopo registrazioni reali. Nessun DROP o
rollback distruttivo automatico. Prima del COMMIT la transazione è annullabile;
una seconda applicazione fallisce senza alterare dati già registrati.

## Test

`scripts/tests/admin-catalog-playable-configurations.test.mjs` esegue PostgreSQL
isolato via PGlite, con definizioni reali delle tabelle e sole fixture. Verifica
permessi, snapshot, sequenze, SI, override separati, transazioni/audit, CAS,
collisioni e conservazione dei record protetti. PGlite serializza le richieste:
la prova delle richieste concorrenti copre il CAS e i duplicati, non simula
connessioni PostgreSQL indipendenti per i lock. I test UI coprono scelte
esplicite, anteprima, conferme separate, ripresa, errori, aggiornamento dopo
verifica fisica e storico visibile.
