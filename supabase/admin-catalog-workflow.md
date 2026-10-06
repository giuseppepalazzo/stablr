# Fondazione workflow catalogo Admin

Applicare manualmente `supabase/admin-catalog-workflow.sql` nel SQL Editor,
dopo lo schema catalogo, l'estensione tee e `admin-access.sql`. Lo script
non è stato applicato remotamente. È una migration incrementale transazionale
**one-shot**: una seconda esecuzione fallisce sugli oggetti esistenti e va
annullata, non sostituisce le tabelle né modifica i dati già salvati.

## Modello

`admin_catalog_drafts` conserva bozze con identificativo indipendente,
identità stabile `entity_key`, target live facoltativo, padre bozza facoltativo,
versione base facoltativa, snapshot JSON, formato (`schema_version = 1`),
revisione per concorrenza, stato interno e autori/date.

`admin_catalog_versions` è riservata alle versioni pubblicate dal futuro
workflow. Contiene snapshot, formato, target live, bozza origine, numero
versione, autore e data pubblicazione. La migration non inserisce versioni
e non offre un metodo client per crearle. Le versioni saranno generate nella
stessa transazione della pubblicazione, quando saranno definiti contratti e
validazioni specifici per ciascuna entità.

Una nuova entità mantiene `entity_key` anche quando in futuro riceverà il
suo `live_entity_id`: i due UUID non devono necessariamente coincidere.
La chiave esterna composta della versione base verifica tipo e identità.
Autori e riferimenti storici usano `ON DELETE RESTRICT`.

| Tipo chiuso | Target live attuale | Padre bozza consentito |
| --- | --- | --- |
| `club` | `clubs` | Nessuno |
| `course` | Nessuno, solo bozza concettuale | `club` |
| `route` | `course_routes` | `club` o `course` |
| `route_combination` | `route_combinations` | `club` |
| `hole` | `route_holes` | `route` |
| `combination_hole` | `route_combination_holes` | `route_combination` |
| `route_tee` | `route_tees` (tee/rating) | `route` |
| `combination_tee` | `combination_tees` (tee/rating) | `route_combination` |

Il padre è facoltativo anche per bozze di entità live. Se specificato, deve
esistere, essere in stato `draft` e rispettare questa gerarchia. I tipi fissi
e la gerarchia impediscono cicli nelle relazioni create dalle RPC.

Lo snapshot v1 è un oggetto JSON; il formato è conservato in una colonna
dedicata. Si validano tipo, formato, target, padre e appartenenza della base.
La validazione dei campi di dominio e la coerenza tra riferimenti live di
parent/child saranno definite dai futuri contratti di pubblicazione.

## Contratti e autorizzazioni

Le tabelle hanno RLS con sola SELECT per Admin autenticati. Nessun ruolo
API, incluso `service_role`, riceve INSERT/UPDATE/DELETE/TRUNCATE diretti.
Gli utenti normali non possono leggere righe; anon non ha SELECT.

Le tre RPC restituiscono la riga bozza e sono `SECURITY DEFINER` con
`search_path = pg_catalog` e riferimenti qualificati. Solo `authenticated`
ha EXECUTE, e ogni chiamata richiede `auth.uid()`, ruolo autenticato e
`public.is_admin() = true`. Utenti normali, anon e service API non possono
eseguire operazioni workflow. Gli helper non sono eseguibili dai client.

| RPC | Operazione |
| --- | --- |
| `admin_catalog_create_draft` | Crea una bozza per entità nuova o live, con padre e base opzionali |
| `admin_catalog_save_draft` | Sostituisce lo snapshot solo se `p_expected_revision` coincide; incrementa la revisione |
| `admin_catalog_restore_version` | Copia una versione in una nuova bozza, mantenendo identità e riferimento base |

Un conflitto di revisione, una bozza mancante o archiviata restituiscono
SQLSTATE `40001`. Payload/riferimenti non validi restituiscono `22023`;
autorizzazione negata restituisce `42501`. Autori e timestamp sono calcolati
nel database, non accettati come argomenti client.

Trigger bloccano UPDATE/DELETE/TRUNCATE delle versioni e DELETE/TRUNCATE
delle bozze, anche in normali operazioni privilegiate. Come qualsiasi
protezione SQL, ciò non impedisce a un amministratore del database di
rimuovere deliberatamente trigger o tabelle.

`workflow_status` supporta `draft`/`archived`; nessuna RPC di archiviazione
è esposta in questa fondazione. Questo stato non modifica `is_active`,
`data_status`, pubblicazione o visibilità giocatore. `needs_review` resta
riservato al flusso dei contenuti esterni.

## Integrazione e verifiche

`src/admin/catalog-workflow.js` espone un adattatore con sole operazioni
create/save/restore; non viene importato dalla UI né dall'app giocatore.
Gli errori RPC vengono propagati al futuro chiamante, inclusi i conflitti.

Test UI/client: `CI=true npm test -- --runInBand`.

Test SQL isolato: `node --test scripts/tests/admin-catalog-workflow.test.mjs`
con `@electric-sql/pglite` disponibile. È possibile installarlo in una
cartella temporanea e impostare `STABLR_PGLITE_MODULE` al suo entrypoint
assoluto. Il test crea un database PostgreSQL in memoria e fixture solo
test, verifica permessi/immutabilità/ripristino/concorrenza e chiude il DB.
Non legge configurazioni o credenziali di produzione.

## Rimandato

Editor e azioni UI; pubblicazione atomica specifica per entità; validazione
di dominio e dipendenze live; gestione dei riferimenti tra nuove entità;
archiviazione operativa; confronto/diff; decisioni Revisioni; cestino.
I test PostgreSQL verificano i contratti dello schema locale ispezionato,
non una configurazione remota o l'esposizione HTTP effettiva di PostgREST.
