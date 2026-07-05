# Stablr Course Data Governance

## Scorecard Validation & Certification Pipeline

### Executive Summary

Stablr Course Data Governance definisce il modo in cui Stablr acquisisce, valuta, certifica, pubblica e mantiene nel tempo i dati dei campi da golf italiani.

La Scorecard Validation & Certification Pipeline è una parte di questa governance: il processo con cui i dati buca-per-buca vengono normalizzati, confrontati con evidenze, controllati da guardrail, eventualmente certificati da Stablr e pubblicati nel layer giocabile.

Stablr non vuole essere un semplice aggregatore di scorecard. Vuole diventare la versione più affidabile, tracciabile e giocabile dei campi italiani.

Per questo motivo devono restare sempre separati:

- catalogo ufficiale FIG;
- fonti operative come GesGolf;
- evidenze raccolte da utenti, club e admin;
- layer certificato Stablr.

Il badge verde non indica semplicemente che un dato arriva da una fonte “buona”. Indica che Stablr ha preso una decisione editoriale esplicita: quel percorso è certificato da Stablr.

Il badge arancio non è solo una fase temporanea prima del verde. È uno stato stabile e legittimo: il percorso è giocabile, i dati sono sufficientemente affidabili, ma Stablr non li ha ancora certificati.

L’unità minima di governo del dato è sempre:

```text
fig_club + fig_playable_course
```

non il club intero.

---

## 1. Principi guida

### 1.1 Affidabilità prima della quantità

Stablr può accelerare la copertura dei club italiani tramite import, automazioni e contributi della community, ma non deve fingere una certezza che non possiede.

È preferibile avere un percorso arancio, giocabile e trasparente, rispetto a un percorso verde certificato senza evidenze sufficienti.

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
| Evidence | prova che supporta o rafforza il dato | foto scorecard, PDF ufficiale, sito club, mail club, verifica sul campo, più foto concordanti |

Una Source può fornire dati. Una Evidence aiuta Stablr a decidere se quei dati sono affidabili, pubblicabili o certificabili.

### 1.4 Nessun aggiornamento live senza controllo

Foto, OCR, import GesGolf o contributi utenti non devono mai aggiornare direttamente il database live.

Ogni dato passa da:

- staging;
- guardrail;
- valutazione;
- decisione di pubblicazione o certificazione.

### 1.5 Certificazione come decisione editoriale

Il verde è una decisione Stablr.

Non significa:

```text
Questo dato proviene da una fonte nota.
```

Significa:

```text
Stablr certifica questo percorso come affidabile e giocabile.
```

La certificazione deve essere tracciabile, motivata e reversibile tramite versioning.

### 1.6 Arancio come stato stabile

L’arancio non è un “quasi verde”.

Significa:

- percorso giocabile;
- dati tecnicamente coerenti;
- nessun blocco critico;
- certificazione Stablr non ancora concessa.

Un percorso può restare arancio anche a tempo indeterminato.

### 1.7 Audit completo

Ogni decisione significativa deve registrare:

- chi ha deciso;
- quando;
- su quale percorso FIG;
- con quali fonti;
- con quali evidenze;
- con quale motivazione;
- quale stato precedente è stato sostituito.

---

## 2. Scorecard Validation & Certification Pipeline

Il ciclo di vita del dato segue questo flusso:

```text
Acquisizione
↓
Normalizzazione
↓
Guardrail
↓
Valutazione
↓
Certification Decision
↓
Pubblicazione
↓
Versioning
↓
Audit
```

### 2.1 Acquisizione

I dati possono arrivare da:

- import GesGolf;
- foto scorecard caricata da utente;
- più foto di supporto;
- PDF ufficiale del club;
- sito ufficiale del club;
- verifica manuale Stablr;
- comunicazione diretta del club;
- esperienza sul campo di admin o collaboratori.

L’acquisizione non implica mai pubblicazione.

### 2.2 Normalizzazione

Ogni dato acquisito viene ricondotto a:

- fig_club;
- fig_playable_course;
- numero buca;
- par;
- Stroke Index;
- eventuale hole mapping;
- fonte;
- evidenze collegate;
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

### 2.4 Valutazione

