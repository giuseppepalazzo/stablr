# Stablr Course Data Governance Framework

## Scorecard Validation & Certification Pipeline

Versione 3.0 — Frozen Reference

### Executive Summary

Stablr Course Data Governance Framework definisce il modo in cui Stablr governa Acquire, Normalize, Evaluate, Certify, Publish, Version e Audit dei dati dei campi da golf italiani.

La Scorecard Validation & Certification Pipeline è una parte di questa governance: il processo con cui i dati buca-per-buca passano da Normalize, confronto con Evidence, Guardrail, eventuale Certification e Publish nel layer giocabile.

Stablr non costruisce semplicemente scorecard. Stablr esercita una responsabilità editoriale sui dati che decide di rendere giocabili, visibili e certificati.

Ogni percorso pubblicato rappresenta una responsabilità editoriale di Stablr.

Stablr vuole diventare la versione più affidabile, tracciabile e giocabile dei campi italiani: non perché possiede tutte le Source, ma perché sa distinguere Source, Evidence, decisione editoriale e storico delle versioni.

Per questo motivo devono restare sempre separati:

- catalogo ufficiale FIG;
- Source operative come GesGolf;
- Evidence raccolte da utenti, club e admin;
- layer certificato Stablr.

Il badge verde non indica semplicemente che un dato arriva da una Source “buona”. Indica che Stablr ha preso una decisione editoriale esplicita: quel percorso è certificato da Stablr.

Il badge arancio non è solo una fase temporanea prima del verde. È uno stato stabile e legittimo: il percorso è giocabile, i dati sono sufficientemente affidabili, ma Stablr non li ha ancora certificati.

Le Source possono cambiare, le Evidence possono aumentare, la Certification può evolvere. Il dato rimane sempre legato al percorso FIG.

L’unità minima di governo del dato è sempre:

```text
fig_club + fig_playable_course
```

non il club intero.

---

## 1. Principi guida

### 1.1 Affidabilità prima della quantità

Stablr può accelerare la copertura dei club italiani tramite import, automazioni e contributi della community, ma non deve fingere una certezza che non possiede.

È preferibile avere un percorso arancio, giocabile e trasparente, rispetto a un percorso verde certificato senza Evidence sufficienti.

### 1.2 FIG come catalogo ufficiale chiuso

Per i club italiani presenti nel catalogo FIG:

- non si inventano nomi club;
- non si inventano nomi percorso;
- non si inventano tee;
- non si creano varianti libere;
- si lavora solo sui percorsi ufficiali FIG.

FIG resta il riferimento per:

- club;
- percorsi ufficiali;
- tee;
- Course Rating;
- Slope Rating.

### 1.3 Separazione tra Source ed Evidence

Stablr distingue sempre tra Source ed Evidence.

| Concetto | Significato | Esempi |
|---|---|---|
| Source | origine strutturata del dato | FIG, GesGolf |
| Evidence | prova che supporta o rafforza il dato | foto scorecard, PDF ufficiale, sito club, mail club, controllo sul campo, più foto concordanti |

Una Source può fornire dati. Una Evidence aiuta Stablr a decidere se quei dati sono affidabili, pubblicabili o certificabili.

Questa distinzione deve restare stabile in tutto il prodotto: una Source non diventa automaticamente una Evidence sufficiente, e una Evidence non diventa automaticamente una nuova Source strutturata.

### 1.4 Data Ownership

Il dato appartiene sempre al percorso FIG.

Le Source possono cambiare. Le Evidence possono aumentare. La Certification può evolvere. Ma la responsabilità editoriale, lo storico e lo stato pubblicato devono restare agganciati a:

```text
fig_club + fig_playable_course
```

Questo evita che import, fotografie o controlli puntuali creino identità parallele del percorso.

### 1.5 Nessun aggiornamento live senza controllo

Foto, OCR, import GesGolf o contributi utenti non devono mai aggiornare direttamente il database live.

Ogni dato passa da:

