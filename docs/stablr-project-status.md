# Stablr Project Status

Documento centrale di handoff del progetto. Riassume esclusivamente lo stato ricostruibile dagli artefatti nel repository; non sostituisce la documentazione specialistica collegata.

## 1. Product overview

Stablr e' un prodotto per configurare e giocare giri di golf con dati di club, percorsi, buche, PAR, Stroke Index e tee. Per i club italiani, FIG definisce l'identita' ufficiale del catalogo; Stablr pubblica un layer giocabile e ne assume la responsabilita' editoriale, distinguendo chiaramente dati giocabili, evidenze e certificazione.

L'obiettivo e' diventare una fonte affidabile, tracciabile e utilizzabile dei campi italiani, senza trasformare automaticamente una fonte dati in una certificazione. Riferimento: [Governance Framework v3](./stablr-course-data-governance.md).

## 2. Current architecture

- Frontend React (Create React App) con integrazione Supabase configurata tramite variabili `REACT_APP_SUPABASE_URL` e `REACT_APP_SUPABASE_ANON_KEY`; riferimento: [`src/lib/supabase.js`](../src/lib/supabase.js) e [`package.json`](../package.json).
- Supabase e' il backend previsto per catalogo, giri, preferiti, richieste, catalogo FIG e flusso di staging delle scorecard. Gli schemi e le policy sono versionati in [`supabase/`](../supabase/).
- La pipeline locale FIG/GesGolf produce payload JSON normalizzati e validati, poi utilizzabili per seed controllati verso Supabase. Riferimenti: [pipeline FIG](../scripts/fig/README.md), [formato FIG catalog](../supabase/fig-catalog-normalized-format.md) e [formato FIG/WHS](../supabase/fig-whs-normalized-format.md).

