# STABLR — Codex Working Instructions

## Model and reasoning efficiency

L'impostazione di partenza per il lavoro quotidiano su Stablr è **GPT-5.6 Terra Light**.

Prima di iniziare ogni task, valuta se l'impostazione corrente è adeguata e sufficiente per completarla correttamente con il minor consumo ragionevole.

### Procedi direttamente con l'impostazione corrente per:

- piccoli fix;
- UI e copy;
- modifiche meccaniche;
- ricerche mirate;
- task circoscritte;
- controlli semplici.

### Valuta un'impostazione superiore per:

- sviluppo ordinario non banale;
- debugging articolato;
- modifiche coordinate su più componenti;
- analisi che richiedono maggiore reasoning.

### Fermati prima di lavorare e consigliami un'impostazione superiore per:

- decisioni architetturali importanti;
- migrazioni delicate;
- modifiche con rischio per database o dati live;
- debugging complesso;
- analisi trasversali importanti del repository;
- operazioni potenzialmente distruttive o difficili da ripristinare.

Quando consigli un cambio, rispondi prima soltanto con:

**Impostazione consigliata:** [modello disponibile] — [livello reasoning]\
**Motivo:** [una frase breve]

Poi attendi la mia conferma prima di eseguire la task.

Se l'impostazione corrente è già adeguata, non interrompere il workflow con raccomandazioni: procedi normalmente.

### Ritorno a Terra Light

Quando mi hai consigliato di passare temporaneamente a un modello o livello di reasoning superiore, continua a valutare il livello necessario durante la task.

Appena la parte del lavoro che richiedeva maggiore capacità è conclusa e le attività residue possono essere svolte in sicurezza con GPT-5.6 Terra Light, fermati prima di proseguire e avvisami.

Usa soltanto questo formato:

**Puoi tornare a:** GPT-5.6 Terra Light\
**Motivo:** [una frase breve su cosa è stato completato e perché il lavoro residuo non richiede più il livello superiore]

Attendi che io effettui il cambio e ti dica di continuare.

Non mantenere un modello/reasoning superiore per comodità o per tutta la durata della task se non è più necessario.

L'obiettivo è quindi simmetrico:

- consigliarmi di **salire** quando Terra Light non è sufficiente;
- consigliarmi di **scendere** appena il lavoro complesso è terminato.

## Context efficiency

- Non analizzare l'intero repository quando bastano file, directory o ricerche mirate.
- Riutilizza il contesto già acquisito nella sessione quando affidabile.
- Evita analisi ripetitive non necessarie.
- Non aumentare modello o reasoning solo per prudenza.
- Qualità, integrità dei dati e sicurezza hanno comunque priorità sul risparmio di utilizzo.

Queste istruzioni devono applicarsi all'intero repository Stablr.

## Convenzioni UX obbligatorie — Admin STABLR

- **Pulsanti:** utilizzare sempre componenti e stili del design system Admin.
  Vietati controlli nativi non stilizzati. Mantenere una gerarchia coerente tra
  azioni primarie, secondarie, annullamento e azioni distruttive, con dimensioni,
  padding, spaziature, focus e stati disabilitati uniformi.
- **Input numerici:** rispettare i limiti e la scala reali sia con tastiera sia
  con freccette. Nelle scale cicliche implementare il loop massimo/minimo in
  entrambi i sensi, includendo eventuali scale non consecutive. Non applicare il
  loop ai valori non ciclici. Valori fuori scala non possono essere confermati
  né salvati; eventuali prefissi incompleti durante la digitazione vanno risolti
  o scartati prima della conferma e all'uscita dal campo.
- **Modali e anteprime:** riutilizzare controlli, espansioni, conferme e
  annullamenti coerenti con la UX Admin. Distinguere sempre warning confermabili
  da violazioni bloccanti; una conferma non deve aggirare i vincoli server/DB.
- **Riuso preventivo:** prima di introdurre UI in ogni task, individuare e
  riutilizzare controlli numerici, pulsanti, modali ed espansioni già conformi
  nei flussi esistenti. Non ricreare frecce native o controlli non stilizzati:
  nelle scale cicliche usare il controllo con pulsanti espliciti e la logica
  condivisa, sia per il mouse sia per la tastiera. Un valore manuale rifiutato
  deve avere feedback chiaro, mai essere convertito silenziosamente.
- **Verifica prima della consegna:** controllare le schermate e le modali
  introdotte/modificate, comprese espansioni, conferme, annullamenti, stati
  disabilitati, focus e limiti numerici. Aggiungere test mirati per i bordi della
  scala, mouse/tastiera, input manuale non valido e controlli di espansione.
  Nessuna consegna con controlli nativi non stilizzati o gerarchie incoerenti;
  distinguere visivamente informazioni e blocchi senza indebolire le validazioni.