- staging;
- guardrail;
- Evaluate;
- decisione di Publish o Certification.

### 1.6 Certification come decisione editoriale

Il verde è una decisione Stablr.

Non significa:

```text
Questo dato proviene da una Source nota.
```

Significa:

```text
Percorso certificato da Stablr.
```

La Certification non è una proprietà della Source. FIG, GesGolf, una scorecard ufficiale o una mail del club possono contribuire alla decisione, ma non certificano automaticamente il percorso dentro Stablr.

La Certification deve essere tracciabile, motivata e reversibile tramite Version.

### 1.7 Arancio come stato stabile

L’arancio non è un “quasi verde”.

Significa:

- percorso giocabile;
- dati tecnicamente coerenti;
- affidabile entro i limiti delle Source disponibili;
- nessun blocco critico;
- Certification Stablr non ancora concessa.

Un percorso può restare arancio anche a tempo indeterminato.

### 1.8 Automation Philosophy

L’automazione accelera il lavoro editoriale, ma non lo sostituisce.

Import, scraping, OCR, matching e Quality Score possono aiutare Stablr ad Acquire, Normalize, Evaluate e prioritizzare i percorsi. Nessun algoritmo certifica automaticamente un percorso.

La decisione verde resta sempre umana, motivata e auditabile.

### 1.9 Audit

Ogni decisione significativa deve registrare:

- chi ha deciso;
- quando;
- su quale percorso FIG;
- con quali Source;
- con quali Evidence;
- con quale motivazione;
- quale stato precedente è stato sostituito.

---

## Product Invariants

Gli invarianti sono regole di sistema. Non descrivono workflow e non dipendono dalla tecnologia utilizzata.

Queste regole non dovrebbero essere violate da evoluzioni future di prodotto, database, automazioni o UX.

- Deve esistere un solo percorso Published per ogni fig_playable_course.
- Nessun dato entra nel layer live tramite Publish automatico.
- FIG definisce l’identità del percorso.
- Lo staging è sempre separato dal live.
- La Certification è sempre auditabile.
- Il dato appartiene al percorso FIG, non alla Source.
- Ogni decisione editoriale deve essere motivata.
- Le Source forniscono dati, ma non certificano percorsi.
- Le Evidence supportano decisioni, ma non sostituiscono la decisione.
- Le versioni precedenti non vengono cancellate.
- La Certification verde richiede sempre una decisione Stablr.

---

## 2. Scorecard Validation & Certification Pipeline

Il ciclo di vita del dato segue questo flusso:

```text
Acquire
↓
Normalize
↓
Guardrail
↓
Evaluate
↓
Certify
↓
Publish
↓
Version
↓
Audit
```

### 2.1 Acquire

I dati possono arrivare da:

- import GesGolf;
- foto scorecard caricata da utente;
- più foto di supporto;
- PDF ufficiale del club;
- sito ufficiale del club;
- controllo manuale Stablr;
- comunicazione diretta del club;
- esperienza sul campo di admin o collaboratori.

Acquire non implica mai Publish.

### 2.2 Normalize

Ogni dato acquisito viene portato in Normalize su:

- fig_club;
- fig_playable_course;
- numero buca;
- par;
- Stroke Index;
- eventuale hole mapping;
- Source;
- Evidence collegate;
- anomalie rilevate.

### 2.3 Guardrail

I guardrail servono a impedire che dati apparentemente buoni entrino nel layer giocabile o certificato quando esistono incoerenze strutturali.

Esempi:

- Stroke Index fuori range;
- Stroke Index duplicati;
- Stroke Index compressi 1–9 non risolti;
- par totale incoerente;
- route duplicata;
- percorso provvisorio non chiarito;
- 9 buche non compatibile con il 18 ufficiale;
- dati mancanti;
- mapping FIG/GesGolf ambiguo.

### 2.4 Evaluate

Evaluate combina:

- coerenza tecnica;
- Source disponibili;
- Evidence disponibili;
- guardrail;
- note admin;
- eventuale Quality Score interno.