La valutazione combina:

- coerenza tecnica;
- fonti disponibili;
- evidenze;
- guardrail;
- note admin;
- eventuale Quality Score interno.

La valutazione prepara la decisione, ma non la sostituisce.

### 2.5 Certification Decision

L’admin non “fa solo review”.

L’admin decide se:

- certificare;
- lasciare arancio;
- bloccare;
- segnare problema noto;
- richiedere ulteriori evidenze;
- contattare il club.

### 2.6 Pubblicazione

La pubblicazione rende un dato disponibile nel layer giocabile.

Può avvenire in due forme:

- arancio giocabile;
- verde certificato.

La pubblicazione verde richiede decisione esplicita Stablr.

### 2.7 Versioning

Ogni scorecard certificata o pubblicata deve poter essere sostituita da una nuova versione senza cancellare la precedente.

Una versione vecchia diventa superseded.

### 2.8 Audit

L’audit conserva:

- decisioni;
- motivazioni;
- evidenze usate;
- conflitti risolti;
- versioni precedenti;
- admin/verificatori coinvolti.

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

È una decisione editoriale, non una proprietà automatica della fonte.

Un percorso verde deve avere:

- dati buca-per-buca completi;
- par coerenti;
- Stroke Index coerenti;
- nessun guardrail bloccante;
- evidenze sufficienti;
- decisione admin tracciata.

Copy UX suggerita:

```text
Certificato Stablr
Dati verificati e certificati da Stablr.
```

### 4.2 Arancio — Giocabile, non certificato

L’arancio significa:

```text
Giocabile, dati da confermare.
```

Non è necessariamente temporaneo.

Un percorso può restare arancio se:

- i dati sono sufficientemente coerenti;
- non ci sono blocchi critici;
- manca una evidenza forte;
- Stablr non ha ancora deciso di certificarlo.

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
- fonte ufficiale temporaneamente divergente;
- scorecard aggiornata segnalata ma non ancora verificata.

Copy UX suggerita:

```text
Problema noto
Questo percorso è giocabile, ma Stablr sta verificando una possibile anomalia.
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

---

## 6. Evidence Model

Le Evidence sono prove che supportano un dato.

Esempi:

- foto scorecard utente;
- più foto concordanti;
- PDF ufficiale del club;
- pagina del sito ufficiale;
- email della segreteria;
- verifica sul campo;
- verifica manuale Stablr;
- confronto coerente FIG + GesGolf.

Le evidenze non sono scorecard concorrenti.

Sono elementi che rafforzano o indeboliscono la fiducia nella scorecard corrente.

| Evidence | Forza indicativa |
|---|---|
| PDF ufficiale club aggiornato | alta |
| foto scorecard leggibile | medio-alta |
| più foto concordanti | alta |
| verifica sul campo admin | medio-alta |
| GesGolf coerente con FIG | media |
| singola foto parziale | bassa |

---

## 7. Confidence

La Confidence riguarda l’affidabilità di un singolo dato, non lo stato complessivo del percorso.

In futuro dati diversi potrebbero avere confidence diverse:

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

La Confidence non decide automaticamente certificazione o pubblicazione.

Serve a supportare admin e futuri strumenti di quality control.

---

## 8. Quality Score interno

Il Quality Score è un indicatore interno, non visibile agli utenti.

Serve a ordinare, filtrare e prioritizzare le decisioni admin.

Non certifica automaticamente.

### Fattori che aumentano il Quality Score

- FIG e GesGolf coerenti;
- scorecard ufficiale disponibile;
- più evidenze concordanti;
- nessun guardrail;
- dati completi;
- verifica admin recente;
- club già confermato dalla segreteria.

### Fattori che lo diminuiscono

- route duplicate;
- dati provvisori;
- SI compressi non risolti;
- mismatch tra fonti;
- foto illeggibili;
- evidenze vecchie;
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
| Uploader | crea una bozza o fornisce evidenza |
| Admin | valuta, certifica, blocca, pubblica |
| Stablr | definisce criteri, mantiene governance, gestisce qualità |
| Club/segreteria | può fornire evidenze ufficiali o conferme |

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
- fonte;
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
- evidenze;
- anomalie;
- note;
- cronologia decisioni.

### 10.4 Confronto evidenze

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
- richiedi evidenza;
- contatta club;
- crea nuova versione.

---

## 11. Review di import GesGolf arancio

Flusso:

1. GesGolf produce dati coerenti.
2. Il percorso viene importato come arancio.
3. Il percorso è giocabile ma non certificato.
4. Admin apre la Certification Surface.
5. Admin confronta:
   - FIG;
   - GesGolf;
   - eventuali evidenze;
   - guardrail;
   - Quality Score.
6. Admin decide:
   - certifica;
   - lascia arancio;
   - problema noto;
   - blocca.

---

## 12. Review di scorecard caricata da utente

Flusso:

1. Utente carica foto.
2. Nasce una bozza privata o evidenza collegata.
3. Se l’utente completa/invia, passa a in_review.
4. Admin confronta foto con:
   - FIG;
   - GesGolf;
   - dati live;
   - altre evidenze.
5. Admin può:
   - correggere;
   - chiedere supporto;
   - certificare;
   - creare nuova versione;
   - bloccare.

La foto non pubblica mai direttamente.

---

## 13. Guardrail

| Caso | Tipo | Azione |
|---|---|---|
| SI fuori 1–18 | blocco | non importare |
| SI compressi non risolti | blocco | review obbligatoria |
| route duplicata | review | richiede classificazione |
| percorso provvisorio | review | non certificare automaticamente |
| par totale incoerente | blocco/review | dipende dalla gravità |
| club complesso | review | workflow dedicato |
| fonte divergente | review | confronto evidenze |

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

- niente certificazione automatica;
- niente assunzioni su combinazioni;
- priorità a scorecard ufficiale;
- pubblicazione per singolo percorso/combinazione FIG;
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
Puoi usare questo percorso in anteprima mentre Stablr lo verifica.
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
Questo percorso è giocabile, ma Stablr sta verificando una possibile anomalia.
```

