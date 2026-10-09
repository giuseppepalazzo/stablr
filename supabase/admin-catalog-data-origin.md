# Fase 4 — Impatto e origine dati (sola lettura)

Applicare **una sola volta** `supabase/admin-catalog-data-origin.sql`, interamente,
nel SQL Editor del progetto, dopo le fondazioni fisiche e gli editor già applicati
(Fasi 1–3c, multi-9, proposte club e riparazione preview). Non rieseguire gli script
storici. Questo task non applica SQL remoto.

Unica RPC: `admin_catalog_data_origin(p_club_id uuid)`. `STABLE SECURITY DEFINER`,
search path fisso, autorizzazione runtime `admin_catalog_require_admin()`;
EXECUTE solo ad authenticated. Anon, player, identità assente e service API negati.
Una SELECT restituisce una fotografia coerente del club, contratto **v2**:
fondazione, componenti, record live, override tee normalizzati e metadati delle
bozze attive. Nessun nuovo grant su tabelle, RLS, trigger o tabella.

Ogni oggetto della risposta è costruito con un'allowlist esplicita di campi.
Non viene usato `to_jsonb`; nessuna colonna futura viene esportata implicitamente.
Non sono restituiti `source_payload`, `source_snapshot`, `registration_snapshot`,
`snapshot`, `base_snapshot`, contesti completi, versioni complete, email, nomi
utente, UUID autore, note libere o riferimenti/URL sorgente arbitrari. Gli autori
bozza sono indicati soltanto come Admin corrente/altro Admin, senza leggere utenti.

I confronti delle sorgenti, tee, campi bozza, data e versione base restano privati
nel server. Sono restituiti solo `source_state`, `tee_state`, `has_changes` e
`base_status`; i casi non supportati/incompleti restano non determinabili. Il
confronto delle griglie è per identità buca, indipendente dall'ordine del JSON.
L'UUID filtra il club e le relazioni esplicite prima di qualsiasi aggregazione;
eventuali blob estranei incorporati negli snapshot/payload non sono esportati.

La UI distingue cardinalità, collegamento verificato e pubblicabilità **non
valutata**. Legge soltanto FK della fondazione o riferimenti live esatti; non
certifica associazioni mancanti. I componenti multi-9 sono letti dalla relazione
dedicata, non da un padre singolo inventato. La regola SI 9×2 viene mostrata solo
per la derivazione esplicitamente registrata. Un override Par uguale alla base
resta un override esplicito.

Le matrici sorgente vengono ricostruite come `tee_matrix`, mai copiate integralmente:
presenza, fonte da enum noto (altrimenti NULL), stato evidenza, cardinalità/Par totale
tecnico numerici e celle numero buca/Par/SI. Solo chiavi tecniche colori note, senza
etichette arbitrarie, URL, note, distanze o extra; massimo 18 celle per chiave e due
occorrenze SI. Celle di tipo o dominio non riconosciuto diventano NULL, non testo
arbitrario. Le chiavi/strutture non riconosciute sono segnalate senza esportarne
il contenuto. È un filtro dell'output, non una nuova validazione o modifica del live.
I tee espongono solo la presenza del proprio payload, oltre ai campi rating/stato.
Nessun matching da nome/colore. I risultati degli override normalizzati sono valori
di fondazione, non nuovi valori del giocatore. Un tee NULL eredita l'ambito dal suo
Percorso tramite FK, non l'applicabilità. Lacune, sorgenti cambiate e bozze divergenti
sono diagnosi read-only, non nuovi blocchi negli editor.

Il confronto bozze riguarda i campi letti, data e versione base; non sostituisce i
controlli dei publisher. Nessuna propagazione, modifica, pubblicazione, riconciliazione
o chiusura di bozze. Lo storico esistente nel dettaglio resta invariato.

Rollback: ritirare l'esploratore UI e revocare/eliminare soltanto la nuova RPC
`public.admin_catalog_data_origin(uuid)` tramite un successivo script controllato.
Nessuna riga da ripristinare, migrare o eliminare; live, giri e storico non cambiano.