Evaluate prepara la decisione, ma non la sostituisce.

### 2.5 Certification Decision

L’admin non esegue solo un controllo operativo.

L’admin decide se:

- Certify;
- lasciare arancio;
- bloccare;
- segnare problema noto;
- richiedere ulteriori Evidence;
- contattare il club.

Certify è sempre una decisione editoriale. Può essere supportata da automazione, ma non prodotta automaticamente dall’automazione.

### 2.6 Publish

Publish rende un dato disponibile nel layer giocabile.

Può avvenire in due forme:

- arancio giocabile;
- verde certificato.

Il Publish verde richiede decisione esplicita Stablr.

### 2.7 Version

Ogni scorecard certificata o pubblicata deve poter essere sostituita tramite Version senza cancellare la precedente.

Una versione vecchia diventa superseded.

Una Certification non scade automaticamente, ma può perdere freschezza nel tempo. La Certification Freshness indica quanto la decisione verde resta attuale rispetto a nuove Source, nuove Evidence o possibili cambiamenti del campo.

### 2.8 Audit

L’audit conserva:

- decisioni;
- motivazioni;
- Evidence usate;
- conflitti risolti;
- versioni precedenti;
- admin/operatori coinvolti.

---

## 3. Modello degli stati

| Stato | Significato | Visibilità | Note |
|---|---|---|---|
| missing | nessun dato buca-per-buca disponibile | non giocabile | CTA: completa o carica scorecard |
| draft_private | bozza privata | uploader/admin | può generare private preview |
| in_review | dati inviati a Stablr | admin, support photos | non certificato |
| playable_unverified | giocabile arancio | tutti | dati sufficienti, non certificati |
| certified | percorso certificato da Stablr | tutti | badge verde |
| known_issue | percorso pubblicato con problema noto | tutti/admin | giocabile con avviso o limitazione |
| superseded | versione sostituita | storico | non usata nel gioco corrente |

Nota: i nomi tecnici potranno evolvere. Il modello concettuale deve restare stabile.

---

## 4. Badge e significato prodotto

### 4.1 Verde — Percorso certificato da Stablr

Il verde significa:

```text
Percorso certificato da Stablr.
```

È una decisione editoriale, non una proprietà automatica della Source.

Non significa semplicemente “controllato”.

Significa che Stablr si assume la responsabilità editoriale di quel percorso pubblicato: dati, mapping, coerenza e motivazione della Certification sono stati valutati e ritenuti difendibili.

Un percorso verde deve avere:

- dati buca-per-buca completi;
- par coerenti;
- Stroke Index coerenti;
- nessun guardrail bloccante;
- Evidence sufficienti;
- decisione admin tracciata.

Copy UX suggerita:

```text
Certificato Stablr
Percorso certificato da Stablr.
```

### 4.2 Arancio — Giocabile, non certificato

L’arancio significa:

```text
Giocabile, non certificato.
```

Non è necessariamente temporaneo.

Un percorso può restare arancio se:

- i dati sono sufficientemente coerenti;
- il percorso è affidabile entro i limiti delle Source disponibili;
- non ci sono blocchi critici;
- manca una Evidence forte;
- Stablr non ha ancora deciso di certificarlo.

L’arancio non è un errore di prodotto. È un modo trasparente per accelerare la copertura mantenendo separata la giocabilità dalla Certification editoriale.

Copy UX suggerita:

```text
Giocabile, non certificato
I dati sono utilizzabili ma non ancora certificati da Stablr.
```

### 4.3 Problema noto

“Problema noto” indica che un percorso pubblicato presenta una criticità conosciuta, ma non necessariamente tale da rimuoverlo.

Usi possibili:

- dati generalmente giocabili, ma una route è sospetta;
- Stroke Index contestati;
- par o routing in attesa di conferma;
- Source ufficiale temporaneamente divergente;
- scorecard aggiornata segnalata ma non ancora valutata.

Copy UX suggerita:

