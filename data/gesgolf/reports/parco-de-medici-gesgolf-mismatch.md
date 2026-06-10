# Parco de' Medici: FIG vs GesGolf mismatch report

Questo report e' solo di benchmark. Nessun dato live e' stato aggiornato.

## Vincoli

- Non toccare Mare di Roma.
- Non toccare Parco de' Medici nel DB live.
- GesGolf qui e' solo una fonte di confronto tecnico.

## Club

- FIG: Parco De' Medici
- GesGolf: ASD GOLF CLUB PARCO DE' MEDICI
- Normalized match: si

## Inventario

- Unita' FIG (routes + combinations): 10
- Unita' GesGolf: 11
- Mapping manuale usato nel benchmark: 10
- FIG non mappati: Rosso
- GesGolf non mappati: Red

## Failed routes GesGolf

- INTERNAZIONALI (2514): GesGolf HTTP 500 for circolo 112 / percorso 2514

## Anomalie GesGolf

- Red (433): 18 buche dichiarate ma seconda meta' vuota o azzerata; par totale anomalo per un 18 buche; stroke index assente o azzerato su molte buche

## Confronti mappati

### 9 Buche Bianco -> Bianco

- Relazione: direct_route
- Stato: par_ok_si_diff
- Par totale: FIG 35 / GesGolf 35
- Buche: FIG 9 / GesGolf 9
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: no
- Match CR/SR tee condivisi: si
- Differenze SI: #3 FIG 9 / GES 5; #4 FIG 17 / GES 15; #5 FIG 5 / GES 13; #6 FIG 13 / GES 11; #7 FIG 11 / GES 9; #8 FIG 15 / GES 17

### 9 Buche Blu -> Blu

- Relazione: direct_route
- Stato: par_ok_si_diff
- Par totale: FIG 37 / GesGolf 37
- Buche: FIG 9 / GesGolf 9
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: no
- Match CR/SR tee condivisi: si
- Differenze SI: #1 FIG 2 / GES 9; #2 FIG 18 / GES 17; #3 FIG 16 / GES 15; #4 FIG 4 / GES 1; #5 FIG 14 / GES 13; #6 FIG 6 / GES 5; #7 FIG 8 / GES 7; #8 FIG 10 / GES 3; #9 FIG 12 / GES 11

### BIANCO X 2 -> 9 Buche Bianco 2 Volte

- Relazione: repeat_route
- Stato: match
- Par totale: FIG 70 / GesGolf 70
- Buche: FIG 18 / GesGolf 18
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: si
- Match CR/SR tee condivisi: si

### BLU X2 -> 9 Buche Blu 2 Volte

- Relazione: repeat_route
- Stato: match
- Par totale: FIG 74 / GesGolf 74
- Buche: FIG 18 / GesGolf 18
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: si
- Match CR/SR tee condivisi: si

### R-R -> Est (Rosso x 2)

- Relazione: repeat_route
- Stato: match
- Par totale: FIG 70 / GesGolf 70
- Buche: FIG 18 / GesGolf 18
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: si
- Match CR/SR tee condivisi: si

### W-BL -> Championship Bianco/Blu

- Relazione: combination
- Stato: par_ok_si_diff
- Par totale: FIG 72 / GesGolf 72
- Buche: FIG 18 / GesGolf 18
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: no
- Match CR/SR tee condivisi: si
- Differenze SI: #10 FIG 10 / GES 4; #11 FIG 18 / GES 8; #12 FIG 16 / GES 6; #13 FIG 2 / GES 16; #15 FIG 6 / GES 12; #16 FIG 8 / GES 10; #17 FIG 4 / GES 18; #18 FIG 12 / GES 2

### BL-W -> Blu/Bianco (Champ. Invertito)

- Relazione: combination
- Stato: match
- Par totale: FIG 72 / GesGolf 72
- Buche: FIG 18 / GesGolf 18
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: si
- Match CR/SR tee condivisi: si

### BL-R -> King Blu/Rosso

- Relazione: combination
- Stato: match
- Par totale: FIG 72 / GesGolf 72
- Buche: FIG 18 / GesGolf 18
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: si
- Match CR/SR tee condivisi: si

### W-R -> Queen Bianco/Rosso

- Relazione: combination
- Stato: par_ok_si_diff
- Par totale: FIG 70 / GesGolf 70
- Buche: FIG 18 / GesGolf 18
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: no
- Match CR/SR tee condivisi: si
- Differenze SI: #3 FIG 5 / GES 9; #4 FIG 15 / GES 17; #5 FIG 13 / GES 5; #6 FIG 11 / GES 13; #7 FIG 9 / GES 11; #8 FIG 17 / GES 15

### Est V-A -> Blu/Bianco (Champ. Invertito)

- Relazione: alias_candidate
- Stato: match
- Par totale: FIG 72 / GesGolf 72
- Buche: FIG 18 / GesGolf 18
- Match par hole-by-hole: si
- Match Stroke Index hole-by-hole: si
- Match CR/SR tee condivisi: si

## Lettura rapida

- Le basi 9 buche e i percorsi ripetuti risultano allineati molto bene.
- Le combinazioni 18 buche confermano i par ufficiali, ma lo Stroke Index puo' divergere nella seconda meta'.
- GesGolf espone anche percorsi/alias extra che vanno normalizzati prima di qualunque import.
- Il percorso GesGolf `INTERNAZIONALI` oggi risponde con HTTP 500, quindi serve gestione robusta dei fallimenti nello scraper.

