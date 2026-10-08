# Fondazione fisica · Fase 3c

Applicare **una sola volta** `admin-catalog-physical-18-configurations.sql` nel SQL
Editor, interamente (BEGIN/COMMIT inclusi), dopo Fase 3a e Fase 3b. Non riapplicare
gli script storici. Nessuna applicazione remota viene eseguita dal task.

## Contratto

- La Fase 3a già registra/verifica un Percorso 18 come origine di 18 identità
  fisiche. La sorgente deve avere numeri 1–18 e Par completi, senza derivazioni.
- Tre tipi espliciti: `autonomous_18`, `front_9` (fisiche 1–9), `back_9`
  (fisiche 10–18). Nessuna scelta automatica di sorgente o intervallo.
- Il 18 autonomo usa il medesimo Percorso del collegamento fisico. Le nove
  richiedono un proprio Percorso live da 9 buche con numerazione locale 1–9 e un
  padre 18 autonomo già verificato. Si registra l'intervallo scelto, non un match
  dedotto da nomi, uguaglianze, SI o posizione nel catalogo.
- SI sempre copiati dai record `route_holes` della **rispettiva sorgente**:
  distinti, non null, 1–18; non si impone SI 1–9 alle nove e non si calcola +9.
- Par: scelta obbligatoria tra `source` (valori della sorgente conservati come
  override espliciti, anche se uguali al base) e `inherited` (ereditarietà
  dichiarata). Entrambe richiedono Par per-buca coerenti con l'intervallo fisico
  e totale sorgente coerente. Non si risolvono discrepanze in questa fase.
- Fiuggi 1928 è il pilota previsto: 18 / Prime Nove / Seconde Nove, Par 70/35/35.
  Nessun record del pilota o di altri club viene creato dallo script.

## Sicurezza e persistenza

RPC dedicate `admin_catalog_physical18_preview`, `..._register`, `..._verify`:
EXECUTE soltanto ad `authenticated`, con controllo interno di UID, ruolo JWT
`authenticated` e Admin. Player, anon e service API respinti. Helper privati.
Preview STABLE in sola lettura; register e verify richiedono nota e conferma
distinte, baseline completa, revisione attesa in verifica e snapshot dei link.

Nessuna nuova tabella o policy. Estensione ristretta della CHECK sui tipi e del
guard esistente; le configurazioni Fase 3b mantengono inspector e snapshot.
Solo `admin_catalog_playable_configurations`, `admin_catalog_configuration_holes`
e audit append-only ricevono scritture dalle nuove RPC. La Fase 3a continua a
scrivere solo le proprie identità fisiche e link. Nessuna DML catalogo live.

Lock NOWAIT su sorgenti/catalogo e tabelle fondazione proteggono anche insert
concorrenti; confronto baseline dopo lock, doppie registrazioni/collisioni
bloccate. Una verifica fallita non aggiorna parzialmente record o audit.

## Verifica e rollback

Test PostgreSQL/WASM isolati con fixture, senza rete/DB remoto: autorizzazioni,
assenza backfill, due fasi di conferma, SI indipendenti, cardinalità/Par/intervallo,
collisioni, basi mutate, guard e rollback atomico su errore intermedio; compatibilità
di una bozza di configurazione Fase 3b già registrata. I test WASM non simulano
sessioni PostgreSQL concorrenti separate: NOWAIT e lock sono verificati nel SQL,
mentre CAS/doppie richieste sono esercitati sul database isolato.

Prima del COMMIT la migration è interamente transazionale. Dopo applicazione,
disabilitare/ignorare la sezione Fase 3c o revocare EXECUTE delle tre nuove RPC
ferma ulteriori operazioni senza impatto sui consumer live. Conservare fondazione
e audit se già usati; non cancellare dati o ripristinare il vecchio guard/CHECK su
record Fase 3c esistenti. Ogni rollback DDL successivo richiede uno script dedicato.

Fuori fase: multi-9, Marina Velka, rating/tee/distanze, override con Par discordanti,
editing Par/SI, propagazione/pubblicazione live e attivazione dei consumer.