```text
Problema noto
Questo percorso è giocabile, ma Stablr sta valutando una possibile anomalia.
```

---

## 5. Source Model

Le Source sono origini strutturate del dato.

| Source | Ruolo |
|---|---|
| FIG | catalogo ufficiale: club, percorsi, tee, CR, Slope |
| GesGolf | dato operativo: hole mapping, par buca, Stroke Index |
| Stablr | layer editoriale e certificato |

Le Source non hanno tutte lo stesso ruolo.

FIG può essere autoritativa su CR/Slope, ma non necessariamente contiene tutte le informazioni hole-by-hole necessarie al gioco.

GesGolf può essere utile sul buca-per-buca, ma non certifica automaticamente la correttezza Stablr.

Una Source può essere molto utile senza essere certificante. Il valore di una Source dipende dal tipo di dato: FIG governa l’identità ufficiale del percorso, GesGolf può aiutare sul dato operativo, Stablr decide cosa pubblicare e cosa certificare.

Le Source non possiedono lo stato del percorso. Lo stato vive sul percorso FIG governato da Stablr.

---

## 6. Evidence Model

Le Evidence sono prove che supportano un dato.

Esempi:

- foto scorecard utente;
- più foto concordanti;
- PDF ufficiale del club;
- pagina del sito ufficiale;
- email della segreteria;
- controllo sul campo;
- controllo manuale Stablr;
- confronto coerente FIG + GesGolf.

Le Evidence non sono scorecard concorrenti.

Sono elementi che rafforzano o indeboliscono la fiducia nella scorecard corrente.

Una Evidence può confermare un dato proveniente da una Source, contraddirlo o renderlo più forte. Può anche essere parziale: ad esempio una foto può confermare par e Stroke Index ma non le distanze.

| Evidence | Forza indicativa |
|---|---|
| PDF ufficiale club aggiornato | alta |
| foto scorecard leggibile | medio-alta |
| più foto concordanti | alta |
| controllo sul campo admin | medio-alta |
| GesGolf coerente con FIG | media |
| singola foto parziale | bassa |

---

## 7. Confidence

La Confidence riguarda l’affidabilità di un singolo dato, non lo stato complessivo del percorso.

È un principio architetturale futuro: dati diversi della stessa scorecard potrebbero avere confidence diverse.

- Par;
- Stroke Index;
- distanza;
- hole mapping;
- tee association.

Esempio:

| Dato | Confidence possibile |
|---|---|
| Par buca | alta se confermato da scorecard |
| Stroke Index | media se arriva solo da GesGolf |
| Hole mapping | bassa se route ambigua |
| Distanze | alta se FIG/scorecard ufficiale |

La Confidence non decide automaticamente Certification o Publish.

Serve a supportare admin e futuri strumenti di quality control.

Esempio: il Par potrebbe avere confidence alta perché confermato da più Evidence, mentre lo Stroke Index potrebbe restare medio perché disponibile solo da una Source operativa. La Certification finale valuta l’insieme, ma non cancella queste differenze interne.

---

## 8. Quality Score interno

Il Quality Score è un indicatore interno, non visibile agli utenti.

Serve a ordinare, filtrare e prioritizzare le decisioni admin.

Non certifica automaticamente e non deve essere mostrato come badge pubblico.

È un supporto operativo per capire dove intervenire prima, quali percorsi sono più vicini alla Certification e quali meritano attenzione. La Certification resta una decisione editoriale umana.

### Fattori che aumentano il Quality Score

- FIG e GesGolf coerenti;
- scorecard ufficiale disponibile;
- più Evidence concordanti;
- nessun guardrail;
- dati completi;
- controllo admin recente;
- club già confermato dalla segreteria.

### Fattori che lo diminuiscono

- route duplicate;
- dati provvisori;
- SI compressi non risolti;
- mismatch tra Source;
- foto illeggibili;
- Evidence vecchie;
- assenza di scorecard;
- club complesso.

Esempio uso admin:

