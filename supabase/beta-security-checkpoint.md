# Beta security checkpoint

Quando gli import saranno finiti nel senso prodotto — tutti i club target almeno configurabili e giocabili, anche se non tutti `Stablr Approved` — fermarsi prima della beta pubblica e aprire questa task:

## Protezione DB Stablr - audit RLS e scraping surface

Obiettivo: proteggere il valore del dataset curato Stablr e rendere difficile lo scraping bulk.

Non fare questa task nel mezzo degli import, per non rischiare regressioni sulla giocabilita'.

Checklist minima:

- creare/aggiornare `supabase/security-audit.md`;
- controllare RLS su tutte le tabelle esposte;
- controllare grants per `anon`, `authenticated`, `service_role`;
- verificare quali tabelle hole-by-hole sono leggibili dal frontend;
- individuare query frontend troppo larghe;
- separare lista club, dettaglio club e dati giocabili hole-by-hole;
- valutare Edge Function per `getRoundSetup` / `startRound`;
- valutare rate limit e logging anti-abuso;
- testare ricerca club, setup giro e avvio giro dopo ogni modifica.

Regola di memoria operativa:

Quando un handover o una nuova sessione dice che gli import sono completi / siamo in fase beta, ricordare esplicitamente questo checkpoint prima di continuare con nuove feature.