Lo stato effettivo dell'architettura remota e del deployment non e' deducibile dai file locali: vedere [Remote/live state](#8-remotelive-state).

## 3. Course data architecture

- **FIG**: catalogo federale chiuso per club, playable course, tee, Course Rating e Slope Rating. Non si inventano identita' quando un record FIG esiste.
- **GesGolf**: source operativa secondaria per buche, PAR, Stroke Index e hole mapping; non certifica da sola un percorso.
- **Evidence**: scorecard, PDF, pagine percorso del club, foto e conferme che sostengono le decisioni editoriali.
- **Playable course**: unita' di lavoro e governo pari a `fig_club + fig_playable_course`; il layer Stablr espone solo route e combinazioni pubblicate e mappate esplicitamente.
- **Layer editoriale Stablr**: valuta fonti ed evidenze, applica guardrail, decide lo stato e conserva motivazione/versioning concettuale.

Riferimenti: [Governance Framework](./stablr-course-data-governance.md), [FIG matching design](../supabase/fig-matching-design.md), [FIG catalog format](../supabase/fig-catalog-normalized-format.md), [FIG/WHS format](../supabase/fig-whs-normalized-format.md).

## 4. Governance

- **Green / Stablr Approved**: percorso certificato da una decisione editoriale Stablr esplicita, motivata e auditabile; non e' un attributo ereditato dalla source.
- **Orange / playable review**: percorso giocabile e tecnicamente coerente entro i limiti delle fonti disponibili, ma non certificato. E' uno stato stabile, non un verde incompleto.
- **Review / block**: anomalie, evidenze insufficienti o conflitti restano in review; un blocco impedisce la pubblicazione/uso secondo gravita'.
- **Staging / published**: import e contributi non modificano direttamente il live. I dati passano da staging, guardrail ed evaluate a una decisione controllata di publish; una sola versione published e' prevista per playable course.

La definizione completa, inclusi stati, guardrail, criteri oggettivi, audit e versioning, e' nel [Governance Framework v3](./stablr-course-data-governance.md).

## 5. Current development status

| Area | Stato | Evidenza persistente |
| --- | --- | --- |
| Catalogo/campi | **IN CORSO** | Pipeline e batch progressivi esistono; la copertura completa non risulta conclusa. |
| Frontend | **IN CORSO** | Implementazione presente in [`src/App.js`](../src/App.js), inclusi ricerca club, setup giro e stati dati. Copertura e test end-to-end attuali: **DA VERIFICARE**. |
| Backend/Supabase | **IN CORSO** | Schemi, policy e script di seed sono presenti. Applicazione reale delle migrazioni e coerenza DB: **DA VERIFICARE**. |
| Scorecard contribution flow | **IN CORSO** | Design, UX flow, schema/RLS e codice di upload/staging sono presenti; verifica end-to-end sul backend remoto: **DA VERIFICARE**. |
| Autenticazione/utenti | **IN CORSO** | Il frontend contiene flusso OTP e sessione Supabase. Provider/configurazione remota e test reale: **DA VERIFICARE**. |
| Round/play functionality | **IN CORSO** | Il frontend legge/scrive giri e route; test di gioco su ambiente reale: **DA VERIFICARE**. |
| Admin/review | **DA FARE** | Il Governance Framework indica come MVP ancora aperti certification dashboard, evidence panel, azioni editoriali e audit base. |
| Deployment | **DA VERIFICARE** | Non e' presente un documento di stato del deploy o della beta attiva. |
| Beta/security | **DA FARE** | Prima della beta pubblica e' richiesto l'audit RLS e anti-scraping descritto nel checkpoint dedicato. |

## 6. Current data-pipeline status

La pipeline FIG/GesGolf e' attiva: dispone di scraper, normalizzazione, mapping, classificazione import e validazione. Il report di stato registra 220 club FIG, 184 match GesGolf forti e 36 deboli/assenti; questi conteggi sono una fotografia del report e vanno rieseguiti se servono dati aggiornati.

I batch 161--180 e 181--200 hanno report dedicati. Il riesame del 2026-09-08 dei 13 club arancioni ha promosso Metaponto e mantenuto gli altri 12 in review, con Casalunga in review esplicita per conflitto di versioni. Il batch controllato e i recovery gruppi 1 e 2 del 2026-09-21/22 hanno portato il remoto verificato a 217 club Stablr attivi e giocabili: 100 verdi e 117 arancioni. Il catalogo FIG normalizzato corrente contiene 220 identita'; la tabella remota `fig_clubs` conserva inoltre 8 alias legacy HTML-encoded, da non contare come nuove identita'. Restano fuori dal layer giocabile 5 identita' FIG canoniche con 21 route attive. I club manuali Mare di Roma e Parco de' Medici restano protetti dagli automatismi.

Riferimenti operativi:

- [GesGolf Pipeline Status](../data/gesgolf/reports/gesgolf-pipeline-status.md)
- [Coverage FIG--GesGolf](../data/gesgolf/reports/fig-gesgolf-coverage.csv)
- [Website evidence audit](../data/gesgolf/reports/website-evidence-audit.md)
- [Audit batch 161--180](../data/gesgolf/reports/third-level-audit-batch-20-2026-08-25.md)
- [Audit batch 181--200](../data/gesgolf/reports/third-level-audit-batch-20-2026-09-08.md)
- [Batch finale controllato 2026-09-21](../data/gesgolf/reports/final-catalog-batch-2026-09-21.md)
- [Riesame 13 arancioni](../data/gesgolf/reports/third-level-rereview-orange-13-2026-09-08.md)
- [Mismatch Parco de' Medici](../data/gesgolf/reports/parco-de-medici-gesgolf-mismatch.md)

## 7. Known technical debt / risks

- La copertura e la verifica manuale dei club non sono concluse; mapping ambigui, route legacy/provvisorie e scorecard senza SI ufficiale richiedono review.
- Le feature di certification/admin previste nel MVP del Framework non risultano complete.
- Il flusso staging e le RLS richiedono verifica reale sul backend, non solo presenza di schema e codice.
- Prima della beta pubblica e dopo il completamento della copertura prodotto serve un audit dedicato di RLS, grants, superficie di scraping, query frontend, eventuali Edge Function, rate limiting e logging. Riferimento: [Beta security checkpoint](../supabase/beta-security-checkpoint.md).
- Non assumere che i seed o i report locali rendano automaticamente il catalogo remoto aggiornato.

## 8. Remote/live state

| Ambito | Stato verificabile dal repository |
| --- | --- |
| Supabase remoto | Snapshot verificato il 2026-09-22 dopo il recovery gruppo 2: 217 club Stablr attivi, tutti giocabili; 220 identita' FIG canoniche locali e 228 righe `fig_clubs` remote per 8 alias legacy. Verifiche future devono comunque interrogare nuovamente il remoto. |
| Migrazioni applicate | **DA VERIFICARE**: il repository contiene le migrazioni/schema, non prova dell'ordine o dell'esito di applicazione remoto. |
| Seed | Recovery batch gruppo 1 verificato dopo seed: payload e remoto coincidono per i cinque club; dettaglio nel report specialistico. Altri batch o migrazioni restano da verificare per task. |
| RLS live | Policy SQL presenti; policy effettivamente applicate e testate in remoto: **DA VERIFICARE**. |
| Dati live | Snapshot catalogo verificato il 2026-09-22: 217 club giocabili, 100 verdi e 117 arancioni. Non assumere che lo snapshot resti valido senza una nuova query remota. |
| Deployment corrente | **DA VERIFICARE**: nessun artefatto di deployment/stato ambiente e' stato individuato. |

## 9. Product roadmap

Ordine ricostruibile dai documenti, non una roadmap con scadenze:

1. **Catalogo completo**: continuare batch FIG/GesGolf, risolvere mapping a bassa confidenza e fare audit manuale a tre livelli; mantenere arancio quando l'evidenza non consente il verde.
2. **Catalogo giocabile coerente**: validare gli import, applicare/controllare seed verso Supabase in modo controllato e testare ricerca, badge, setup giro e avvio giro su campi 9, 18 e complessi.
3. **Beta privata**: completare o decidere il perimetro del surface admin/review MVP, verificare flussi OTP, contribution/staging e round su backend remoto. Priorita' e criterio di uscita della beta privata: **DA DECIDERE DAL PRODUCT OWNER**.
4. **Beta pubblica / release**: completare il checkpoint di sicurezza (RLS, grants e anti-scraping), risolvere le regressioni emerse e verificare deployment/live state. Requisiti commerciali, scadenze e perimetro di release: **DA DECIDERE DAL PRODUCT OWNER**.

Le evoluzioni successive previste dal Framework includono scorecard upload completo, coinvolgimento diretto dei club, quality dashboard e governance continuativa.

## 10. Next recommended task

Il prossimo task tecnico naturale, sulla base del [pipeline status](../data/gesgolf/reports/gesgolf-pipeline-status.md), e' il recovery delle cinque identita' FIG residue (`Tauriana`, `Tirrenia`, `Valpescara`, `Verdura`, `Villa Giusti`) e delle loro 21 route attive, usando la migliore combinazione disponibile di FIG, fonti ufficiali e fonti secondarie affidabili. GesGolf resta una Source operativa utile ma non obbligatoria per l'arancione; ogni risultato deve produrre o aggiornare il relativo report persistente e non deve toccare i club protetti.

Prima di qualunque seed o modifica del DB remoto, verificare esplicitamente lo stato live e le autorizzazioni.

## 11. Important project documents

- [AGENTS.md](../AGENTS.md) — istruzioni Codex specifiche del repository.
- [Governance Framework v3](./stablr-course-data-governance.md) — regole prodotto, governance e ADR.
- [GesGolf Pipeline Status](../data/gesgolf/reports/gesgolf-pipeline-status.md) — stato operativo e handoff pipeline.
- [FIG matching design](../supabase/fig-matching-design.md) — matching e club protetti.
- [FIG catalog normalized format](../supabase/fig-catalog-normalized-format.md) e [FIG/WHS normalized format](../supabase/fig-whs-normalized-format.md) — contratti dati.
- [Scorecard staging design](../supabase/scorecard-staging-design.md), [schema](../supabase/scorecard-staging-schema.sql), [RLS](../supabase/scorecard-staging-rls.sql) e [UX flow](../supabase/scorecard-staging-ux-flow.md) — contributi e review.
- [Beta security checkpoint](../supabase/beta-security-checkpoint.md) — prerequisito sicurezza pre-beta pubblica.
- [Website evidence audit](../data/gesgolf/reports/website-evidence-audit.md) e report di batch in [`data/gesgolf/reports/`](../data/gesgolf/reports/) — decisioni e audit dati.
- [`supabase/shared-catalog-schema.sql`](../supabase/shared-catalog-schema.sql) e [`supabase/fig-catalog-schema.sql`](../supabase/fig-catalog-schema.sql) — schema dei layer giocabile e FIG.

## 12. Handoff rules

Ogni nuova sessione Codex deve:

1. leggere [`AGENTS.md`](../AGENTS.md);
2. leggere questo Project Status;
3. consultare soltanto i documenti specialistici necessari al task;
4. verificare `git status` prima di modificare;
5. non assumere mai che lo stato locale descriva il database remoto;
6. aggiornare questo documento quando viene raggiunto un milestone significativo, cambia la roadmap o viene verificato uno stato remoto finora ignoto.