```text
Mostra prima i percorsi arancio con Quality Score alto: sono i candidati migliori per diventare certificati.
```

---

## 9. Ruoli

| Ruolo | Responsabilità |
|---|---|
| Utente | gioca, segnala, carica scorecard |
| Uploader | crea una bozza o fornisce Evidence |
| Admin | Evaluate, Certify, blocca, Publish |
| Stablr | definisce criteri, mantiene governance, gestisce qualità |
| Club/segreteria | può fornire Evidence ufficiali o conferme |

---

## 10. Admin Certification Surface

L’admin surface deve essere desktop-friendly, ma coerente con un prodotto mobile-first.

### 10.1 Dashboard Certification

Sezioni:

- arancioni ad alto Quality Score;
- scorecard utenti in attesa;
- guardrail/bloccati;
- problemi noti;
- club complessi;
- certificati recenti.

### 10.2 Submission list

Filtri:

- stato;
- club;
- percorso FIG;
- Source;
- evidence type;
- guardrail;
- Quality Score;
- data aggiornamento.

### 10.3 Dettaglio percorso

Mostra:

- club FIG;
- percorso FIG;
- stato attuale;
- dati live;
- dati GesGolf;
- Evidence;
- anomalie;
- note;
- cronologia decisioni.

### 10.4 Confronto Evidence

Tabella per buca:

| Buca | Live | GesGolf | Foto/PDF | Admin |
|---|---|---|---|---|
| 1 | Par/SI | Par/SI | Par/SI | decisione |

### 10.5 Decisione finale

Azioni:

- certifica percorso;
- lascia arancio;
- segna problema noto;
- blocca;
- richiedi Evidence;
- contatta club;
- crea nuova versione.

---

## 11. Evaluate di import GesGolf arancio

Flusso:

1. GesGolf produce dati coerenti.
2. Il percorso viene importato come arancio.
3. Il percorso è giocabile ma non certificato.
4. Admin apre la Certification Surface.
5. Admin confronta:
   - FIG;
   - GesGolf;
   - eventuali Evidence;
   - guardrail;
   - Quality Score.
6. Admin decide:
   - certifica;
   - lascia arancio;
   - problema noto;
   - blocca.

---

## 12. Evaluate di scorecard caricata da utente

Flusso:

1. Utente carica foto.
2. Nasce una bozza privata o Evidence collegata.
3. Se l’utente completa/invia, passa a in_review.
4. Admin confronta foto con:
   - FIG;
   - GesGolf;
   - dati live;
   - altre Evidence.
5. Admin può:
   - correggere;
   - chiedere supporto;
   - certificare;
   - creare nuova versione;
   - bloccare.

La foto non produce mai Publish diretto.

---

## 13. Guardrail

| Caso | Tipo | Azione |
|---|---|---|
| SI fuori 1–18 | blocco | non importare |
| SI compressi non risolti | blocco | Evaluate obbligatorio |
| route duplicata | Evaluate | richiede classificazione |
| percorso provvisorio | Evaluate | non certificare automaticamente |
| par totale incoerente | blocco/Evaluate | dipende dalla gravità |
| club complesso | Evaluate | workflow dedicato |
| Source divergente | Evaluate | confronto Evidence |

I guardrail non sono un fastidio operativo: sono ciò che permette alla pipeline di scalare senza degradare la qualità.

---

## 14. Club complessi

I club complex_official richiedono governance dedicata.

Esempi:

- molte route da 9;
- combinazioni ufficiali;
- routing invertito;
- scorecard con SI specifici per combinazione;
- percorsi provvisori.

Regole:

- niente Certification automatica;
- niente assunzioni su combinazioni;
- priorità a scorecard ufficiale;
- Publish per singolo percorso/combinazione FIG;
- eventuale supporto da segreteria club.

---

## 15. Esperienza utente

### Missing

```text
Da completare
Aiutaci a configurare questo percorso caricando una scorecard.
```

### Draft privata