---

## 16. Criteri oggettivi per certificazione verde

Un percorso può diventare certificato se:

- è associato a un fig_playable_course;
- ha buche complete;
- ha par coerenti;
- ha SI validi e completi;
- non ha guardrail bloccanti;
- ha almeno una evidenza forte o più evidenze coerenti;
- l’admin ha registrato una decisione motivata;
- la versione pubblicata è tracciabile.

Il verde non richiede necessariamente conferma del club, ma richiede una decisione Stablr difendibile.

---

## 17. Audit

Ogni decisione deve tracciare:

- verificatore;
- timestamp;
- percorso FIG;
- stato precedente;
- nuovo stato;
- Source usate;
- Evidence usate;
- motivazione;
- eventuali problemi noti;
- versione generata o aggiornata.

Esempio:

```text
Certificato da Giuseppe il 2026-07-05.
Motivo: FIG + GesGolf coerenti, scorecard ufficiale verificata.
```

---

## 18. Versioning

Creare nuova versione quando:

- cambia par buca;
- cambia SI;
- cambia routing;
- cambia scorecard ufficiale;
- una versione provvisoria viene sostituita;
- una evidenza forte corregge il live.

Non serve nuova versione per:

- note interne;
- aggiunta di evidenza senza cambio dati;
- cambio Quality Score;
- cambio stato di review senza modifica live.

Le versioni precedenti non si cancellano.

---

## 19. Conflitti tra fonti ed evidenze

Priorità indicativa:

1. FIG per identità, tee, CR, Slope.
2. Scorecard ufficiale club aggiornata.
3. Verifica Stablr.
4. GesGolf.
5. Foto utente.
6. Segnalazioni community.

Se fonti ed evidenze divergono:

- non certificare automaticamente;
- aprire conflict review;
- documentare la divergenza;
- scegliere fonte prevalente solo con nota admin.

---

## 20. MVP

MVP minimo:

- lista percorsi arancio;
- lista guardrail/bloccati;
- dettaglio percorso FIG;
- tabella buche/par/SI;
- fonti disponibili;
- evidenze disponibili;
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
- version diff visuale.

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
- evidenze multiple;
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
- certificazioni scadute.

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

