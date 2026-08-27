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

## Context efficiency

- Non analizzare l'intero repository quando bastano file, directory o ricerche mirate.
- Riutilizza il contesto già acquisito nella sessione quando affidabile.
- Evita analisi ripetitive non necessarie.
- Non aumentare modello o reasoning solo per prudenza.
- Qualità, integrità dei dati e sicurezza hanno comunque priorità sul risparmio di utilizzo.

Queste istruzioni devono applicarsi all'intero repository Stablr.