```text
Bozza privata
Puoi usare questo percorso in anteprima mentre Stablr lo valuta.
```

### Arancio

```text
Giocabile, non certificato
I dati sono disponibili ma non ancora certificati da Stablr.
```

### Verde

```text
Certificato Stablr
Questo percorso è stato certificato da Stablr.
```

### Problema noto

```text
Problema noto
Questo percorso è giocabile, ma Stablr sta valutando una possibile anomalia.
```

---

## 16. Criteri oggettivi per Certification verde

Un percorso può diventare certificato se:

- è associato a un fig_playable_course;
- ha buche complete;
- ha par coerenti;
- ha SI validi e completi;
- non ha guardrail bloccanti;
- ha almeno una Evidence forte o più Evidence coerenti;
- l’admin ha registrato una decisione motivata;
- la versione Published è tracciabile.

Il verde non richiede necessariamente conferma del club, ma richiede una decisione Stablr difendibile.

La Certification non deriva automaticamente da un punteggio, da una Source o da una singola Evidence. È il risultato di un Evaluate editoriale che considera dati, contesto, rischi e responsabilità di Publish.

---

## 17. Audit

Ogni decisione deve tracciare:

- operatore;
- timestamp;
- percorso FIG;
- stato precedente;
- nuovo stato;
- Source usate;
- Evidence usate;
- motivazione;
- eventuali problemi noti;
- versione generata o aggiornata;
- livello di Certification Freshness, quando rilevante;
- nuove Source o Evidence che hanno motivato una rivalutazione.

Esempio:

```text
Certificato da Giuseppe il 2026-07-05.
Motivo: FIG + GesGolf coerenti, scorecard ufficiale controllata.
```

L’audit deve rendere ricostruibile non solo il dato finale, ma anche perché Stablr ha scelto di pubblicarlo, lasciarlo arancio, certificarlo, bloccarlo o segnalarlo come problema noto.

---

## 18. Version

Creare nuova versione quando:

- cambia par buca;
- cambia SI;
- cambia routing;
- cambia scorecard ufficiale;
- una versione provvisoria viene sostituita;
- una Evidence forte corregge il live.

Non serve nuova versione per:

- note interne;
- aggiunta di Evidence senza cambio dati;
- cambio Quality Score;
- cambio stato di Evaluate senza modifica live.

Le versioni precedenti non si cancellano.

Nel layer live deve esistere una sola versione Published per percorso giocabile. Le versioni precedenti restano storiche e auditabili, ma non competono con la versione corrente usata nel gioco.

### Certification Freshness

La Certification Freshness indica quanto una Certification resta attuale nel tempo.

Una Certification verde non scade automaticamente. Tuttavia può diventare meno fresca se:

- passa molto tempo dall’ultima decisione;
- emergono nuove Evidence;
- cambia il sito ufficiale del club;
- GesGolf o FIG mostrano variazioni rilevanti;
- gli utenti segnalano discrepanze;
- il club aggiorna scorecard, routing o dati buca.

La freshness non rimuove da sola il verde. Serve a suggerire monitoraggio, rivalutazione o richiesta di conferma.

---

## 19. Conflitti tra Source ed Evidence

Priorità indicativa:

1. FIG per identità, tee, CR, Slope.
2. Scorecard ufficiale club aggiornata.
3. Controllo Stablr.
4. GesGolf.
5. Foto utente.
6. Segnalazioni community.

Se Source ed Evidence divergono:

- non certificare automaticamente;
- aprire conflict Evaluate;
- documentare la divergenza;
- scegliere Source prevalente solo con nota admin.

Quando possibile, la decisione deve indicare se il conflitto riguarda una Source, una Evidence o l’interpretazione Stablr del percorso FIG.

---

## 20. MVP

MVP minimo:

- lista percorsi arancio;
- lista guardrail/bloccati;
- dettaglio percorso FIG;
- tabella buche/par/SI;
- Source disponibili;
- Evidence disponibili;
- note admin;
- azioni:
  - certifica;
  - lascia arancio;
  - problema noto;
  - blocca;
- audit minimo.

Non servono subito:

- OCR avanzato;
- workflow email club;
- dashboard qualità nazionale completa;
- version diff visuale;
- algoritmo automatico di Certification.

---

## 21. Evoluzione futura

### Fase 1

Certification Surface minima:

- arancio → certificato;
- arancio → problema noto;
- arancio → bloccato.

### Fase 2

Integrazione piena scorecard upload:

- foto;
- Evidence multiple;
- confronto visuale.

### Fase 3

Coinvolgimento club:

- richiesta conferma segreteria;
- allegati ufficiali;
- badge “confermato dal club”.

### Fase 4

Quality dashboard:

- copertura nazionale;
- score medio;
- percorsi a rischio;
- Certification da rivalutare per freshness.

### Fase 5

Governance continuativa:

- reminder periodici;
- revisioni stagionali;
- monitoraggio modifiche FIG/GesGolf.

---

## 22. Checklist MVP finale

- [ ] Certification dashboard admin
- [ ] Lista percorsi arancio
- [ ] Lista guardrail/bloccati
- [ ] Dettaglio fig_playable_course
- [ ] Confronto FIG/GesGolf/live
- [ ] Evidence panel
- [ ] Quality Score interno
- [ ] Note admin
- [ ] Azione “certifica”
- [ ] Azione “lascia arancio”
- [ ] Azione “problema noto”
- [ ] Azione “blocca”
- [ ] Audit base
- [ ] Badge verde come “Certificato Stablr”
- [ ] Badge arancio come “Giocabile, non certificato”
- [ ] Nessun publish automatico da foto/import
- [ ] Versioning concettualmente supportato
- [ ] Certification Freshness visibile almeno agli admin
- [ ] Decisione verde sempre motivata e auditabile

---

## Appendix A — Architectural Decision Records

Questa sezione conserva le motivazioni architetturali principali, senza raccontare la storia del progetto.

### A.1 FIG come catalogo ufficiale

FIG è il riferimento per identità club, percorsi ufficiali, tee, Course Rating e Slope Rating perché rappresenta il catalogo federale. Stablr non deve creare identità parallele quando un percorso FIG esiste.

### A.2 GesGolf come Source operativa, non certificante

GesGolf è prezioso per il dato buca-per-buca, par, Stroke Index e hole mapping quando disponibile. Tuttavia non certifica automaticamente un percorso Stablr: fornisce una Source operativa da portare in Evaluate, Normalize e confronto con Evidence.

### A.3 Verde come decisione editoriale

Il badge verde indica “Percorso certificato da Stablr”. Non è una proprietà ereditata da FIG, GesGolf o da una singola Evidence. Serve una decisione editoriale esplicita, motivata e auditabile.

### A.4 Arancio come stato stabile

L’arancio consente copertura e giocabilità senza simulare una certezza non ancora raggiunta. Può durare indefinitamente se il percorso resta affidabile entro i limiti delle Source disponibili ma non certificato da Stablr.

### A.5 Una sola versione Published

Per evitare ambiguità nel gioco, ogni percorso deve avere una sola versione Published corrente. Le versioni precedenti restano disponibili per audit, confronto e rollback concettuale, ma non devono competere nel layer live.

### A.6 Separazione tra staging e live

Lo staging permette ad Acquire, import, foto e controlli di essere portati in Evaluate prima di incidere sull’esperienza utente. Il live deve contenere solo dati Published tramite decisione controllata.

---

## Core Principles Recap

- La qualità viene prima della copertura.
- Il dato appartiene sempre al percorso FIG.
- Le Source forniscono dati.
- Le Evidence supportano decisioni.
- Nessuna Source certifica automaticamente un percorso.
- La Certification è una decisione editoriale di Stablr.
- Nessun dato entra nel layer live senza controllo.
- Una sola versione Published per percorso.
- Ogni decisione è auditabile.
- Lo storico non viene mai perso.
